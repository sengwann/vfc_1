import { ReceiptList } from "@/features/receipt-viewing/components/receipt-list";
import { ReceiptListHeader } from "@/features/receipt-viewing/components/receipts-page-header";
import { getReceiptHistory } from "@/features/payment-history/lib/history-queries";
import { HistoryPanel } from "@/features/payment-history/components/history-panel";
import { resolveSearchParams } from "@/features/audit/lib/audit-filters";

export const metadata = { title: "Receipts | Village Fund Collection System" };
export default async function ReceiptsPage({ searchParams }: { searchParams?: unknown } = {}) {
  const params = await resolveSearchParams(searchParams);
  const history = await getReceiptHistory(params);
  return <div className="space-y-6">
    <ReceiptListHeader accessLevel={history.accessLevel} />
    <HistoryPanel result={history} params={params} basePath="/village/receipts">
      <ReceiptList receipts={history.ok ? history.receipts : []} />
    </HistoryPanel>
  </div>;
}
