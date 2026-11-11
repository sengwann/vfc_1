/*
 * In-memory stand-in for the Prisma transaction client, covering exactly what
 * the deactivation transitions use. It lets the transition logic be unit tested
 * without a database. It cannot test locking or isolation; the integration
 * tests against a real PostgreSQL do that.
 */

type Row = Record<string, unknown>;

export interface FakeState {
  clock: Date;
  users: Map<string, Row>;
  villages: Map<string, { status: string; rowVersion: number }>;
  requests: Row[];
  audits: Row[];
  calls: string[];
}

export function createFakeState(clock: Date): FakeState {
  return {
    clock,
    users: new Map(),
    villages: new Map(),
    requests: [],
    audits: [],
    calls: [],
  };
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];

    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as Record<string, unknown>;

      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("gt" in c) return value instanceof Date && value.getTime() > (c.gt as Date).getTime();
      if ("lte" in c) return value instanceof Date && value.getTime() <= (c.lte as Date).getTime();

      throw new Error(`fake tx: unsupported condition for ${key}`);
    }

    return value === condition;
  });
}

let nextId = 1;

export function createFakeTx(state: FakeState) {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");

      if (sql.includes("clock_timestamp")) {
        return [{ now: state.clock }];
      }

      if (sql.includes("vfc_acquire_villages")) { state.calls.push("scopeVillage"); return []; }
      const villageId = values[0] as string;
      const village = state.villages.get(villageId);

      if (sql.includes('UPDATE "Village"')) {
        state.calls.push("lockVillage");
        if (!village) return [];
        village.rowVersion += 1;
        return [{ status: village.status }];
      }

      if (sql.includes("FOR SHARE")) {
        state.calls.push("shareVillage");
        return village ? [{ status: village.status }] : [];
      }

      throw new Error(`fake tx: unexpected SQL: ${sql}`);
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.users.get(where.id) ?? null,
    },
    fund: { findMany: async () => [], count: async () => 0 },
    village: {
      findUnique: async ({ where }: { where: { id: string } }) => state.villages.get(where.id) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        state.calls.push("village.updateMany");
        const village = state.villages.get(where.id as string);

        if (!village || !matches({ status: village.status }, { status: where.status })) {
          return { count: 0 };
        }

        Object.assign(village, data);
        return { count: 1 };
      },
    },
    villageDeactivationRequest: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.requests.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: { where: Row }) =>
        state.requests.filter((row) => matches(row, where)),
      create: async ({ data }: { data: Row }) => {
        const row: Row = {
          id: `req-${nextId++}`,
          status: "PENDING",
          cooldownEndsAt: null,
          scheduledDeactivationAt: null,
          ...data,
        };
        state.requests.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        state.calls.push("request.updateMany");
        const rows = state.requests.filter((row) => matches(row, where));

        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        state.audits.push(data);
        return data;
      },
    },
  };
}
