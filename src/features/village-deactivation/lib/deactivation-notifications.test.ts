import { describe, expect, it } from "vitest";

import {
  deliverDeactivationNotifications,
  markNotificationsRead,
  syncDeactivationNotifications,
} from "./deactivation-notifications";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-01T00:00:00.000Z");

interface Row {
  dedupeKey: string;
  userId: string;
  [key: string]: unknown;
}

/** Minimal in-memory client: just what the notification code touches. */
function fakeClient(options: { failCreate?: boolean; failAudit?: boolean } = {}) {
  const rows = new Map<string, Row>();
  const audits: unknown[] = [];
  const client = {
    villageDeactivationRequest: {
      findUnique: async () => ({
        id: "req-1",
        villageId: "village-1",
        status: "PENDING",
        reason: "Closing",
        approvedAt: null,
        scheduledDeactivationAt: null,
        rejectedAt: null,
        rejectionReason: null,
        cooldownEndsAt: null,
        cancelledAt: null,
        cancellationReason: null,
        completedAt: null,
      }),
    },
    village: {
      findUnique: async () => ({ name: "V", villageCode: "V1" }),
    },
    user: {
      findMany: async (args: { where: { role: string } }) =>
        args.where.role === "SYSTEM_ADMIN"
          ? [{ id: "admin-1" }, { id: "admin-2" }]
          : [{ id: "chief-1" }],
    },
    notification: {
      createMany: async (args: { data: Row[] }) => {
        if (options.failCreate) throw new Error("db down");
        let count = 0;
        for (const row of args.data) {
          if (!rows.has(row.dedupeKey)) {
            rows.set(row.dedupeKey, row);
            count += 1;
          }
        }
        return { count };
      },
      updateMany: async (args: {
        where: { userId: string; id: { in: string[] } };
      }) => ({
        count: args.where.id.in.filter((id) => id.startsWith(args.where.userId))
          .length,
      }),
    },
    auditLog: {
      create: async (args: unknown) => {
        if (options.failAudit) throw new Error("audit down");
        audits.push(args);
        return {};
      },
    },
  };
  return { client: client as never, rows, audits };
}

describe("syncDeactivationNotifications", () => {
  it("stores each planned notification once, and again is a no-op", async () => {
    const { client, rows } = fakeClient();
    const params = { requestId: "req-1", now: NOW, reminderOffsetsMs: [12 * HOUR] };

    const first = await syncDeactivationNotifications(client, params);
    expect(first).toEqual({ planned: 2, created: 2 });

    const second = await syncDeactivationNotifications(client, params);
    expect(second).toEqual({ planned: 2, created: 0 });
    expect(rows.size).toBe(2);
  });
});

describe("deliverDeactivationNotifications failure isolation", () => {
  it("never throws when storing fails, logs it, and records an audit entry", async () => {
    const { client, audits } = fakeClient({ failCreate: true });
    const logged: string[] = [];

    const result = await deliverDeactivationNotifications(client, "req-1", "requested", {
      now: () => NOW,
      reminderOffsetsMs: [],
      log: (message) => logged.push(message),
    });

    expect(result).toBeNull();
    expect(logged).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("never throws even when the audit write also fails", async () => {
    const { client } = fakeClient({ failCreate: true, failAudit: true });

    const result = await deliverDeactivationNotifications(client, "req-1", "requested", {
      now: () => NOW,
      reminderOffsetsMs: [],
      log: () => undefined,
    });

    expect(result).toBeNull();
  });

  it("retry after a failure stores the notifications (self-healing)", async () => {
    const failing = fakeClient({ failCreate: true });
    await deliverDeactivationNotifications(failing.client, "req-1", "requested", {
      now: () => NOW,
      reminderOffsetsMs: [],
      log: () => undefined,
    });
    expect(failing.rows.size).toBe(0);

    const working = fakeClient();
    const retry = await deliverDeactivationNotifications(working.client, "req-1", "requested", {
      now: () => NOW,
      reminderOffsetsMs: [],
    });
    expect(retry?.created).toBe(2);
  });
});

describe("markNotificationsRead", () => {
  it("only counts the user's own notifications", async () => {
    const { client } = fakeClient();
    const count = await markNotificationsRead(
      client,
      "u1",
      ["u1-a", "u2-b"],
      NOW,
    );
    expect(count).toBe(1);
  });
});
