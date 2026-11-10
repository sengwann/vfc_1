type ErrorRecord = Record<string, unknown>;

export interface DatabaseErrorDetails {
  sqlStates: readonly string[];
  prismaCodes: readonly string[];
  constraints: readonly string[];
  retryable: boolean;
}

function record(value: unknown): ErrorRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as ErrorRecord)
    : undefined;
}

/** Inspect known error envelopes only; never search messages or arbitrary data. */
export function inspectDatabaseError(error: unknown): DatabaseErrorDetails {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const sqlStates = new Set<string>();
  const prismaCodes = new Set<string>();
  const constraints = new Set<string>();
  let adapterConflict = false;
  let unrecognizedCode = false;
  for (let count = 0; pending.length > 0 && count < 32; count += 1) {
    const node = record(pending.shift());
    if (!node || seen.has(node)) continue;
    seen.add(node);
    for (const key of ["code", "sqlState", "sqlstate", "originalCode"]) {
      const code = node[key];
      if (typeof code !== "string") continue;
      // PostgreSQL P0001 is a SQLSTATE, not a Prisma P1xxx/P2xxx code.
      if (/^[0-9A-Z]{5}$/.test(code) && !/^P[12]\d{3}$/.test(code)) sqlStates.add(code);
      if (/^P[12]\d{3}$/.test(code) && key === "code") prismaCodes.add(code);
      if (!/^[0-9A-Z]{5}$/.test(code)) unrecognizedCode = true;
    }
    if (typeof node.constraint === "string") constraints.add(node.constraint);
    const meta = record(node.meta);
    const cause = record(node.cause);
    if (
      (node.name === "DriverAdapterError" && cause?.kind === "TransactionWriteConflict") ||
      record(record(meta?.driverAdapterError)?.cause)?.kind === "TransactionWriteConflict"
    ) adapterConflict = true;
    pending.push(node.cause, meta?.driverAdapterError, node.originalError);
    // P2010 exposes its raw-query SQLSTATE in meta.code.
    if (node.code === "P2010") pending.push(meta);
  }
  const retryStates = new Set(["40001", "40P01"]);
  const hasOtherState = [...sqlStates].some((code) => !retryStates.has(code));
  const hasOtherPrismaCode = [...prismaCodes].some(
    (code) => code !== "P2034" && code !== "P2010",
  );
  const incomplete = pending.some((value) => {
    const node = record(value);
    return node !== undefined && !seen.has(node);
  });
  return {
    sqlStates: [...sqlStates],
    prismaCodes: [...prismaCodes],
    constraints: [...constraints],
    // Conflicting explicit diagnostics fail closed, even under a retry wrapper.
    retryable: !incomplete && !unrecognizedCode && !hasOtherState && !hasOtherPrismaCode && (
      [...sqlStates].some((code) => retryStates.has(code)) ||
      prismaCodes.has("P2034") || adapterConflict
    ),
  };
}
