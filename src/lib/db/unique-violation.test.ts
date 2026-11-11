import { describe, expect, it } from "vitest";

import {
  getUserIdentifierViolation,
  isUniqueViolation,
} from "./unique-violation";

function p2002(message: string, meta?: unknown) {
  return Object.assign(new Error(message), { code: "P2002", meta });
}

describe("isUniqueViolation", () => {
  it("recognises P2002 only", () => {
    expect(isUniqueViolation(p2002("x"))).toBe(true);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("P2002")).toBe(false);
  });
});

describe("getUserIdentifierViolation", () => {
  it("reads the field from meta.target", () => {
    expect(
      getUserIdentifierViolation(
        p2002("x", { target: ["villageId", "email"] }),
      ),
    ).toBe("email");
    expect(
      getUserIdentifierViolation(
        p2002("x", { target: ["villageId", "phone"] }),
      ),
    ).toBe("phone");
  });

  it("reads the field from a driver adapter error", () => {
    expect(
      getUserIdentifierViolation(
        p2002("x", {
          driverAdapterError: {
            cause: { constraint: { index: "User_admin_phone_key" } },
          },
        }),
      ),
    ).toBe("phone");
  });

  it("ignores the echoed create() arguments, which name every column", () => {
    const message =
      'Invalid `prisma.user.create()` invocation:\n{ data: { email: "a@b.co", phone: "09" } }\n\nUnique constraint failed on the fields: (`villageId`,`phone`)';
    expect(getUserIdentifierViolation(p2002(message))).toBe("phone");
  });

  it("returns null when both or neither field is named", () => {
    expect(
      getUserIdentifierViolation(p2002("x", { target: ["email", "phone"] })),
    ).toBeNull();
    expect(
      getUserIdentifierViolation(p2002("x", { target: ["name"] })),
    ).toBeNull();
  });

  it("returns null for other errors", () => {
    expect(getUserIdentifierViolation(new Error("email"))).toBeNull();
  });
});
