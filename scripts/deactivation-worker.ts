/*
 * Village deactivation worker. Host independent: a plain Node process, so it
 * runs the same under systemd, Docker, a Kubernetes Deployment or CronJob, a
 * Replit deployment, PM2, or a cron line using --once. Nothing here depends on
 * the web host or on a user session.
 *
 *   npm run worker:deactivation          loop: a pass every
 *                                        DEACTIVATION_WORKER_INTERVAL_SECONDS
 *   npm run worker:deactivation:once     one pass, then exit (0 = clean,
 *                                        1 = something failed or was blocked)
 *
 * Needs DATABASE_URL (loaded from .env if present). Several instances may run
 * at once; due requests are claimed with FOR UPDATE SKIP LOCKED.
 *
 * Why `--conditions=react-server` (see the npm scripts): the shared code imports
 * "server-only", which throws outside a Next.js server build unless the
 * "react-server" export condition is set. It is a marker, not a runtime need.
 */

import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { parseDeactivationConfig } from "../src/features/village-deactivation/lib/deactivation-config";
import { deliverDeactivationNotifications } from "../src/features/village-deactivation/lib/deactivation-notifications";
import {
  passExitCode,
  runWorkerPass,
  type PassResult,
  type WorkerDeps,
} from "../src/features/village-deactivation/lib/deactivation-worker";
import { createPrismaWorkerStore } from "../src/features/village-deactivation/lib/deactivation-worker-store";
import { completeDeactivationRequest } from "../src/features/village-deactivation/lib/village-deactivation-service";

const COMPLETED_BY = "SYSTEM:deactivation-worker";

function log(message: string, detail?: unknown) {
  const line = `[deactivation-worker] ${new Date().toISOString()} ${message}`;

  if (detail === undefined) {
    console.log(line);
  } else {
    console.log(line, detail instanceof Error ? detail.message : detail);
  }
}

function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const check = setInterval(() => {
      if (signal.stopped) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 500);
    timer.unref?.();
    setTimeout(() => clearInterval(check), ms + 1000).unref?.();
  });
}

async function main(): Promise<number> {
  const once = process.argv.includes("--once");
  // Throws on a bad value: fail at start instead of running with a guess.
  const config = parseDeactivationConfig(process.env);

  const deps: WorkerDeps = {
    store: createPrismaWorkerStore(prisma),
    // completeDeactivationRequest already notifies after its own commit.
    complete: (requestId) =>
      completeDeactivationRequest({ requestId, completedBy: COMPLETED_BY }),
    deliver: (requestId, now) =>
      deliverDeactivationNotifications(prisma, requestId, "worker-reconcile", {
        now: () => now,
        reminderOffsetsMs: config.reminderOffsetsMs,
        log,
      }),
    batchSize: config.workerBatchSize,
    log,
  };

  if (once) {
    const result = await runWorkerPass(deps);
    log("Pass finished", JSON.stringify(result));
    return passExitCode(result);
  }

  const signal = { stopped: false };
  const stop = () => {
    if (!signal.stopped) {
      log("Stopping after the current pass");
      signal.stopped = true;
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(
    `Started: interval ${config.workerIntervalMs / 1000}s, batch ${config.workerBatchSize}`,
  );

  while (!signal.stopped) {
    try {
      const result: PassResult = await runWorkerPass(deps);

      if (result.claimed > 0 || result.failed > 0 || result.blocked > 0) {
        log("Pass finished", JSON.stringify(result));
      }
    } catch (error) {
      // Typically the database being unreachable. Keep running; try next pass.
      log("Pass failed", error);
    }

    await sleep(config.workerIntervalMs, signal);
  }

  log("Stopped");
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect().catch(() => undefined);
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("[deactivation-worker] fatal:", error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
