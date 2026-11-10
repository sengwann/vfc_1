import type { MembershipStatus, UserRole } from "@prisma/client";

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
  villageId: string | null;
  houseId: string | null;
  membershipStatus: MembershipStatus | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  /**
   * True until a newly created Chief has replaced the initial password.
   * Server guards refuse everything except changing the password and signing
   * out while this is set (see guards.ts).
   */
  mustChangePassword: boolean;
}

export type LoginFailureCode = "INVALID_CREDENTIALS" | "THROTTLED";

export type LoginResult =
  | {
      success: true;
      redirectTo: string;
    }
  | {
      success: false;
      code: "INVALID_CREDENTIALS";
      error: string;
    }
  | {
      success: false;
      code: "THROTTLED";
      error: string;
      retryAfterSeconds: number;
    };
