import "server-only";

import { FundStatus } from "@prisma/client";

export function canEditFund(status: FundStatus): boolean {
  return status === FundStatus.DRAFT;
}

export function canActivateFund(status: FundStatus): boolean {
  return status === FundStatus.DRAFT;
}

export function canCloseFund(status: FundStatus, unpaidCount?: number): boolean {
  return status === FundStatus.ACTIVE && unpaidCount === 0;
}

export function isFundOpenForPayment(
  fund: {
    startDate: Date;
    endDate: Date;
  },
  now: Date = new Date(),
): boolean {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const startDate = Date.UTC(
    fund.startDate.getFullYear(),
    fund.startDate.getMonth(),
    fund.startDate.getDate(),
  );

  const endDate = Date.UTC(
    fund.endDate.getFullYear(),
    fund.endDate.getMonth(),
    fund.endDate.getDate(),
  );

  return today >= startDate && today <= endDate;
}

export function canExtendFund(status: FundStatus, expired: boolean, unpaidCount: number): boolean {
  return status === FundStatus.ACTIVE && expired && unpaidCount > 0;
}
