import "server-only";

import { parseMmkAmount, validateVillageTargetAmount } from "./fund-financials";

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export type FundField =
  | "name"
  | "description"
  | "targetAmount"
  | "startDate"
  | "endDate";

export interface NormalizedFundInput {
  name: string;
  description: string | null;
  targetAmount: number;
  startDate: Date;
  endDate: Date;
}

export type FundValidationResult =
  | {
      ok: true;
      data: NormalizedFundInput;
    }
  | {
      ok: false;
      fieldErrors: Partial<Record<FundField, string>>;
      formError?: string;
    };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function parseDateInput(raw: string): Date | null {
  const match = DATE_REGEX.exec(raw);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function validateFundInput(formData: FormData): FundValidationResult {
  const fieldErrors: Partial<Record<FundField, string>> = {};

  const rawName = getFormDataString(formData, "name");
  const rawDescription = getFormDataString(formData, "description");
  const rawTargetAmount = getFormDataString(formData, "targetAmount");
  const rawStartDate = getFormDataString(formData, "startDate");
  const rawEndDate = getFormDataString(formData, "endDate");

  const name = rawName.trim();

  if (name.length < 2 || name.length > 100) {
    fieldErrors.name = "Fund name must be between 2 and 100 characters.";
  }

  const description = rawDescription.trim();
  let normalizedDescription: string | null = null;

  if (description.length > 500) {
    fieldErrors.description = "Description must be at most 500 characters.";
  } else if (description.length > 0) {
    normalizedDescription = description;
  }

  let targetAmount = 0;

  const parsedTarget = parseMmkAmount(rawTargetAmount);
  if (!parsedTarget.ok) {
    fieldErrors.targetAmount = parsedTarget.error;
  } else {
    const target = validateVillageTargetAmount(parsedTarget.data);
    if (!target.ok) fieldErrors.targetAmount = target.error;
    else targetAmount = target.data;
  }

  const startDate = parseDateInput(rawStartDate);
  const endDate = parseDateInput(rawEndDate);

  if (!startDate) {
    fieldErrors.startDate = "Start date is invalid.";
  }

  if (!endDate) {
    fieldErrors.endDate = "End date is invalid.";
  }

  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    fieldErrors.endDate =
      "End date must be greater than or equal to start date.";
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
      name,
      description: normalizedDescription,
      targetAmount,
      startDate: startDate as Date,
      endDate: endDate as Date,
    },
  };
}

export type CreateFundField =
  | "name"
  | "description"
  | "totalAmount"
  | "startDate"
  | "endDate";

export interface NormalizedCreateFundInput {
  name: string;
  description: string | null;
  totalAmount: number;
  startDate: Date;
  endDate: Date;
}

export type CreateFundValidationResult =
  | { ok: true; data: NormalizedCreateFundInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<CreateFundField, string>>;
      formError?: string;
    };

export function validateCreateFundInput(
  formData: FormData,
): CreateFundValidationResult {
  const fieldErrors: Partial<Record<CreateFundField, string>> = {};

  const rawName = getFormDataString(formData, "name");
  const rawDescription = getFormDataString(formData, "description");
  const rawTotalAmount = getFormDataString(formData, "totalAmount");
  const rawStartDate = getFormDataString(formData, "startDate");
  const rawEndDate = getFormDataString(formData, "endDate");

  const name = rawName.trim();
  if (name.length < 2 || name.length > 100) {
    fieldErrors.name = "Fund name must be between 2 and 100 characters.";
  }

  const description = rawDescription.trim();
  let normalizedDescription: string | null = null;
  if (description.length > 500) {
    fieldErrors.description = "Description must be at most 500 characters.";
  } else if (description.length > 0) {
    normalizedDescription = description;
  }

  let totalAmount = 0;
  const parsedTotal = parseMmkAmount(rawTotalAmount);
  if (!parsedTotal.ok) {
    fieldErrors.totalAmount = parsedTotal.error;
  } else {
    const total = validateVillageTargetAmount(parsedTotal.data);
    if (!total.ok) fieldErrors.totalAmount = total.error;
    else totalAmount = total.data;
  }

  const startDate = parseDateInput(rawStartDate);
  const endDate = parseDateInput(rawEndDate);
  if (!startDate) fieldErrors.startDate = "Start date is invalid.";
  if (!endDate) fieldErrors.endDate = "End date is invalid.";
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    fieldErrors.endDate =
      "End date must be greater than or equal to start date.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      name,
      description: normalizedDescription,
      totalAmount,
      startDate: startDate as Date,
      endDate: endDate as Date,
    },
  };
}
