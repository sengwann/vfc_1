import { notFound } from "next/navigation";
import { FundStatus } from "@prisma/client";
import { FundChangedRecovery } from "@/features/fund-management/components/fund-changed-recovery";
import { FundDetailView } from "@/features/fund-management/components/fund-detail-view";
import { FundLifecycleActions } from "@/features/fund-management/components/fund-lifecycle-actions";
import { PaymentStatusSearchSection } from "@/features/fund-management/components/payment-status-search";
import { requireChief } from "@/lib/authz";
import { getChiefFundReport } from "@/features/fund-management/lib/fund-report-queries";
import { getChiefFundLifecycleHistory } from "@/features/fund-management/lib/fund-lifecycle-history";
import { FundLifecycleHistoryPanel } from "@/features/fund-management/components/fund-lifecycle-history";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Fund Detail | Village Fund Collection System",
};

type RouteParams = Record<string, string | string[] | undefined>;
type SearchParams = Record<string, string | string[] | undefined>;

async function extractFundId(rawParams: unknown): Promise<string> {
  if (!rawParams) return "";
  let params: RouteParams;
  const maybePromise = rawParams as { then?: unknown };
  if (typeof maybePromise.then === "function") {
    params = await (rawParams as Promise<RouteParams>);
  } else {
    params = rawParams as RouteParams;
  }
  const fundId = params.fundId;
  if (Array.isArray(fundId)) return fundId[0] ?? "";
  return fundId ?? "";
}

async function resolveSearchParams(
  searchParams: unknown,
): Promise<SearchParams> {
  if (!searchParams) return {};
  const maybePromise = searchParams as { then?: unknown };
  if (typeof maybePromise.then === "function") {
    return await (searchParams as Promise<SearchParams>);
  }
  return searchParams as SearchParams;
}

export default async function FundDetailPage({
  params,
  searchParams,
}: {
  params: unknown;
  searchParams?: unknown;
}) {
  const context = await requireChief();
  const fundId = await extractFundId(params);
  if (!fundId) {
    notFound();
  }

  const sp = await resolveSearchParams(searchParams);
  const history = await getChiefFundLifecycleHistory(fundId, sp.before);
  const fund = history.fund;
  const report = await getChiefFundReport(fundId);
  // Do not combine a fresh financial version with stale dates/lifecycle controls.
  // A subsequent request can reload metadata if an activation/extension/closure raced this read.
  if (fund.id !== report.fund.id || fund.villageId !== report.fund.villageId || fund.termsVersion !== report.fund.termsVersion || fund.status !== report.fund.status) {
    return <FundChangedRecovery retryHref={`/village/funds/${encodeURIComponent(fund.id)}`} />;
  }

  let hasOtherActiveFund = false;
  if (fund.status === FundStatus.DRAFT) {
    const activeFund = await prisma.fund.findFirst({
      where: { villageId: context.villageId, status: FundStatus.ACTIVE },
      select: { id: true },
    });
    hasOtherActiveFund = Boolean(activeFund && activeFund.id !== fund.id);
  }

  // Display hints only. Mutation transactions repeat these checks under locks.
  const unpaidCount = report.metrics.unpaidFrozenAssessmentCount ?? undefined;
  // Use the validated DATE label, not a new Fund row read: an extension after
  // the report snapshot must not change expiry for the version being displayed.
  const endDate = fund.endDate.toISOString().slice(0, 10);
  const [window] = await prisma.$queryRaw<{ expired: boolean }[]>`
    SELECT public.vfc_fund_expired(${endDate}::date,clock_timestamp()) AS expired`;

  return (
    <FundDetailView
      history={<FundLifecycleHistoryPanel history={history} />}
      metrics={report.metrics}
      fund={{
        id: fund.id,
        name: fund.name,
        description: fund.description,
        status: fund.status,
        startDate: fund.startDate.toISOString(),
        endDate: fund.endDate.toISOString(),
        createdAt: fund.createdAt.toISOString(),
        updatedAt: fund.updatedAt.toISOString(),
      }}
      lifecycle={
        <FundLifecycleActions
          fundId={fund.id}
          termsVersion={fund.termsVersion}
          unpaidCount={unpaidCount}
          expired={window?.expired ?? false}
          endDate={endDate}
          lifecycleError={typeof sp.lifecycleError === "string" ? sp.lifecycleError : undefined}
          activationError={typeof sp.activationError === "string" ? sp.activationError : undefined}
          hasOtherActiveFund={hasOtherActiveFund}
          status={fund.status}
        />
      }
      paymentSearch={
        fund.status !== FundStatus.DRAFT ? (
          <PaymentStatusSearchSection fundId={fund.id} />
        ) : null
      }
    />
  );
}
