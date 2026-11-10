import { notFound } from "next/navigation";
import { FundStatus, PaymentStatus } from "@prisma/client";
import { FundDetailView } from "@/features/fund-management/components/fund-detail-view";
import { FundLifecycleActions } from "@/features/fund-management/components/fund-lifecycle-actions";
import { PaymentStatusSearchSection } from "@/features/fund-management/components/payment-status-search";
import { requireChief, requireSameVillage } from "@/lib/authz";
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

  const fund = await prisma.fund.findUnique({
    where: { id: fundId },
    select: {
      id: true,
      villageId: true,
      name: true,
      description: true,
      villageTargetAmount: true,
      termsVersion: true,
      startDate: true,
      endDate: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!fund) {
    notFound();
  }
  requireSameVillage(context, fund.villageId);

  const summary = await prisma.payment.aggregate({
    where: {
      fundId: fund.id,
      villageId: context.villageId,
      status: PaymentStatus.ACCEPTED,
    },
    _sum: { amount: true },
    _count: { id: true },
  });

  let hasOtherActiveFund = false;
  if (fund.status === FundStatus.DRAFT) {
    const activeFund = await prisma.fund.findFirst({
      where: { villageId: context.villageId, status: FundStatus.ACTIVE },
      select: { id: true },
    });
    hasOtherActiveFund = Boolean(activeFund && activeFund.id !== fund.id);
  }

  // Display hints only. Mutation transactions repeat these checks under locks.
  const unpaidCount = fund.status === FundStatus.DRAFT ? undefined : await prisma.fundHouseAssessment.count({
    where: { fundId: fund.id, villageId: context.villageId, payments: { none: { status: PaymentStatus.ACCEPTED } } },
  });
  const [window] = await prisma.$queryRaw<{ expired: boolean }[]>`
    SELECT public.vfc_fund_expired("endDate",clock_timestamp()) AS expired
    FROM public."Fund" WHERE id=${fund.id} AND "villageId"=${context.villageId}`;

  const collectedAmount = summary._sum.amount ?? 0;
  const acceptedCount = summary._count.id;

  // Existing payment-status search by ?q= (kept unchanged; its result is not
  // rendered by this page. See "Remaining issues" in the report).
  const sp = await resolveSearchParams(searchParams);
  const rawQuery = typeof sp.q === "string" ? sp.q : "";
  const query = rawQuery.trim();

  let paymentStatusResults: {
    id: string;
    houseNumber: string;
    headName: string | null;
    paid: boolean;
  }[] = [];

  if (query) {
    const matchedHouses = await prisma.house.findMany({
      where: {
        villageId: context.villageId,
        OR: [
          { houseNumber: { contains: query, mode: "insensitive" } },
          { headOfHouse: { name: { contains: query, mode: "insensitive" } } },
        ],
      },
      orderBy: { houseNumber: "asc" },
      select: {
        id: true,
        houseNumber: true,
        headOfHouse: { select: { name: true } },
        payments: {
          where: { fundId: fund.id, status: PaymentStatus.ACCEPTED },
          select: { id: true },
          take: 1,
        },
      },
    });
    paymentStatusResults = matchedHouses.map((house) => ({
      id: house.id,
      houseNumber: house.houseNumber,
      headName: house.headOfHouse?.name ?? null,
      paid: house.payments.length > 0,
    }));
  }

  return (
    <FundDetailView
      acceptedCount={acceptedCount}
      collectedAmount={collectedAmount}
      fund={{
        id: fund.id,
        name: fund.name,
        description: fund.description,
        status: fund.status,
        targetAmount: fund.villageTargetAmount,
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
          endDate={fund.endDate.toISOString().slice(0, 10)}
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
