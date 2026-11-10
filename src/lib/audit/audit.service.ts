import "server-only";
import type { AuditLog, Prisma } from "@prisma/client";
import type { CreateAuditLogInput } from "./audit.types";

/**
 * APPEND-ONLY AUDIT LOG SERVICE
 *
 * AuditLog records are append-only. Never call prisma.auditLog.update()
 * or prisma.auditLog.delete() anywhere in the codebase.
 *
 * - Use createAuditLog for critical operations. Errors propagate.
 * - Use tryCreateAuditLog ONLY for non-critical events
 *   (LOGIN/LOGOUT/LOGIN_THROTTLED).
 */

export async function createAuditLog(
  client: Prisma.TransactionClient,
  input: CreateAuditLogInput,
): Promise<AuditLog> {
  return client.auditLog.create({
    data: {
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      villageId: input.villageId ?? null,
      fundId: input.fundId ?? null,
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function tryCreateAuditLog(
  client: Prisma.TransactionClient,
  input: CreateAuditLogInput,
): Promise<void> {
  try {
    await createAuditLog(client, input);
  } catch {
    // Best-effort: silently ignore audit failures for non-critical events.
    // This should ONLY be used for LOGIN/LOGOUT/LOGIN_THROTTLED events.
  }
}
