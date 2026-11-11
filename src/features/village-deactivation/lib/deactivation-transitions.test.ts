import { describe, expect, it, vi } from "vitest";

import { createFakeState, createFakeTx } from "../../../test-support/fake-deactivation-tx";
import {
  approveDeactivationRequestInTx,
  cancelDeactivationRequestInTx,
  completeDeactivationRequestInTx,
  rejectDeactivationRequestInTx,
  submitDeactivationRequestInTx,
} from "./deactivation-transitions";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-10-28T10:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

function setup(villageStatus = "ACTIVE") {
  const state = createFakeState(T0);
  state.villages.set("v1", { status: villageStatus, rowVersion: 0 });
  state.villages.set("v2", { status: "ACTIVE", rowVersion: 0 });
  state.users.set("chief1", { id: "chief1", role: "CHIEF", villageId: "v1", membershipStatus: "ACTIVE" });
  state.users.set("chief2", { id: "chief2", role: "CHIEF", villageId: "v2", membershipStatus: "ACTIVE" });
  state.users.set("villager", { id: "villager", role: "VILLAGER", villageId: "v1", membershipStatus: "ACTIVE" });
  state.users.set("admin", { id: "admin", role: "SYSTEM_ADMIN", villageId: null, membershipStatus: null });
  return { state, tx: createFakeTx(state) as never };
}

async function approved(hoursAfterT0 = 0) {
  const ctx = setup();
  const submit = await submitDeactivationRequestInTx(ctx.tx, { actorUserId: "chief1", villageId: "v1", reason: "closing" });
  if (submit.kind !== "created") throw new Error("setup: submit failed");
  const approve = await approveDeactivationRequestInTx(ctx.tx, { requestId: submit.requestId, actorUserId: "admin", now: at(hoursAfterT0) });
  if (approve.kind !== "approved") throw new Error("setup: approve failed");
  return { ...ctx, requestId: submit.requestId };
}

const lastAudit = (state: { audits: Record<string, unknown>[] }) => state.audits[state.audits.length - 1];

describe("submitDeactivationRequestInTx", () => {
  it("creates a PENDING request with the reason, audits it, and leaves the village alone", async () => {
    const { state, tx } = setup();
    const out = await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "  Closing down  " });

    expect(out.kind).toBe("created");
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ villageId: "v1", requesterUserId: "chief1", reason: "Closing down", status: "PENDING" });
    expect(state.villages.get("v1")?.status).toBe("ACTIVE");
    expect(state.calls).not.toContain("village.updateMany");
    expect(lastAudit(state)).toMatchObject({ actionType: "CREATE", entityType: "DEACTIVATION_REQUEST", villageId: "v1", actorUserId: "chief1" });
  });

  it("requires a reason and writes nothing without one", async () => {
    const { state, tx } = setup();
    for (const reason of [undefined, "", "   "]) {
      expect(await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason })).toEqual({ kind: "invalid_reason", error: "REASON_REQUIRED" });
    }
    expect(state.requests).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("refuses everyone who is not the Chief of that village, and audits the attempt", async () => {
    for (const actor of ["admin", "villager", "chief2", "nobody"]) {
      const { state, tx } = setup();
      expect(await submitDeactivationRequestInTx(tx, { actorUserId: actor, villageId: "v1", reason: "x" })).toEqual({ kind: "forbidden" });
      expect(state.requests).toHaveLength(0);
      expect(lastAudit(state)).toMatchObject({ actionType: "CREATE", metadata: { outcome: "BLOCKED", blockReason: "FORBIDDEN" } });
    }
  });

  it("refuses a Chief whose membership is not ACTIVE", async () => {
    const { state, tx } = setup();
    state.users.set("chief1", { id: "chief1", role: "CHIEF", villageId: "v1", membershipStatus: "REMOVED" });
    expect((await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "x" })).kind).toBe("forbidden");
  });

  it("rejects a second unresolved request (PENDING, then APPROVED)", async () => {
    const ctx = await approved();
    expect(await submitDeactivationRequestInTx(ctx.tx, { actorUserId: "chief1", villageId: "v1", reason: "again" })).toEqual({ kind: "blocked", reason: "UNRESOLVED_REQUEST_EXISTS", cooldownEndsAt: undefined });

    const p = setup();
    await submitDeactivationRequestInTx(p.tx, { actorUserId: "chief1", villageId: "v1", reason: "one" });
    expect((await submitDeactivationRequestInTx(p.tx, { actorUserId: "chief1", villageId: "v1", reason: "two" })).kind).toBe("blocked");
    expect(p.state.requests).toHaveLength(1);
  });

  it("refuses a SUSPENDED or missing village", async () => {
    const { tx } = setup("SUSPENDED");
    expect(await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "x" })).toMatchObject({ kind: "blocked", reason: "VILLAGE_NOT_ACTIVE" });
  });

  it("enforces the cooldown after a rejection, audits it, then allows resubmission", async () => {
    const { state, tx } = setup();
    const first = await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "one" });
    if (first.kind !== "created") throw new Error("setup");
    await rejectDeactivationRequestInTx(tx, { requestId: first.requestId, actorUserId: "admin", reason: "no", cooldownMs: 24 * HOUR, now: T0 });

    state.clock = at(23);
    const blocked = await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "two" });
    expect(blocked).toEqual({ kind: "blocked", reason: "COOLDOWN_ACTIVE", cooldownEndsAt: at(24) });
    expect(lastAudit(state)).toMatchObject({ metadata: { outcome: "BLOCKED", blockReason: "COOLDOWN_ACTIVE", cooldownEndsAt: at(24).toISOString() } });

    state.clock = at(24);
    expect((await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "two" })).kind).toBe("created");
  });

  it("does not apply the cooldown after a cancelled request", async () => {
    const ctx = await approved();
    await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "changed", now: at(1) });
    ctx.state.clock = at(2);
    expect((await submitDeactivationRequestInTx(ctx.tx, { actorUserId: "chief1", villageId: "v1", reason: "later" })).kind).toBe("created");
  });
});

describe("approveDeactivationRequestInTx", () => {
  it("stores approver, approvedAt and a deadline exactly 24h later, atomically, and never changes the village status", async () => {
    const { state, tx, requestId } = await approved(0);
    expect(state.requests[0]).toMatchObject({ id: requestId, status: "APPROVED", approvedByUserId: "admin", approvedAt: T0, scheduledDeactivationAt: at(24) });
    expect(state.villages.get("v1")?.status).toBe("ACTIVE");
    expect(state.calls).not.toContain("village.updateMany");
    // village lock is taken before the request is written
    expect(state.calls.indexOf("lockVillage")).toBeLessThan(state.calls.indexOf("request.updateMany"));
    void tx;
  });

  it("writes a request audit entry and a village read-only-on entry", async () => {
    const { state } = await approved(0);
    const entries = state.audits.slice(-2);
    expect(entries[0]).toMatchObject({ actionType: "APPROVE", entityType: "DEACTIVATION_REQUEST", metadata: { outcome: "SUCCESS", scheduledDeactivationAt: at(24).toISOString() } });
    expect(entries[1]).toMatchObject({ actionType: "UPDATE", entityType: "VILLAGE", entityId: "v1", metadata: { readOnly: true } });
  });

  it("is refused for anyone but a System Admin, with an audit entry", async () => {
    const { state, tx } = setup();
    const s = await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "x" });
    if (s.kind !== "created") throw new Error("setup");
    expect(await approveDeactivationRequestInTx(tx, { requestId: s.requestId, actorUserId: "chief1", now: T0 })).toEqual({ kind: "forbidden" });
    expect(state.requests[0].status).toBe("PENDING");
    expect(lastAudit(state)).toMatchObject({ actionType: "APPROVE", metadata: { outcome: "BLOCKED", blockReason: "FORBIDDEN" } });
  });

  it("a second approval and an approval after rejection are refused as NOT_PENDING", async () => {
    const ctx = await approved(0);
    expect(await approveDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "admin", now: at(1) })).toEqual({ kind: "blocked", reason: "NOT_PENDING" });
    expect(ctx.state.requests[0].scheduledDeactivationAt).toEqual(at(24));
  });

  it("is refused while the village is SUSPENDED", async () => {
    const { state, tx } = setup("SUSPENDED");
    state.requests.push({ id: "r1", villageId: "v1", status: "PENDING", scheduledDeactivationAt: null });
    expect(await approveDeactivationRequestInTx(tx, { requestId: "r1", actorUserId: "admin", now: T0 })).toEqual({ kind: "blocked", reason: "VILLAGE_NOT_ACTIVE" });
    expect(state.requests[0].status).toBe("PENDING");
  });

  it("reports an unknown request as not found", async () => {
    const { tx } = setup();
    expect(await approveDeactivationRequestInTx(tx, { requestId: "nope", actorUserId: "admin" })).toEqual({ kind: "not_found" });
  });
});

describe("rejectDeactivationRequestInTx", () => {
  it("records decision-maker, time, reason and the cooldown end; the village stays ACTIVE", async () => {
    const { state, tx } = setup();
    const s = await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "x" });
    if (s.kind !== "created") throw new Error("setup");
    const out = await rejectDeactivationRequestInTx(tx, { requestId: s.requestId, actorUserId: "admin", reason: " Not now ", cooldownMs: 24 * HOUR, now: T0 });

    expect(out).toMatchObject({ kind: "rejected", cooldownEndsAt: at(24) });
    expect(state.requests[0]).toMatchObject({ status: "REJECTED", rejectedByUserId: "admin", rejectedAt: T0, rejectionReason: "Not now", cooldownEndsAt: at(24) });
    expect(state.villages.get("v1")?.status).toBe("ACTIVE");
    expect(lastAudit(state)).toMatchObject({ actionType: "REJECT", metadata: { rejectionReason: "Not now", cooldownEndsAt: at(24).toISOString() } });
  });

  it("requires a reason", async () => {
    const { state, tx } = setup();
    const s = await submitDeactivationRequestInTx(tx, { actorUserId: "chief1", villageId: "v1", reason: "x" });
    if (s.kind !== "created") throw new Error("setup");
    expect(await rejectDeactivationRequestInTx(tx, { requestId: s.requestId, actorUserId: "admin", reason: " ", cooldownMs: HOUR })).toEqual({ kind: "invalid_reason", error: "REASON_REQUIRED" });
    expect(state.requests[0].status).toBe("PENDING");
  });

  it("only a System Admin, and only a PENDING request", async () => {
    const ctx = await approved(0);
    expect(await rejectDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "admin", reason: "no", cooldownMs: HOUR })).toEqual({ kind: "blocked", reason: "NOT_PENDING" });
    expect(await rejectDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", reason: "no", cooldownMs: HOUR })).toEqual({ kind: "forbidden" });
  });
});

describe("cancelDeactivationRequestInTx", () => {
  it("cancels before the deadline, records Chief/time/reason, and does not change the village status", async () => {
    const ctx = await approved(0);
    const out = await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: " Changed our mind ", now: at(23) });

    expect(out).toMatchObject({ kind: "cancelled", cancelledAt: at(23) });
    expect(ctx.state.requests[0]).toMatchObject({ status: "CANCELLED", cancelledByUserId: "chief1", cancelledAt: at(23), cancellationReason: "Changed our mind" });
    expect(ctx.state.villages.get("v1")?.status).toBe("ACTIVE");
    expect(ctx.state.calls).not.toContain("village.updateMany");
    expect(ctx.state.audits.slice(-2).map((a) => [a.actionType, a.entityType])).toEqual([["CANCEL", "DEACTIVATION_REQUEST"], ["UPDATE", "VILLAGE"]]);
    expect(lastAudit(ctx.state)).toMatchObject({ metadata: { readOnly: false } });
  });

  it("an independently SUSPENDED village stays SUSPENDED after cancellation", async () => {
    const ctx = await approved(0);
    ctx.state.villages.get("v1")!.status = "SUSPENDED";
    expect((await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "x", now: at(1) })).kind).toBe("cancelled");
    expect(ctx.state.villages.get("v1")?.status).toBe("SUSPENDED");
  });

  it("is refused at the deadline and after it, with an audit entry", async () => {
    for (const hours of [24, 30]) {
      const ctx = await approved(0);
      expect(await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "late", now: at(hours) })).toEqual({ kind: "blocked", reason: "DEADLINE_REACHED" });
      expect(ctx.state.requests[0].status).toBe("APPROVED");
      expect(lastAudit(ctx.state)).toMatchObject({ actionType: "CANCEL", metadata: { outcome: "BLOCKED", blockReason: "DEADLINE_REACHED" } });
    }
  });

  it("requires a reason", async () => {
    const ctx = await approved(0);
    expect(await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "", now: at(1) })).toEqual({ kind: "invalid_reason", error: "REASON_REQUIRED" });
    expect(ctx.state.requests[0].status).toBe("APPROVED");
  });

  it("only the Chief of that village; another village's request is not found; admins cannot cancel", async () => {
    const ctx = await approved(0);
    for (const actor of ["admin", "villager"]) {
      expect(await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: actor, villageId: "v1", reason: "x", now: at(1) })).toEqual({ kind: "forbidden" });
    }
    expect(await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief2", villageId: "v2", reason: "x", now: at(1) })).toEqual({ kind: "not_found" });
    expect(ctx.state.requests[0].status).toBe("APPROVED");
  });

  it("a cancelled request cannot be cancelled or reused", async () => {
    const ctx = await approved(0);
    await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "x", now: at(1) });
    expect(await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "x", now: at(2) })).toEqual({ kind: "blocked", reason: "NOT_APPROVED" });
    expect(await approveDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "admin", now: at(2) })).toEqual({ kind: "blocked", reason: "NOT_PENDING" });
  });
});

describe("completeDeactivationRequestInTx", () => {
  it("does nothing before the deadline", async () => {
    const ctx = await approved(0);
    expect(await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(23.99) })).toEqual({ kind: "blocked", reason: "NOT_DUE" });
    expect(ctx.state.villages.get("v1")?.status).toBe("ACTIVE");
    expect(ctx.state.requests[0].status).toBe("APPROVED");
  });

  it("at the deadline deactivates the village, completes the request and audits both atomically", async () => {
    const ctx = await approved(0);
    const out = await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(24) });

    expect(out).toMatchObject({ kind: "completed", completedAt: at(24), previousVillageStatus: "ACTIVE" });
    expect(ctx.state.villages.get("v1")?.status).toBe("DEACTIVATED");
    expect(ctx.state.requests[0]).toMatchObject({ status: "COMPLETED", completedAt: at(24), completedBy: "SYSTEM:deactivation-worker", scheduledDeactivationAt: at(24) });
    expect(ctx.state.audits.slice(-2).map((a) => [a.actionType, a.entityType, a.actorUserId])).toEqual([["COMPLETE", "DEACTIVATION_REQUEST", null], ["STATUS_CHANGE", "VILLAGE", null]]);
  });

  it("an overdue request after downtime is completed with the actual time; the deadline is not recalculated", async () => {
    const ctx = await approved(0);
    await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(100) });
    expect(ctx.state.requests[0]).toMatchObject({ completedAt: at(100), scheduledDeactivationAt: at(24) });
  });

  it("completes a SUSPENDED village too", async () => {
    const ctx = await approved(0);
    ctx.state.villages.get("v1")!.status = "SUSPENDED";
    const out = await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(25) });
    expect(out).toMatchObject({ kind: "completed", previousVillageStatus: "SUSPENDED" });
  });

  it("is idempotent: a second run changes nothing and writes no audit entries", async () => {
    const ctx = await approved(0);
    await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(24) });
    const audits = ctx.state.audits.length;
    expect(await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(25) })).toEqual({ kind: "blocked", reason: "NOT_APPROVED" });
    expect(ctx.state.audits).toHaveLength(audits);
    expect(ctx.state.requests[0].completedAt).toEqual(at(24));
  });

  it("never completes a cancelled request", async () => {
    const ctx = await approved(0);
    await cancelDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, actorUserId: "chief1", villageId: "v1", reason: "x", now: at(1) });
    expect(await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(30) })).toEqual({ kind: "blocked", reason: "NOT_APPROVED" });
    expect(ctx.state.villages.get("v1")?.status).toBe("ACTIVE");
  });

  it("takes the village lock before writing, like approve and cancel", async () => {
    const ctx = await approved(0);
    ctx.state.calls.length = 0;
    await completeDeactivationRequestInTx(ctx.tx, { requestId: ctx.requestId, now: at(24) });
    expect(ctx.state.calls[0]).toBe("scopeVillage");
    expect(ctx.state.calls[1]).toBe("lockVillage");
  });

  it("reports an unknown request as not found", async () => {
    const { tx } = setup();
    expect(await completeDeactivationRequestInTx(tx, { requestId: "nope", now: T0 })).toEqual({ kind: "not_found" });
  });

  it("refuses due completion when an ACTIVE Fund exists, before terminal or audit writes", async () => {
    const ctx = await approved(0);
    const base = createFakeTx(ctx.state);
    const requestBefore = { ...ctx.state.requests[0] };
    const auditsBefore = [...ctx.state.audits];
    const requestWrite = vi.spyOn(base.villageDeactivationRequest, "updateMany");
    const villageWrite = vi.spyOn(base.village, "updateMany");
    const auditWrite = vi.spyOn(base.auditLog, "create");
    const count = vi.fn().mockResolvedValue(1);
    // Controlled client only: APPROVED + ACTIVE cannot be committed under the
    // real constraints. Keep the real completion body and its Fund-lock path.
    const tx = {
      ...base,
      fund: { findMany: vi.fn().mockResolvedValue([{ id: "fund", villageId: "v1" }]), count },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join("").includes('FROM public."Fund"')) {
          return [{ id: "fund", villageId: "v1", status: "ACTIVE", termsVersion: 2 }];
        }
        return base.$queryRaw(strings, ...values);
      },
    };

    expect(await completeDeactivationRequestInTx(tx as never, { requestId: ctx.requestId, now: at(24) }))
      .toEqual({ kind: "blocked", reason: "ACTIVE_FUND_EXISTS" });
    expect(count).toHaveBeenCalledWith({ where: { villageId: "v1", status: "ACTIVE" } });
    expect(requestWrite).not.toHaveBeenCalled();
    expect(villageWrite).not.toHaveBeenCalled();
    expect(auditWrite).not.toHaveBeenCalled();
    expect(ctx.state.requests[0]).toEqual(requestBefore);
    expect(ctx.state.villages.get("v1")?.status).toBe("ACTIVE");
    expect(ctx.state.audits).toEqual(auditsBefore);
  });
});

describe("cancel and complete are exclusive at the deadline", () => {
  it("whichever runs first wins; the other is refused and the state is consistent", async () => {
    // Cancel first (one instant before the deadline), then complete at the deadline.
    const a = await approved(0);
    await cancelDeactivationRequestInTx(a.tx, { requestId: a.requestId, actorUserId: "chief1", villageId: "v1", reason: "x", now: new Date(at(24).getTime() - 1) });
    await completeDeactivationRequestInTx(a.tx, { requestId: a.requestId, now: at(24) });
    expect([a.state.requests[0].status, a.state.villages.get("v1")?.status]).toEqual(["CANCELLED", "ACTIVE"]);

    // Complete first at the deadline, then a cancel at the same instant.
    const b = await approved(0);
    await completeDeactivationRequestInTx(b.tx, { requestId: b.requestId, now: at(24) });
    await cancelDeactivationRequestInTx(b.tx, { requestId: b.requestId, actorUserId: "chief1", villageId: "v1", reason: "x", now: at(24) });
    expect([b.state.requests[0].status, b.state.villages.get("v1")?.status]).toEqual(["COMPLETED", "DEACTIVATED"]);
  });
});

// This legacy suite isolates state-machine behavior. Session/row-lock authority
// is exercised through the actual helper in lifecycle-authority tests.
vi.mock("@/features/village-management/lib/lifecycle-authority", () => ({
  hasLifecycleAuthority: async (tx: import("@prisma/client").Prisma.TransactionClient, id: string, role: string, villageId?: string) => {
    const actor = await tx.user.findUnique({ where: { id } });
    return Boolean(actor && actor.role === role && (role === "SYSTEM_ADMIN" || (actor.villageId === villageId && actor.membershipStatus === "ACTIVE")));
  },
}));
