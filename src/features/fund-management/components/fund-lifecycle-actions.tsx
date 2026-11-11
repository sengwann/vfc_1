import { Alert } from "@/components/ui/alert";
import type { FundStatus } from "@prisma/client";
import { activateFundAction } from "../actions/activate-fund.action";
import { closeFundAction } from "../actions/close-fund.action";
import {
  canActivateFund,
  canExtendFund,
  canCloseFund,
  canEditFund,
} from "../lib/fund-lifecycle";
import { ExtendFundForm, FundCompletionError } from "./extend-fund-form";
import { FundLifecycleControls } from "./fund-lifecycle-controls";

export function FundLifecycleActions({
  fundId,
  termsVersion,
  activationError,
  lifecycleError,
  unpaidCount,
  expired = false,
  endDate,
  status,
  hasOtherActiveFund,
}: {
  fundId: string;
  termsVersion: number;
  activationError?: string;
  lifecycleError?: string;
  unpaidCount?: number;
  expired?: boolean;
  endDate?: string;
  status: FundStatus;
  hasOtherActiveFund: boolean;
}) {
  return (
    <>
      {activationError ? <Alert tone="danger">{activationError}</Alert> : null}
      {lifecycleError ? <FundCompletionError message={lifecycleError} /> : null}
      {endDate && unpaidCount !== undefined && canExtendFund(status, expired, unpaidCount) ? <ExtendFundForm fundId={fundId} termsVersion={termsVersion} endDate={endDate} /> : null}
      <FundLifecycleControls
        termsVersion={termsVersion}
        activateAction={activateFundAction}
        canActivate={canActivateFund(status)}
        canClose={canCloseFund(status, unpaidCount)}
        expired={expired}
        unpaidCount={unpaidCount}
        canEdit={canEditFund(status)}
        closeAction={closeFundAction}
        fundId={fundId}
        hasOtherActiveFund={hasOtherActiveFund}
        status={status}
      />
    </>
  );
}
