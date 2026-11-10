import { describe, expect, it } from "vitest";
import { AuditActionType, MembershipStatus, type Prisma } from "@prisma/client";

import {
  MEMBER_REMOVED_REASON,
  REMOVE_MEMBER_ERROR,
  removeMemberAndDeactivateAssignments,
} from "./remove-member-transaction";

type Row = Record<string, unknown>;

interface FakeData {
  houses: Row[];
  users: Row[];
  assignments: Row[];
  audits: Row[];
}

interface FakeOptions {
  // Called right before each assignment updateMany (simulates a concurrent
  // request changing the row between the read and the write).
  beforeAssignmentUpdate?: (data: FakeData, where: Row) => void;
  // Forces the assignment updateMany to report this count.
  assignmentUpdateCount?: number;
  // 1-based index of the auditLog.create call that should throw.
  failAuditAtCall?: number;
}

const ACTOR = "user-head";
const TARGET = "user-member";
const OTHER_MEMBER = "user-other";
const HOUSE = "house-1";
const VILLAGE = "village-1";
const OTHER_VILLAGE = "village-2";
const CURRENT_PERIOD = { year: 2026, month: 10 };

const USER_NAMES: Record<string, string> = {
  [ACTOR]: "Head",
  [TARGET]: "Member",
  [OTHER_MEMBER]: "Other",
};

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function createData(overrides: Partial<FakeData> = {}): FakeData {
  return {
    houses: [
      {
        id: HOUSE,
        villageId: VILLAGE,
        isActive: true,
        headOfHouseId: ACTOR,
      },
    ],
    users: [
      {
        id: ACTOR,
        houseId: HOUSE,
        villageId: VILLAGE,
        membershipStatus: MembershipStatus.ACTIVE,
      },
      {
        id: TARGET,
        houseId: HOUSE,
        villageId: VILLAGE,
        membershipStatus: MembershipStatus.ACTIVE,
      },
    ],
    assignments: [
      assignment("a-past-old", TARGET, 2025, 12),
      assignment("a-past", TARGET, 2026, 9),
      assignment("a-current", TARGET, 2026, 10),
      assignment("a-upcoming", TARGET, 2026, 11),
      assignment("a-upcoming-next-year", TARGET, 2027, 1),
    ],
    audits: [],
    ...overrides,
  };
}

function assignment(
  id: string,
  userId: string,
  year: number,
  month: number,
  extra: Row = {},
): Row {
  return {
    id,
    villageId: VILLAGE,
    userId,
    year,
    month,
    isActive: true,
    ...extra,
  };
}

// Minimal in-memory stand-in for Prisma.TransactionClient. It supports only
// what removeMemberAndDeactivateAssignments uses.
function createFakeTx(state: { data: FakeData }, options: FakeOptions = {}) {
  let auditCalls = 0;

  const tx = {
    house: {
      findFirst: async ({ where }: { where: Row }) => {
        const row = state.data.houses.find((house) => matches(house, where));
        return row ? { id: row.id } : null;
      },
    },
    user: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.data.users.filter((user) => matches(user, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    collectorAssignment: {
      findMany: async ({ where }: { where: Row }) =>
        state.data.assignments
          .filter((row) => matches(row, where))
          .map((row) => ({
            id: row.id,
            year: row.year,
            month: row.month,
            user: { name: USER_NAMES[row.userId as string] ?? "Unknown" },
          }))
          .sort(
            (a, b) =>
              (a.year as number) - (b.year as number) ||
              (a.month as number) - (b.month as number),
          ),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        options.beforeAssignmentUpdate?.(state.data, where);

        const rows = state.data.assignments.filter((row) =>
          matches(row, where),
        );
        rows.forEach((row) => Object.assign(row, data));

        return { count: options.assignmentUpdateCount ?? rows.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        auditCalls += 1;

        if (options.failAuditAtCall === auditCalls) {
          throw new Error("AUDIT_WRITE_FAILED");
        }

        state.data.audits.push(data);
        return data;
      },
    },
  };

  return tx as unknown as Prisma.TransactionClient;
}

// Mimics a database transaction: on any thrown error every change made by
// the callback is discarded.
async function runInTransaction<T>(
  state: { data: FakeData },
  options: FakeOptions,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const snapshot = structuredClone(state.data);

  try {
    return await callback(createFakeTx(state, options));
  } catch (error) {
    state.data = snapshot;
    throw error;
  }
}

function runRemoval(
  state: { data: FakeData },
  options: FakeOptions = {},
  overrides: Partial<{ actorUserId: string; targetUserId: string }> = {},
) {
  return runInTransaction(state, options, (tx) =>
    removeMemberAndDeactivateAssignments(tx, {
      actorUserId: overrides.actorUserId ?? ACTOR,
      houseId: HOUSE,
      villageId: VILLAGE,
      targetUserId: overrides.targetUserId ?? TARGET,
      currentPeriod: CURRENT_PERIOD,
    }),
  );
}

function findAssignment(state: { data: FakeData }, id: string): Row {
  const row = state.data.assignments.find((item) => item.id === id);
  if (!row) {
    throw new Error(`Missing assignment ${id}`);
  }
  return row;
}

function findUser(state: { data: FakeData }, id: string): Row {
  const row = state.data.users.find((item) => item.id === id);
  if (!row) {
    throw new Error(`Missing user ${id}`);
  }
  return row;
}

describe("removeMemberAndDeactivateAssignments", () => {
  it("removes the member and deactivates current and upcoming assignments", async () => {
    const state = { data: createData() };

    const result = await runRemoval(state);

    expect(findUser(state, TARGET).membershipStatus).toBe(
      MembershipStatus.REMOVED,
    );
    expect(result.deactivatedAssignmentIds).toEqual([
      "a-current",
      "a-upcoming",
      "a-upcoming-next-year",
    ]);
    expect(findAssignment(state, "a-current").isActive).toBe(false);
    expect(findAssignment(state, "a-upcoming").isActive).toBe(false);
    expect(findAssignment(state, "a-upcoming-next-year").isActive).toBe(false);
  });

  it("preserves past-period assignments", async () => {
    const state = { data: createData() };

    await runRemoval(state);

    expect(findAssignment(state, "a-past").isActive).toBe(true);
    expect(findAssignment(state, "a-past-old").isActive).toBe(true);
  });

  it("treats the year boundary correctly (December is past, January is upcoming)", async () => {
    const state = {
      data: createData({
        assignments: [
          assignment("dec-past", TARGET, 2026, 9),
          assignment("jan-upcoming", TARGET, 2027, 1),
        ],
      }),
    };

    const result = await runRemoval(state);

    expect(result.deactivatedAssignmentIds).toEqual(["jan-upcoming"]);
    expect(findAssignment(state, "dec-past").isActive).toBe(true);
  });

  it("writes the member REMOVE audit entry with existing metadata", async () => {
    const state = { data: createData() };

    await runRemoval(state);

    expect(state.data.audits[0]).toMatchObject({
      actionType: AuditActionType.REMOVE,
      entityType: "USER",
      entityId: TARGET,
      villageId: VILLAGE,
      actorUserId: ACTOR,
      metadata: {
        previousMembershipStatus: MembershipStatus.ACTIVE,
        newMembershipStatus: MembershipStatus.REMOVED,
        houseId: HOUSE,
      },
    });
  });

  it("writes one STATUS_CHANGE audit entry per deactivated assignment", async () => {
    const state = { data: createData() };

    await runRemoval(state);

    const assignmentAudits = state.data.audits.filter(
      (audit) => audit.entityType === "COLLECTOR_ASSIGNMENT",
    );

    expect(assignmentAudits).toHaveLength(3);
    expect(assignmentAudits.map((audit) => audit.entityId)).toEqual([
      "a-current",
      "a-upcoming",
      "a-upcoming-next-year",
    ]);

    expect(assignmentAudits[0]).toEqual({
      actionType: AuditActionType.STATUS_CHANGE,
      entityType: "COLLECTOR_ASSIGNMENT",
      entityId: "a-current",
      villageId: VILLAGE,
      actorUserId: ACTOR,
      metadata: {
        year: 2026,
        month: 10,
        isActive: false,
        assignedUserId: TARGET,
        assignedUserName: "Member",
        reason: MEMBER_REMOVED_REASON,
      },
    });

    // 1 member entry + 3 assignment entries; nothing for past periods.
    expect(state.data.audits).toHaveLength(4);
  });

  it("does not touch other users' or other villages' assignments", async () => {
    const state = {
      data: createData({
        assignments: [
          assignment("target-current", TARGET, 2026, 10),
          assignment("other-user-current", OTHER_MEMBER, 2026, 10),
          assignment("other-village-current", TARGET, 2026, 10, {
            villageId: OTHER_VILLAGE,
          }),
        ],
      }),
    };

    await runRemoval(state);

    expect(findAssignment(state, "target-current").isActive).toBe(false);
    expect(findAssignment(state, "other-user-current").isActive).toBe(true);
    expect(findAssignment(state, "other-village-current").isActive).toBe(true);
  });

  it("only removes the member when there are no assignments", async () => {
    const state = { data: createData({ assignments: [] }) };

    const result = await runRemoval(state);

    expect(result.deactivatedAssignmentIds).toEqual([]);
    expect(findUser(state, TARGET).membershipStatus).toBe(
      MembershipStatus.REMOVED,
    );
    expect(state.data.audits).toHaveLength(1);
  });

  it("skips an assignment that was already deactivated concurrently, without a duplicate audit", async () => {
    const state = { data: createData() };

    const result = await runRemoval(state, {
      beforeAssignmentUpdate: (data, where) => {
        if (where.id === "a-current") {
          const row = data.assignments.find((item) => item.id === "a-current");
          if (row) {
            row.isActive = false;
          }
        }
      },
    });

    expect(result.deactivatedAssignmentIds).toEqual([
      "a-upcoming",
      "a-upcoming-next-year",
    ]);
    expect(findUser(state, TARGET).membershipStatus).toBe(
      MembershipStatus.REMOVED,
    );
    expect(findAssignment(state, "a-current").isActive).toBe(false);

    const auditedIds = state.data.audits
      .filter((audit) => audit.entityType === "COLLECTOR_ASSIGNMENT")
      .map((audit) => audit.entityId);
    expect(auditedIds).toEqual(["a-upcoming", "a-upcoming-next-year"]);
  });

  it("rolls everything back when an audit write fails", async () => {
    const state = { data: createData() };
    const before = structuredClone(state.data);

    // Call 1 = member audit, call 2 = first assignment, call 3 = second.
    await expect(runRemoval(state, { failAuditAtCall: 3 })).rejects.toThrow(
      "AUDIT_WRITE_FAILED",
    );

    expect(state.data).toEqual(before);
    expect(findUser(state, TARGET).membershipStatus).toBe(
      MembershipStatus.ACTIVE,
    );
    expect(findAssignment(state, "a-current").isActive).toBe(true);
    expect(state.data.audits).toHaveLength(0);
  });

  it("rolls back when an assignment update reports an unexpected count", async () => {
    const state = { data: createData() };
    const before = structuredClone(state.data);

    await expect(
      runRemoval(state, { assignmentUpdateCount: 2 }),
    ).rejects.toThrow(REMOVE_MEMBER_ERROR.UNEXPECTED_ASSIGNMENT_UPDATE_COUNT);

    expect(state.data).toEqual(before);
  });

  it("fails and changes nothing when the member is no longer ACTIVE", async () => {
    const state = { data: createData() };
    findUser(state, TARGET).membershipStatus = MembershipStatus.REMOVED;
    const before = structuredClone(state.data);

    await expect(runRemoval(state)).rejects.toThrow(
      REMOVE_MEMBER_ERROR.TARGET_NOT_REMOVABLE,
    );

    expect(state.data).toEqual(before);
    expect(state.data.audits).toHaveLength(0);
  });

  it("fails when the actor is no longer head of the house", async () => {
    const state = { data: createData() };
    state.data.houses[0].headOfHouseId = OTHER_MEMBER;
    const before = structuredClone(state.data);

    await expect(runRemoval(state)).rejects.toThrow(
      REMOVE_MEMBER_ERROR.HEAD_AUTHORITY_CHANGED,
    );

    expect(state.data).toEqual(before);
  });

  it("fails when the house is inactive", async () => {
    const state = { data: createData() };
    state.data.houses[0].isActive = false;

    await expect(runRemoval(state)).rejects.toThrow(
      REMOVE_MEMBER_ERROR.HEAD_AUTHORITY_CHANGED,
    );
  });

  it("refuses to remove the actor (the head)", async () => {
    const state = { data: createData() };
    const before = structuredClone(state.data);

    await expect(
      runRemoval(state, {}, { targetUserId: ACTOR }),
    ).rejects.toThrow(REMOVE_MEMBER_ERROR.TARGET_NOT_REMOVABLE);

    expect(state.data).toEqual(before);
  });
});
