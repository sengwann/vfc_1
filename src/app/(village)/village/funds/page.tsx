import { FundStatus, PaymentStatus } from "@prisma/client";
import { FundList } from "@/features/fund-management/components/fund-list";
import { requireChief } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Funds | Village Fund Collection System",
};

type SearchParams = Record<string, string | string[] | undefined>;

async function resolveSearchParams(
  searchParams: unknown,
): Promise<SearchParams> {
  if (!searchParams) {
    return {};
  }

  const maybePromise = searchParams as {
    then?: unknown;
  };

  if (typeof maybePromise.then === "function") {
    return await (searchParams as Promise<SearchParams>);
  }

  return searchParams as SearchParams;
}

function getStatusFilter(
  rawStatus: string | string[] | undefined,
): FundStatus | undefined {
  const value = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;

  if (
    value === FundStatus.DRAFT ||
    value === FundStatus.ACTIVE ||
    value === FundStatus.CLOSED
  ) {
    return value;
  }

  return undefined;
}

export default async function FundsPage({
  searchParams,
}: {
  searchParams?: unknown;
}) {
  const { villageId } = await requireChief();
  const params = await resolveSearchParams(searchParams);
  const statusFilter = getStatusFilter(params.status);

  const funds = await prisma.fund.findMany({
    where: {
      villageId,
      ...(statusFilter ? { status: statusFilter } : undefined),
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      villageTargetAmount: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });

  const acceptedTotals = await prisma.payment.groupBy({
    by: ["fundId"],
    where: {
      villageId,
      status: PaymentStatus.ACCEPTED,
    },
    _sum: {
      amount: true,
    },
  });

  const collectedByFund = new Map<string, number>();

  for (const row of acceptedTotals) {
    collectedByFund.set(row.fundId, row._sum.amount ?? 0);
  }

  return (
    <FundList
      funds={funds.map((fund) => ({
        id: fund.id,
        name: fund.name,
        status: fund.status,
        targetAmount: fund.villageTargetAmount,
        collectedAmount: collectedByFund.get(fund.id) ?? 0,
        startDate: fund.startDate.toISOString(),
        endDate: fund.endDate.toISOString(),
      }))}
      statusFilter={statusFilter ?? null}
    />
  );
}
