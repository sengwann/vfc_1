import { CashPageView } from "../../../../features/cash-payment/components/cash-page-view";
import type { HouseOption } from "../../../../features/cash-payment/components/cash-payment-form";
import { requireCashPaymentAccess } from "../../../../features/cash-payment/lib/cash-payment-access";
import { prisma } from "../../../../lib/prisma";

export const metadata = {
  title: "Cash Payments | Village Fund Collection System",
};

export default async function CashPage() {
  const { villageId, fund } = await requireCashPaymentAccess();

  if (!fund) {
    return (
      <CashPageView fund={null} houses={[]} payments={[]} />
    );
  }

  // The loader returns one Fund's frozen snapshot with the displayed terms.
  // Live members are payer choices only; they never determine the assessment.
  const houses: HouseOption[] = fund.assessments.map((assessment) => ({
    id: assessment.houseId,
    houseNumber: assessment.houseNumberSnapshot,
    assessmentAmount: assessment.assessmentAmount,
    members: assessment.house.members,
  }));

  const recentPayments = await prisma.payment.findMany({
    where: { villageId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      amount: true,
      status: true,
      createdAt: true,
      voidReason: true,
      assessment: { select: { houseNumberSnapshot: true } },
      fund: { select: { status: true } },
      payer: { select: { name: true } },
    },
  });

  return (
    <CashPageView
      fund={fund}
      houses={houses}
      payments={recentPayments}
    />
  );
}
