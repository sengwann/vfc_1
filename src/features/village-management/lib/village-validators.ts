import "server-only";

import { normalizeIdentifier } from "../../../lib/auth/validators";
import {
  normalizeVillageCode,
  validateChiefName,
  validatePassword,
  validateVillageCode,
  validateVillageName,
  type CreateVillageFieldErrorCode,
} from "./village-validation-rules";

export type CreateVillageField =
  | "villageCode"
  | "villageName"
  | "chiefName"
  | "chiefEmail"
  | "chiefPhone"
  | "chiefIdentifier"
  | "chiefPassword";

export type CreateVillageFieldErrors = Partial<
  Record<CreateVillageField, CreateVillageFieldErrorCode>
>;

export interface NormalizedCreateVillageInput {
  villageCode: string;
  villageName: string;
  chiefName: string;
  chiefEmail: string | null;
  chiefPhone: string | null;
  chiefPassword: string;
}

export type CreateVillageValidationResult =
  | {
      ok: true;
      data: NormalizedCreateVillageInput;
    }
  | {
      ok: false;
      fieldErrors: CreateVillageFieldErrors;
    };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value === "string") {
    return value;
  }

  return "";
}

export function validateCreateVillageInput(
  formData: FormData,
): CreateVillageValidationResult {
  const fieldErrors: CreateVillageFieldErrors = {};

  const rawVillageCode = getFormDataString(formData, "villageCode");
  const rawVillageName = getFormDataString(formData, "villageName");
  const rawChiefName = getFormDataString(formData, "chiefName");
  const rawChiefEmail = getFormDataString(formData, "chiefEmail").trim();
  const rawChiefPhone = getFormDataString(formData, "chiefPhone").trim();
  const rawChiefPassword = getFormDataString(formData, "chiefPassword");

  const villageCode = normalizeVillageCode(rawVillageCode);
  const villageCodeError = validateVillageCode(villageCode);

  if (villageCodeError) {
    fieldErrors.villageCode = villageCodeError;
  }

  const villageName = rawVillageName.trim();
  const villageNameError = validateVillageName(villageName);

  if (villageNameError) {
    fieldErrors.villageName = villageNameError;
  }

  const chiefName = rawChiefName.trim();
  const chiefNameError = validateChiefName(chiefName);

  if (chiefNameError) {
    fieldErrors.chiefName = chiefNameError;
  }

  let chiefEmail: string | null = null;
  let chiefPhone: string | null = null;

  // normalizeIdentifier() is the same function login uses, so the stored value
  // is exactly what the Chief will be looked up by.
  if (rawChiefEmail) {
    const identifier = normalizeIdentifier(rawChiefEmail);

    if (identifier?.type === "email") {
      chiefEmail = identifier.value;
    } else {
      fieldErrors.chiefEmail = "EMAIL_INVALID";
    }
  }

  if (rawChiefPhone) {
    const identifier = normalizeIdentifier(rawChiefPhone);

    if (identifier?.type === "phone") {
      chiefPhone = identifier.value;
    } else {
      fieldErrors.chiefPhone = "PHONE_INVALID";
    }
  }

  if (!rawChiefEmail && !rawChiefPhone) {
    fieldErrors.chiefIdentifier = "IDENTIFIER_REQUIRED";
  }

  const passwordError = validatePassword(rawChiefPassword);

  if (passwordError) {
    fieldErrors.chiefPassword = passwordError;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      fieldErrors,
    };
  }

  return {
    ok: true,
    data: {
      villageCode,
      villageName,
      chiefName,
      chiefEmail,
      chiefPhone,
      chiefPassword: rawChiefPassword,
    },
  };
}
