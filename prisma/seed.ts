import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

import { normalizeEmail } from "../src/lib/auth/identifiers";
import { checkPasswordRules } from "../src/lib/auth/password-rules";

class SeedConfigurationError extends Error {}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new SeedConfigurationError(
      `Missing required seed environment variable: ${name}`,
    );
  }
  return value;
}

async function seedSystemAdmin(): Promise<void> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SEED_ALLOW_PRODUCTION !== "1"
  ) {
    throw new SeedConfigurationError(
      "Production seeding is disabled. Set SEED_ALLOW_PRODUCTION=1 and provide secure seed credentials.",
    );
  }

  const email = normalizeEmail(getRequiredEnv("SEED_ADMIN_EMAIL"));
  if (!email) {
    throw new SeedConfigurationError("SEED_ADMIN_EMAIL must be a valid email address.");
  }

  // Routine reseeding only needs the account email. Password replacement
  // requires a separate opt-in and applies to an existing administrator.
  const replacePassword = process.env.SEED_REPLACE_ADMIN_PASSWORD === "1";
  const replacementPassword = replacePassword
    ? getRequiredEnv("SEED_ADMIN_PASSWORD")
    : undefined;
  const pool = new Pool({ connectionString: getRequiredEnv("DATABASE_URL") });
  const adminScope = {
    email,
    role: UserRole.SYSTEM_ADMIN,
    villageId: null,
  };

  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const existingAdmin = await prisma.user.findFirst({
        where: adminScope,
        select: { id: true },
      });

      if (existingAdmin && !replacePassword) return;
      if (!existingAdmin && replacePassword) {
        throw new SeedConfigurationError(
          "Password replacement requires an existing system administrator.",
        );
      }

      const password = replacementPassword ?? getRequiredEnv("SEED_ADMIN_PASSWORD");
      if (checkPasswordRules(password)) {
        throw new SeedConfigurationError(
          "SEED_ADMIN_PASSWORD must be at least 8 characters and at most 72 UTF-8 bytes.",
        );
      }
      const passwordHash = await bcrypt.hash(password, 10);

      if (existingAdmin) {
        await prisma.user.update({
          where: { id: existingAdmin.id, ...adminScope },
          data: { passwordHash, sessionVersion: { increment: 1 } },
        });
      } else {
        await prisma.user.create({
          data: { ...adminScope, name: "System Admin", passwordHash },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await pool.end();
  }
}

export async function runSeed(): Promise<void> {
  try {
    await seedSystemAdmin();
    console.log("System administrator seed completed.");
  } catch (error) {
    // Database errors can include the input to a failed write.
    console.error(
      error instanceof SeedConfigurationError
        ? error.message
        : "System administrator seed failed.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runSeed();
}
