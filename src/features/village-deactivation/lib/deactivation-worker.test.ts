import { describe, expect, it } from "vitest";

import {
  CLAIM_LEASE_SECONDS,
  passExitCode,
  runWorkerPass,
  type CompleteResult,
  type WorkerDeps,
  type WorkerStore,
} from "./deactivation-worker";

const NOW = new Date("2026-11-02T00:00:00.000Z");

function fakeStore(options: {
  due?: string[];
  reconcile?: string[];
  failRecord?: boolean;
  failList?: boolean;
} = {}) {
  const failures: { id: string; message: string; retryNow: boolean }[] = [];
  const claimCalls: { limit: number; lease: number }[] = [];
  const store: WorkerStore = {
    readNow: async () => NOW,
    claimDueRequests: async (limit, lease) => {
      claimCalls.push({ limit, lease });
      return options.due ?? [];
    },
    recordFailure: async (id, message, o) => {
      if (options.failRecord) throw new Error("record failed");
      failures.push({ id, message, retryNow: o.retryNow });
    },
    listReconcileRequestIds: async () => {
      if (options.failList) throw new Error("list failed");
      return options.reconcile ?? [];
    },
  };
  return { store, failures, claimCalls };
}

function deps(
  store: WorkerStore,
  complete: (id: string) => Promise<CompleteResult>,
  deliver: WorkerDeps["deliver"] = async () => ({ planned: 1, created: 1 }),
): WorkerDeps {
  return { store, complete, deliver, batchSize: 10 };
}

describe("runWorkerPass completion", () => {
  it("completes every claimed request and passes batch size and lease to the claim", async () => {
    const { store, claimCalls } = fakeStore({ due: ["a", "b"] });
    const completed: string[] = [];

    const result = await runWorkerPass(
      deps(store, async (id) => {
        completed.push(id);
        return { kind: "completed" };
      }),
    );

    expect(completed).toEqual(["a", "b"]);
    expect(result.completed).toBe(2);
    expect(claimCalls).toEqual([{ limit: 10, lease: CLAIM_LEASE_SECONDS }]);
    expect(passExitCode(result)).toBe(0);
  });

  it("does nothing when nothing is due", async () => {
    const { store } = fakeStore();
    const result = await runWorkerPass(
      deps(store, async () => {
        throw new Error("must not be called");
      }),
    );
    expect(result.claimed).toBe(0);
    expect(passExitCode(result)).toBe(0);
  });

  it("treats a request cancelled or completed meanwhile as resolved, not an error", async () => {
    const { store, failures } = fakeStore({ due: ["a", "b"] });
    const result = await runWorkerPass(
      deps(store, async (id) =>
        id === "a"
          ? { kind: "blocked", reason: "NOT_APPROVED" }
          : { kind: "not_found" },
      ),
    );
    expect(result.alreadyResolved).toBe(2);
    expect(result.blocked).toBe(0);
    expect(failures).toEqual([]);
    expect(passExitCode(result)).toBe(0);
  });

  it("records other blocked reasons without releasing the claim lease", async () => {
    const { store, failures } = fakeStore({ due: ["a"] });
    const result = await runWorkerPass(
      deps(store, async () => ({ kind: "blocked", reason: "VILLAGE_ALREADY_DEACTIVATED" })),
    );
    expect(result.blocked).toBe(1);
    expect(failures).toEqual([
      { id: "a", message: "blocked: VILLAGE_ALREADY_DEACTIVATED", retryNow: false },
    ]);
    expect(passExitCode(result)).toBe(1);
  });

  it("one failing request does not stop the others; its error is recorded for retry", async () => {
    const { store, failures } = fakeStore({ due: ["a", "b", "c"] });
    const completed: string[] = [];
    const result = await runWorkerPass(
      deps(store, async (id) => {
        if (id === "b") throw new Error("boom");
        completed.push(id);
        return { kind: "completed" };
      }),
    );

    expect(completed).toEqual(["a", "c"]);
    expect(result.failed).toBe(1);
    expect(failures).toEqual([{ id: "b", message: "boom", retryNow: true }]);
    expect(passExitCode(result)).toBe(1);
  });

  it("truncates long error text", async () => {
    const { store, failures } = fakeStore({ due: ["a"] });
    await runWorkerPass(
      deps(store, async () => {
        throw new Error("x".repeat(2000));
      }),
    );
    expect(failures[0].message).toHaveLength(500);
  });

  it("survives a failing bookkeeping write", async () => {
    const { store } = fakeStore({ due: ["a", "b"], failRecord: true });
    const result = await runWorkerPass(
      deps(store, async () => {
        throw new Error("boom");
      }),
    );
    expect(result.failed).toBe(2);
  });
});

describe("runWorkerPass notification reconcile", () => {
  it("syncs every listed request with the database time and counts what was created", async () => {
    const { store } = fakeStore({ reconcile: ["a", "b"] });
    const seen: { id: string; now: Date }[] = [];

    const result = await runWorkerPass(
      deps(
        store,
        async () => ({ kind: "completed" }),
        async (id, now) => {
          seen.push({ id, now });
          return { planned: 3, created: 2 };
        },
      ),
    );

    expect(seen.map((s) => s.id)).toEqual(["a", "b"]);
    expect(seen[0].now.getTime()).toBe(NOW.getTime());
    expect(result.notificationsCreated).toBe(4);
  });

  it("counts failed deliveries and carries on with the rest", async () => {
    const { store } = fakeStore({ reconcile: ["a", "b"] });
    const result = await runWorkerPass(
      deps(
        store,
        async () => ({ kind: "completed" }),
        async (id) => (id === "a" ? null : { planned: 1, created: 1 }),
      ),
    );
    expect(result.notificationFailures).toBe(1);
    expect(result.notificationsCreated).toBe(1);
    expect(passExitCode(result)).toBe(1);
  });

  it("completion still happens when the reconcile listing fails", async () => {
    const { store } = fakeStore({ due: ["a"], failList: true });
    const result = await runWorkerPass(
      deps(store, async () => ({ kind: "completed" })),
    );
    expect(result.completed).toBe(1);
    expect(result.notificationFailures).toBe(1);
  });

  it("a notification problem never prevents completion (completion runs first)", async () => {
    const { store } = fakeStore({ due: ["a"], reconcile: ["a"] });
    const order: string[] = [];
    await runWorkerPass(
      deps(
        store,
        async () => {
          order.push("complete");
          return { kind: "completed" };
        },
        async () => {
          order.push("deliver");
          return null;
        },
      ),
    );
    expect(order).toEqual(["complete", "deliver"]);
  });
});
