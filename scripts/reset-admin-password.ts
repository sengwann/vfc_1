/*
 * Last-resort password reset for a System Admin, run by whoever operates the
 * server (it needs DATABASE_URL, so it needs access to the database already).
 * This is the only recovery path for the LAST System Admin: nobody else exists
 * to approve a code for them.
 *
 *   npx tsx scripts/reset-admin-password.ts --email admin@example.com --yes
 *
 * What it does, in one transaction:
 *  - sets a random temporary password (printed ONCE on this terminal, never
 *    stored anywhere in plain text, never logged);
 *  - marks the account mustChangePassword, so the first sign-in goes straight
 *    to the change-password screen;
 *  - increments sessionVersion, which signs out every existing session;
 *  - ends any open recovery request for the account (revoked, system reason);
 *  - writes an audit entry with via = "cli" (no password in it).
 *
 * It only touches System Admin accounts (role SYSTEM_ADMIN, no village).
 * Without --yes it changes nothing and says what it would do.
 *
 * Like prisma/seed.ts this file builds its own Prisma client and imports
 * nothing from src/, so it carries no server-only code.
 */
import "dotenv/config";

import { randomInt } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

// No look-alike characters (0/O, 1/I/L), so it can be read from a terminal.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMPORARY_PASSWORD_LENGTH = 20;
const BCRYPT_COST = 10; // keep in step with src/lib/auth/password.ts

function readArgs(argv: string[]): { email: string | null; yes: boolean } {
  const emailIndex = argv.indexOf("--email");
  const email = emailIndex >= 0 ? (argv[emailIndex + 1] ?? null) : null;

  return {
    email: email ? email.trim().toLowerCase() : null,
    yes: argv.includes("--yes"),
  };
}

function generateTemporaryPassword(): string {
  let password = "";

  for (let index = 0; index < TEMPORARY_PASSWORD_LENGTH; index += 1) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }

  return password;
}

async function main(): Promise<void> {
  const { email, yes } = readArgs(process.argv.slice(2));

  if (!email) {
    console.error(
      "Usage: npx tsx scripts/reset-admin-password.ts --email <admin email> [--yes]",
    );
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const admin = await prisma.user.findFirst({
      where: { email, role: "SYSTEM_ADMIN", villageId: null },
      select: { id: true, name: true },
    });

    if (!admin) {
      // The same message whether the email is wrong or belongs to another role.
      console.error("No System Admin account has that email address.");
      process.exitCode = 1;
      return;
    }

    if (!yes) {
      console.log(
        `Would reset the password of System Admin "${admin.name}" and sign out all of their sessions.`,
      );
      console.log("Nothing was changed. Run again with --yes to do it.");
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          sessionVersion: { increment: 1 },
        },
      });

      // An open recovery request for this account is now pointless.
      const open = await tx.passwordRecoveryRequest.findFirst({
        where: { userId: admin.id, status: { in: ["PENDING", "CODE_ISSUED"] } },
        select: { id: true, status: true },
      });

      if (open) {
        await tx.passwordRecoveryRequest.update({
          where: { id: open.id },
          data: {
            status: "REVOKED",
            revokedAt: new Date(),
            revocationReason: "TARGET_INELIGIBLE",
            codeHash: null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actionType: "COMPLETE",
          entityType: "PASSWORD_RECOVERY_REQUEST",
          entityId: open?.id ?? null,
          villageId: null,
          actorUserId: null,
          metadata: {
            event: "COMPLETED",
            targetUserId: admin.id,
            via: "cli",
            outcome: "SUCCESS",
          },
        },
      });
    });

    console.log(`Password reset for System Admin "${admin.name}".`);
    console.log("Temporary password (shown once, copy it now):");
    console.log(temporaryPassword);
    console.log("They must choose a new password at their next sign-in.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Reset failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
