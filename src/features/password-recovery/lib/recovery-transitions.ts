/*
 * Password recovery transitions, each as one function that runs INSIDE a
 * transaction supplied by the caller (password-recovery-service.ts opens the
 * Serializable transaction and retries it). Same layout as
 * deactivation-transitions.ts, and for the same reasons: they can be tested
 * with a real or fake client, and every rule lives in one place.
 *
 * What every function here does:
 *  - re-reads the actor and the target from the database (the session can be
 *    stale) and works out authority again with evaluateAuthority;
 *  - uses the DATABASE clock (readDatabaseNow), never a browser or process timer;
 *  - writes each status change as UPDATE ... WHERE id = ? AND status = <what it
 *    read>, so two racing requests cannot both win, and checks the row count;
 *  - writes its audit entry in the same transaction;
 *  - RETURNS an outcome instead of throwing for an expected result, so the
 *    audit entries and the lazy expiry written for a refused action commit.
 *
 * Expiry is lazy: nothing sweeps the table. A request that ran out of time is
 * marked EXPIRED the next time anything touches it (here: an approver acting on
 * it, a member filing a new request, or a member using the code).
 *
 * SECRETS: the raw reset code exists only as the return value of
 * issueRecoveryCodeInTx and in the member's submitted form. It is never stored,
 * never written to an audit entry, a notification or a log. Only its HMAC is
 * stored (recovery-code.ts).
 */

import { AuditActionType } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import type { RecoveryAuditMetadata } from "../../../lib/audit";
import { readDatabaseNow } from "../../village-deactivation/lib/deactivation-transitions";
import {
  evaluateAuthority,
  type AuthorityActor,
} from "./recovery-authority";
import { RECOVERY_MAX_ISSUES_PER_APPROVER_PER_HOUR } from "./recovery-config";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
} from "./recovery-code";
import type { RecoveryRequestInput } from "./recovery-input";
import { syncRecoveryNotifications } from "./recovery-notifications";
import {
  computeCodeExpiresAt,
  computeRequestExpiresAt,
  evaluateFailedRedeem,
  evaluateIssue,
  evaluateNewRequest,
  evaluateRedeem,
  evaluateReject,
  evaluateWithdraw,
  isExpiryDue,
  normalizeRecoveryNote,
  type NoteResult,
  type RecoveryMembershipStatus,
  type RecoveryRefusal,
  type RecoveryRole,
  type RecoveryStatus,
  type RecoveryTarget,
  type RecoveryVillageStatus,
} from "./recovery-rules";

type Tx = Prisma.TransactionClient;

const ACTIVE_STATUSES: RecoveryStatus[] = ["PENDING", "CODE_ISSUED"];
const ONE_HOUR_MS = 60 * 60 * 1000;

/* ---------------------------------------------------------------- helpers */

async function audit(
  tx: Tx,
  input: {
    actionType: AuditActionType;
    entityId: string | null;
    villageId: string | null;
    actorUserId: string | null;
    metadata: RecoveryAuditMetadata;
  },
): Promise<void> {
  await createAuditLog(tx, {
    actionType: input.actionType,
    entityType: AuditEntityType.PASSWORD_RECOVERY_REQUEST,
    entityId: input.entityId,
    villageId: input.villageId,
    actorUserId: input.actorUserId,
    metadata: input.metadata as Prisma.InputJsonValue,
  });
}

interface RequestRow {
  id: string;
  userId: string;
  villageId: string | null;
  status: RecoveryStatus;
  requestExpiresAt: Date;
  codeExpiresAt: Date | null;
  codeHash: string | null;
  codeIssuedByUserId: string | null;
  issueCount: number;
  failedRedeemAttempts: number;
}

const REQUEST_SELECT = {
  id: true,
  userId: true,
  villageId: true,
  status: true,
  requestExpiresAt: true,
  codeExpiresAt: true,
  codeHash: true,
  codeIssuedByUserId: true,
  issueCount: true,
  failedRedeemAttempts: true,
} satisfies Prisma.PasswordRecoveryRequestSelect;

/**
 * Finds the account a public form names, exactly the way sign-in does. Email
 * and phone are only unique inside one village, so the lookup is always scoped:
 *  - with a village code: that village's own users (never a SYSTEM_ADMIN);
 *  - without one: platform administrators only (SYSTEM_ADMIN, no village).
 * Also used by the service to build the throttle identity.
 */
export function findRecoveryAccount(
  client: Pick<Tx, "user">,
  input: RecoveryRequestInput,
): Promise<{ id: string } | null> {
  const identifierWhere =
    input.identifier.type === "email"
      ? { email: input.identifier.value }
      : { phone: input.identifier.value };

  return client.user.findFirst({
    where: input.villageCode
      ? {
          ...identifierWhere,
          role: { not: "SYSTEM_ADMIN" },
          village: { is: { villageCode: input.villageCode } },
        }
      : { ...identifierWhere, role: "SYSTEM_ADMIN", villageId: null },
    select: { id: true },
  });
}

interface TargetFacts extends RecoveryTarget {
  id: string;
  name: string;
  villageId: string | null;
}

/** The account being recovered, read fresh, with what evaluateTarget needs. */
async function loadTargetFacts(
  tx: Tx,
  userId: string,
): Promise<TargetFacts | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      villageId: true,
      membershipStatus: true,
      village: { select: { status: true } },
    },
  });

  if (!user) {
    return null;
  }

  const otherSystemAdminCount =
    user.role === "SYSTEM_ADMIN"
      ? await tx.user.count({
          where: { role: "SYSTEM_ADMIN", id: { not: user.id } },
        })
      : 0;

  return {
    id: user.id,
    name: user.name,
    villageId: user.villageId,
    role: user.role as RecoveryRole,
    membershipStatus: user.membershipStatus as RecoveryMembershipStatus | null,
    villageStatus: (user.village?.status as RecoveryVillageStatus | undefined) ?? null,
    otherSystemAdminCount,
  };
}

async function loadActor(
  tx: Tx,
  actorUserId: string,
): Promise<AuthorityActor | null> {
  const user = await tx.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      role: true,
      villageId: true,
      membershipStatus: true,
      village: { select: { status: true } },
    },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    role: user.role as RecoveryRole,
    villageId: user.villageId,
    membershipStatus: user.membershipStatus as RecoveryMembershipStatus | null,
    villageStatus: (user.village?.status as RecoveryVillageStatus | undefined) ?? null,
  };
}

/** Active Chiefs of a village, as requireChief() defines "active". */
function countActiveChiefs(tx: Tx, villageId: string): Promise<number> {
  return tx.user.count({
    where: {
      villageId,
      role: "CHIEF",
      membershipStatus: "ACTIVE",
      village: { is: { status: "ACTIVE" } },
    },
  });
}

/**
 * Loads a request and decides whether this actor may handle it. Anyone who may
 * not (including every actor in another village) gets null, exactly like a
 * request that does not exist, and a refused attempt on a real request is
 * audited.
 */
async function loadAuthorizedRequest(
  tx: Tx,
  input: {
    requestId: string;
    actorUserId: string;
    actionType: AuditActionType;
  },
): Promise<{ request: RequestRow; target: TargetFacts } | null> {
  const request = (await tx.passwordRecoveryRequest.findUnique({
    where: { id: input.requestId },
    select: REQUEST_SELECT,
  })) as RequestRow | null;

  if (!request) {
    return null;
  }

  const [actor, target] = await Promise.all([
    loadActor(tx, input.actorUserId),
    loadTargetFacts(tx, request.userId),
  ]);

  if (!actor || !target) {
    return null;
  }

  const chiefCount =
    target.role === "VILLAGER" && request.villageId
      ? await countActiveChiefs(tx, request.villageId)
      : 0;

  const decision = evaluateAuthority({
    actor,
    target: { id: target.id, role: target.role, villageId: request.villageId },
    activeChiefCountInTargetVillage: chiefCount,
  });

  if (!decision.allowed) {
    await audit(tx, {
      actionType: input.actionType,
      entityId: request.id,
      villageId: request.villageId,
      actorUserId: input.actorUserId,
      metadata: {
        event: "AUTHORITY_REFUSED",
        requestId: request.id,
        outcome: "BLOCKED",
        blockReason: "FORBIDDEN",
      },
    });

    return null;
  }

  return { request, target };
}

/** PENDING/CODE_ISSUED -> EXPIRED. The audit entry is written only by the winner. */
async function writeExpiry(tx: Tx, request: RequestRow, now: Date): Promise<void> {
  const updated = await tx.passwordRecoveryRequest.updateMany({
    where: { id: request.id, status: request.status },
    data: { status: "EXPIRED", expiredAt: now, codeHash: null },
  });

  if (updated.count !== 1) {
    return;
  }

  await audit(tx, {
    actionType: AuditActionType.UPDATE,
    entityId: request.id,
    villageId: request.villageId,
    actorUserId: null,
    metadata: {
      event: "EXPIRED",
      requestId: request.id,
      targetUserId: request.userId,
      previousStatus: request.status,
      newStatus: "EXPIRED",
      outcome: "SUCCESS",
    },
  });
}

/** The system ends a request: the account can no longer take part. */
async function writeSystemRevoke(
  tx: Tx,
  request: RequestRow,
  reason: "TARGET_INELIGIBLE" | "TOO_MANY_ATTEMPTS",
  now: Date,
  failedAttempts?: number,
): Promise<void> {
  const updated = await tx.passwordRecoveryRequest.updateMany({
    where: { id: request.id, status: request.status },
    data: {
      status: "REVOKED",
      revokedAt: now,
      revocationReason: reason,
      codeHash: null,
      ...(failedAttempts === undefined
        ? {}
        : { failedRedeemAttempts: failedAttempts }),
    },
  });

  if (updated.count !== 1) {
    return;
  }

  await audit(tx, {
    actionType: AuditActionType.CANCEL,
    entityId: request.id,
    villageId: request.villageId,
    actorUserId: null,
    metadata: {
      event: "CODE_REVOKED",
      requestId: request.id,
      targetUserId: request.userId,
      previousStatus: request.status,
      newStatus: "REVOKED",
      revocationReason: reason,
      failedAttempts,
      outcome: "SUCCESS",
    },
  });
}

/* ------------------------------------------------------------ file request */

export type FileRequestOutcome =
  | { kind: "created"; requestId: string; villageId: string | null }
  /**
   * Nothing was created: unknown account, ineligible account or a request that
   * is already open. The caller must answer all of these identically.
   */
  | { kind: "ignored" };

/**
 * The public "forgot password" form. The account is looked up the way sign-in
 * looks it up (inside a village, or System Admins only), then eligibility is
 * checked with evaluateNewRequest. A second request while one is open is a
 * silent no-op; an open request that has run out of time is expired first, so
 * the member is never stuck behind a dead one.
 */
export async function fileRecoveryRequestInTx(
  tx: Tx,
  params: RecoveryRequestInput & { clientFingerprint?: string; now?: Date },
): Promise<FileRequestOutcome> {
  const account = await findRecoveryAccount(tx, params);

  if (!account) {
    return { kind: "ignored" };
  }

  const target = await loadTargetFacts(tx, account.id);

  if (!target || !evaluateNewRequest(target).ok) {
    return { kind: "ignored" };
  }

  const now = params.now ?? (await readDatabaseNow(tx));

  const open = (await tx.passwordRecoveryRequest.findFirst({
    where: { userId: target.id, status: { in: ACTIVE_STATUSES } },
    select: REQUEST_SELECT,
  })) as RequestRow | null;

  if (open) {
    if (!isExpiryDue(open, now)) {
      return { kind: "ignored" };
    }

    await writeExpiry(tx, open, now);
  }

  const requestExpiresAt = computeRequestExpiresAt(now);

  const created = await tx.passwordRecoveryRequest.create({
    data: { userId: target.id, villageId: target.villageId, requestExpiresAt },
    select: { id: true },
  });

  await audit(tx, {
    actionType: AuditActionType.CREATE,
    entityId: created.id,
    villageId: target.villageId,
    // Nobody is signed in when a request is filed, so there is no actor.
    actorUserId: null,
    metadata: {
      event: "REQUESTED",
      requestId: created.id,
      targetUserId: target.id,
      requestExpiresAt: requestExpiresAt.toISOString(),
      newStatus: "PENDING",
      outcome: "SUCCESS",
      clientFingerprint: params.clientFingerprint,
    },
  });

  return { kind: "created", requestId: created.id, villageId: target.villageId };
}

/* ------------------------------------------------------------------- issue */

export type IssueOutcome =
  | {
      kind: "issued";
      requestId: string;
      villageId: string | null;
      /** The ONLY place the raw code exists. Show it once; never store or log it. */
      code: string;
      codeExpiresAt: Date;
      issueCount: number;
      reissued: boolean;
    }
  | { kind: "not_found" }
  | { kind: "blocked"; reason: RecoveryRefusal | "RATE_LIMITED" };

/**
 * Issues (or re-issues) a one-time code. The approver's password must already
 * have been verified by the caller (the step-up); this function owns every
 * other rule: authority, the request's state and expiry, the account's
 * eligibility, and the per-approver hourly limit.
 *
 * It takes a request id and nothing that names a user, which is the Pending
 * Request Gate: a code can only ever be created for a request the member filed.
 */
export async function issueRecoveryCodeInTx(
  tx: Tx,
  params: {
    requestId: string;
    actorUserId: string;
    /** AUTH_SECRET (read by the caller, so this file reads no environment). */
    secret: string;
    generateCode?: () => string;
    now?: Date;
  },
): Promise<IssueOutcome> {
  const { requestId, actorUserId } = params;

  const loaded = await loadAuthorizedRequest(tx, {
    requestId,
    actorUserId,
    actionType: AuditActionType.APPROVE,
  });

  if (!loaded) {
    return { kind: "not_found" };
  }

  const { request, target } = loaded;
  const now = params.now ?? (await readDatabaseNow(tx));

  const decision = evaluateIssue({
    request: {
      status: request.status,
      requestExpiresAt: request.requestExpiresAt,
      codeExpiresAt: request.codeExpiresAt,
      targetUserId: request.userId,
    },
    actorUserId,
    target,
    now,
  });

  if (!decision.ok) {
    if (decision.reason === "EXPIRED") {
      await writeExpiry(tx, request, now);
    } else if (decision.reason === "NOT_ELIGIBLE") {
      await writeSystemRevoke(tx, request, "TARGET_INELIGIBLE", now);
    }

    return { kind: "blocked", reason: decision.reason };
  }

  // Counted from the append-only audit log, so re-issues count too.
  const issuedLastHour = await tx.auditLog.count({
    where: {
      actorUserId,
      entityType: AuditEntityType.PASSWORD_RECOVERY_REQUEST,
      actionType: AuditActionType.APPROVE,
      createdAt: { gte: new Date(now.getTime() - ONE_HOUR_MS) },
    },
  });

  if (issuedLastHour >= RECOVERY_MAX_ISSUES_PER_APPROVER_PER_HOUR) {
    await audit(tx, {
      actionType: AuditActionType.UPDATE,
      entityId: request.id,
      villageId: request.villageId,
      actorUserId,
      metadata: {
        event: "CODE_ISSUED",
        requestId: request.id,
        outcome: "BLOCKED",
        blockReason: "RATE_LIMITED",
      },
    });

    return { kind: "blocked", reason: "RATE_LIMITED" };
  }

  const code = (params.generateCode ?? generateRecoveryCode)();
  const codeHash = hashRecoveryCode(params.secret, request.id, code);
  const codeExpiresAt = computeCodeExpiresAt(now);
  const reissued = request.status === "CODE_ISSUED";

  const updated = await tx.passwordRecoveryRequest.updateMany({
    where: {
      id: request.id,
      status: request.status,
      issueCount: request.issueCount,
    },
    data: {
      status: "CODE_ISSUED",
      codeHash,
      codeIssuedAt: now,
      codeExpiresAt,
      codeIssuedByUserId: actorUserId,
      issueCount: { increment: 1 },
      // A fresh code gets a fresh allowance of wrong guesses.
      failedRedeemAttempts: 0,
    },
  });

  if (updated.count !== 1) {
    return { kind: "blocked", reason: "WRONG_STATE" };
  }

  const issueCount = request.issueCount + 1;

  await audit(tx, {
    actionType: AuditActionType.APPROVE,
    entityId: request.id,
    villageId: request.villageId,
    actorUserId,
    metadata: {
      event: reissued ? "CODE_REISSUED" : "CODE_ISSUED",
      requestId: request.id,
      targetUserId: request.userId,
      issuedByUserId: actorUserId,
      issueCount,
      codeExpiresAt: codeExpiresAt.toISOString(),
      previousStatus: request.status,
      newStatus: "CODE_ISSUED",
      outcome: "SUCCESS",
    },
  });

  return {
    kind: "issued",
    requestId: request.id,
    villageId: request.villageId,
    code,
    codeExpiresAt,
    issueCount,
    reissued,
  };
}

/**
 * A wrong password at the step-up. Written on its own (the caller checks the
 * password before opening the issue transaction) and bounded by the step-up
 * throttle, so it cannot flood the log.
 */
export async function recordStepUpFailureInTx(
  tx: Tx,
  params: {
    actorUserId: string;
    requestId: string;
    villageId: string | null;
    clientFingerprint?: string;
  },
): Promise<void> {
  await audit(tx, {
    actionType: AuditActionType.UPDATE,
    entityId: params.requestId,
    villageId: params.villageId,
    actorUserId: params.actorUserId,
    metadata: {
      event: "STEP_UP_FAILED",
      requestId: params.requestId,
      outcome: "BLOCKED",
      blockReason: "BAD_PASSWORD",
      clientFingerprint: params.clientFingerprint,
    },
  });
}

/* ----------------------------------------------------------- reject/withdraw */

export type NoteFailure = Extract<NoteResult, { ok: false }>["reason"];

export type RejectOutcome =
  | { kind: "rejected"; requestId: string; villageId: string | null }
  | { kind: "invalid_note"; reason: NoteFailure }
  | { kind: "not_found" }
  | { kind: "blocked"; reason: RecoveryRefusal };

/** Rejects a PENDING request. The note is optional and is shown to the member. */
export async function rejectRecoveryRequestInTx(
  tx: Tx,
  params: {
    requestId: string;
    actorUserId: string;
    note: unknown;
    now?: Date;
  },
): Promise<RejectOutcome> {
  const note = normalizeRecoveryNote(params.note, { required: false });

  if (!note.ok) {
    return { kind: "invalid_note", reason: note.reason };
  }

  const loaded = await loadAuthorizedRequest(tx, {
    requestId: params.requestId,
    actorUserId: params.actorUserId,
    actionType: AuditActionType.REJECT,
  });

  if (!loaded) {
    return { kind: "not_found" };
  }

  const { request } = loaded;
  const now = params.now ?? (await readDatabaseNow(tx));

  const decision = evaluateReject({
    request: {
      status: request.status,
      requestExpiresAt: request.requestExpiresAt,
      codeExpiresAt: request.codeExpiresAt,
      targetUserId: request.userId,
    },
    actorUserId: params.actorUserId,
    now,
  });

  if (!decision.ok) {
    if (decision.reason === "EXPIRED") {
      await writeExpiry(tx, request, now);
    }

    return { kind: "blocked", reason: decision.reason };
  }

  const updated = await tx.passwordRecoveryRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: {
      status: "REJECTED",
      rejectedByUserId: params.actorUserId,
      rejectedAt: now,
      rejectionNote: note.note,
    },
  });

  if (updated.count !== 1) {
    return { kind: "blocked", reason: "WRONG_STATE" };
  }

  await audit(tx, {
    actionType: AuditActionType.REJECT,
    entityId: request.id,
    villageId: request.villageId,
    actorUserId: params.actorUserId,
    metadata: {
      event: "REJECTED",
      requestId: request.id,
      targetUserId: request.userId,
      previousStatus: "PENDING",
      newStatus: "REJECTED",
      rejectedAt: now.toISOString(),
      note: note.note ?? undefined,
      outcome: "SUCCESS",
    },
  });

  return { kind: "rejected", requestId: request.id, villageId: request.villageId };
}

export type WithdrawOutcome =
  | { kind: "withdrawn"; requestId: string; villageId: string | null }
  | { kind: "invalid_note"; reason: NoteFailure }
  | { kind: "not_found" }
  | { kind: "blocked"; reason: RecoveryRefusal };

/**
 * Withdraws a live code (a code given to the wrong person, a mistake). The note
 * is REQUIRED: the database refuses a WITHDRAWN revocation without one.
 */
export async function withdrawRecoveryCodeInTx(
  tx: Tx,
  params: {
    requestId: string;
    actorUserId: string;
    note: unknown;
    now?: Date;
  },
): Promise<WithdrawOutcome> {
  const note = normalizeRecoveryNote(params.note, { required: true });

  if (!note.ok || note.note === null) {
    return {
      kind: "invalid_note",
      reason: note.ok ? "REQUIRED" : note.reason,
    };
  }

  const loaded = await loadAuthorizedRequest(tx, {
    requestId: params.requestId,
    actorUserId: params.actorUserId,
    actionType: AuditActionType.CANCEL,
  });

  if (!loaded) {
    return { kind: "not_found" };
  }

  const { request } = loaded;
  const now = params.now ?? (await readDatabaseNow(tx));

  const decision = evaluateWithdraw({
    request: {
      status: request.status,
      requestExpiresAt: request.requestExpiresAt,
      codeExpiresAt: request.codeExpiresAt,
      targetUserId: request.userId,
    },
    actorUserId: params.actorUserId,
    now,
  });

  if (!decision.ok) {
    if (decision.reason === "EXPIRED") {
      await writeExpiry(tx, request, now);
    }

    return { kind: "blocked", reason: decision.reason };
  }

  const updated = await tx.passwordRecoveryRequest.updateMany({
    where: { id: request.id, status: "CODE_ISSUED" },
    data: {
      status: "REVOKED",
      revokedAt: now,
      revokedByUserId: params.actorUserId,
      revocationReason: "WITHDRAWN",
      revocationNote: note.note,
      codeHash: null,
    },
  });

  if (updated.count !== 1) {
    return { kind: "blocked", reason: "WRONG_STATE" };
  }

  await audit(tx, {
    actionType: AuditActionType.CANCEL,
    entityId: request.id,
    villageId: request.villageId,
    actorUserId: params.actorUserId,
    metadata: {
      event: "CODE_REVOKED",
      requestId: request.id,
      targetUserId: request.userId,
      previousStatus: "CODE_ISSUED",
      newStatus: "REVOKED",
      revocationReason: "WITHDRAWN",
      note: note.note,
      outcome: "SUCCESS",
    },
  });

  return { kind: "withdrawn", requestId: request.id, villageId: request.villageId };
}

/* ------------------------------------------------------------------ redeem */

export type RedeemOutcome =
  | {
      kind: "completed";
      requestId: string;
      userId: string;
      villageId: string | null;
    }
  /**
   * Everything that is not a success: unknown account, no code, wrong code,
   * expired, revoked, ineligible. One result, so the member's screen and the
   * response time say nothing about which it was.
   */
  | { kind: "invalid" };

/**
 * The member uses the code and sets a new password. The new password arrives
 * ALREADY HASHED (bcrypt is slow and must not run while a transaction is
 * open), and is hashed whether or not the code turns out to be right, so the
 * work done does not depend on the answer.
 *
 * On success, in this one transaction: the request becomes COMPLETED, the
 * password changes, every existing session of the account is invalidated
 * (sessionVersion + 1), mustChangePassword is cleared, the audit entry is
 * written, and the member's "your password was changed" notice is stored. If
 * any of these fails, none of them happens.
 */
export async function redeemRecoveryCodeInTx(
  tx: Tx,
  params: RecoveryRequestInput & {
    /** Already normalized with normalizeRecoveryCodeInput. */
    code: string;
    newPasswordHash: string;
    secret: string;
    clientFingerprint?: string;
    now?: Date;
  },
): Promise<RedeemOutcome> {
  const invalid: RedeemOutcome = { kind: "invalid" };

  const account = await findRecoveryAccount(tx, params);

  const request = account
    ? ((await tx.passwordRecoveryRequest.findFirst({
        where: { userId: account.id, status: { in: ACTIVE_STATUSES } },
        select: REQUEST_SELECT,
      })) as RequestRow | null)
    : null;

  // Without a live code there is nothing to compare, but do the same work.
  if (!account || !request || request.status !== "CODE_ISSUED") {
    verifyRecoveryCode(params.secret, "none", params.code, null);
    return invalid;
  }

  const now = params.now ?? (await readDatabaseNow(tx));

  if (isExpiryDue(request, now)) {
    await writeExpiry(tx, request, now);
    return invalid;
  }

  const matches = verifyRecoveryCode(
    params.secret,
    request.id,
    params.code,
    request.codeHash,
  );

  if (!matches) {
    const failure = evaluateFailedRedeem(request.failedRedeemAttempts);

    if (failure.revoke) {
      await writeSystemRevoke(
        tx,
        request,
        "TOO_MANY_ATTEMPTS",
        now,
        failure.failedAttempts,
      );
    } else {
      const counted = await tx.passwordRecoveryRequest.updateMany({
        where: {
          id: request.id,
          status: "CODE_ISSUED",
          failedRedeemAttempts: request.failedRedeemAttempts,
        },
        data: { failedRedeemAttempts: { increment: 1 } },
      });

      if (counted.count === 1) {
        await audit(tx, {
          actionType: AuditActionType.UPDATE,
          entityId: request.id,
          villageId: request.villageId,
          actorUserId: null,
          metadata: {
            event: "REDEEM_FAILED",
            requestId: request.id,
            targetUserId: request.userId,
            failedAttempts: failure.failedAttempts,
            outcome: "BLOCKED",
            blockReason: "WRONG_CODE",
            clientFingerprint: params.clientFingerprint,
          },
        });
      }
    }

    return invalid;
  }

  const target = await loadTargetFacts(tx, request.userId);

  if (!target) {
    return invalid;
  }

  const decision = evaluateRedeem({
    request: {
      status: request.status,
      requestExpiresAt: request.requestExpiresAt,
      codeExpiresAt: request.codeExpiresAt,
      targetUserId: request.userId,
    },
    target,
    now,
  });

  if (!decision.ok) {
    if (decision.reason === "NOT_ELIGIBLE") {
      await writeSystemRevoke(tx, request, "TARGET_INELIGIBLE", now);
    }

    return invalid;
  }

  // The stored hash is part of the WHERE: a re-issue or a withdrawal that
  // landed after this transaction read the row makes the update match nothing.
  const completed = await tx.passwordRecoveryRequest.updateMany({
    where: { id: request.id, status: "CODE_ISSUED", codeHash: request.codeHash },
    data: { status: "COMPLETED", completedAt: now, codeHash: null },
  });

  if (completed.count !== 1) {
    return invalid;
  }

  await tx.user.update({
    where: { id: request.userId },
    data: {
      passwordHash: params.newPasswordHash,
      mustChangePassword: false,
      sessionVersion: { increment: 1 },
    },
  });

  await audit(tx, {
    actionType: AuditActionType.COMPLETE,
    entityId: request.id,
    villageId: request.villageId,
    // The member proved who they are with the code, so they are the actor.
    actorUserId: request.userId,
    metadata: {
      event: "COMPLETED",
      requestId: request.id,
      targetUserId: request.userId,
      issuedByUserId: request.codeIssuedByUserId ?? undefined,
      previousStatus: "CODE_ISSUED",
      newStatus: "COMPLETED",
      completedAt: now.toISOString(),
      outcome: "SUCCESS",
      clientFingerprint: params.clientFingerprint,
    },
  });

  // Safeguard 2, inside the transaction: no reset without the notice.
  await syncRecoveryNotifications(tx, {
    requestId: request.id,
    only: ["RECOVERY_PASSWORD_CHANGED"],
  });

  return {
    kind: "completed",
    requestId: request.id,
    userId: request.userId,
    villageId: request.villageId,
  };
}
