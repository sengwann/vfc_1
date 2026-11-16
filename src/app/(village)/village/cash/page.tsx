import { CashPageView } from "../../../../features/cash-payment/components/cash-page-view";
import type { HouseOption } from "../../../../features/cash-payment/components/cash-payment-form";
import { requireCashPaymentAccess } from "../../../../features/cash-payment/lib/cash-payment-access";
import { getCashHistory } from "@/features/payment-history/lib/history-queries";
import { HistoryPanel } from "@/features/payment-history/components/history-panel";
import { CashPaymentList } from "@/features/cash-payment/components/cash-payment-list";
import { notFound } from "next/navigation";
import { resolveSearchParams } from "@/features/audit/lib/audit-filters";

export const metadata = {
  title: "Cash Payments | Village Fund Collection System",
};

export default async function CashPage({ searchParams }: { searchParams?: unknown } = {}) {
  const { villageId, fund } = await requireCashPaymentAccess();

  const params = await resolveSearchParams(searchParams);
  const history = await getCashHistory(params);
  if (history.villageId !== villageId) notFound();

  // The loader returns one Fund's frozen snapshot with the displayed terms.
  // Live members are payer choices only; they never determine the assessment.
  const houses: HouseOption[] = (fund?.assessments ?? []).map((assessment) => ({
    id: assessment.houseId,
    houseNumber: assessment.houseNumberSnapshot,
    assessmentAmount: assessment.assessmentAmount,
    members: assessment.house.members,
  }));

  return (
    <CashPageView
      fund={fund}
      houses={houses}
      payments={[]}
      history={<HistoryPanel result={history} params={params} basePath="/village/cash">
        <CashPaymentList payments={history.ok ? history.payments : []} />
      </HistoryPanel>}
    />
  );
}
