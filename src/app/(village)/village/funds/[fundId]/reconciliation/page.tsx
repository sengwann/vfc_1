import { notFound } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { getChiefFundReconciliation } from "@/features/fund-management/lib/fund-reconciliation-queries";
import { FundReconciliationView } from "@/features/fund-management/components/fund-reconciliation-view";
import { resolveSearchParams } from "@/features/audit/lib/audit-filters";
export default async function FundReconciliationPage({ params, searchParams }: { params: unknown; searchParams?: unknown }) {
  await requireChief();
  const route = await params as { fundId?: unknown };
  if (typeof route?.fundId !== "string") notFound();
  const query = await resolveSearchParams(searchParams);
  const raw = query.page ?? "1";
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || !Number.isSafeInteger(Number(raw) * 100)) notFound();
  const page = Number(raw);
  const result = await getChiefFundReconciliation(route.fundId);
  const totalFindings = result.findings.length;
  // The full evaluator has already run. Only the finding display is paginated.
  return <FundReconciliationView result={{ ...result, findings: result.findings.slice((page - 1) * 100, page * 100) }} page={page} totalFindings={totalFindings} />;
}
