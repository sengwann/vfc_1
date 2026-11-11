import type { AuditActionType, Prisma } from "@prisma/client";

export const AuditEntityType = {
  VILLAGE: "VILLAGE",
  HOUSE: "HOUSE",
  USER: "USER",
  FUND: "FUND",
  FUND_HOUSE_ASSESSMENT: "FUND_HOUSE_ASSESSMENT",
  FUND_END_DATE_EXTENSION: "FUND_END_DATE_EXTENSION",
  COLLECTOR_ASSIGNMENT: "COLLECTOR_ASSIGNMENT",
  PAYMENT: "PAYMENT",
  RECEIPT: "RECEIPT",
  SESSION: "SESSION",
  DEACTIVATION_REQUEST: "DEACTIVATION_REQUEST",
  PASSWORD_RECOVERY_REQUEST: "PASSWORD_RECOVERY_REQUEST",
} as const;

export type AuditEntityType =
  (typeof AuditEntityType)[keyof typeof AuditEntityType];

export interface CreateAuditLogInput {
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId?: string | null;
  villageId?: string | null;
  fundId?: string | null;
  actorUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface VillageAuditMetadata {
  villageCode?: string;
  name?: string;
  previousStatus?: string;
  newStatus?: string;
  reason?: string;
  chiefUserId?: string;
}

export interface HouseAuditMetadata {
  houseNumber?: string;
  previousHouseNumber?: string;
  isActive?: boolean;
}

export interface UserAuditMetadata {
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string;
  previousMembershipStatus?: string;
  newMembershipStatus?: string;
  houseId?: string | null;
}

export interface FundAuditMetadata {
  name?: string;
  targetAmount?: number;
  previousStatus?: string;
  newStatus?: string;
}

export interface CollectorAssignmentAuditMetadata {
  year?: number;
  month?: number;
  isActive?: boolean;
  assignedUserName?: string;
}

export interface PaymentAuditMetadata {
  amount?: number;
  fundId?: string;
  houseId?: string;
  previousStatus?: string;
  newStatus?: string;
}

export interface ReceiptAuditMetadata {
  receiptNumber?: string;
  paymentId?: string;
  status?: string;
}

export interface SessionAuditMetadata {
  userRole?: string;
  villageId?: string | null;
}

/**
 * Password recovery entries. Dates are ISO-8601 UTC strings.
 *
 * NEVER put a reset code, a code hash, a password, a token, or the member's
 * email or phone number in here. Ids, times, counts and the short keyed
 * fingerprint below are the only identifying values allowed.
 *
 * `event` is one of REQUESTED, CODE_ISSUED, CODE_REISSUED, REJECTED,
 * CODE_REVOKED, COMPLETED, EXPIRED, STEP_UP_FAILED, REDEEM_FAILED (a wrong
 * code), AUTHORITY_REFUSED. `outcome` is "BLOCKED" for a refused attempt worth
 * recording (a wrong re-entered password, a wrong code).
 */
export interface RecoveryAuditMetadata {
  event?: string;
  requestId?: string;
  targetUserId?: string;
  issuedByUserId?: string;
  issueCount?: number;
  requestExpiresAt?: string;
  codeExpiresAt?: string;
  rejectedAt?: string;
  completedAt?: string;
  revocationReason?: string;
  failedAttempts?: number;
  outcome?: "SUCCESS" | "BLOCKED";
  blockReason?: string;
  /** Short keyed fingerprint of the client IP; never the raw address. */
  clientFingerprint?: string;
  /** "cli" for the server-side last-admin reset. */
  via?: string;
  previousStatus?: string;
  newStatus?: string;
  /** The rejection or withdrawal note the approver typed (plain text, <= 200). */
  note?: string;
  notificationDelivery?: "FAILED";
  notificationEvent?: string;
  error?: string;
}

/**
 * Village deactivation workflow entries. Dates are ISO-8601 UTC strings.
 * `outcome` is "SUCCESS" for a completed transition and "BLOCKED" for a
 * refused one that is worth recording (a cooldown rejection, a non-Chief or
 * non-Admin attempt, a cancellation after the deadline).
 */
export interface DeactivationAuditMetadata {
  requestId?: string;
  requesterUserId?: string;
  reason?: string;
  outcome?: "SUCCESS" | "BLOCKED";
  blockReason?: string;
  approvedAt?: string;
  scheduledDeactivationAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cooldownEndsAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  completedAt?: string;
  completedBy?: string;
  /** Set when an in-app notification could not be stored. The workflow was not affected. */
  notificationDelivery?: "FAILED";
  notificationEvent?: string;
  error?: string;
  /** Worker bookkeeping on failed completion attempts. */
  processingAttempts?: number;
  /** On VILLAGE entries: read-only mode switched on (true) or off (false). */
  readOnly?: boolean;
  previousStatus?: string;
  newStatus?: string;
}
