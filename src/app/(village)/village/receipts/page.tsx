import type { Prisma } from "@prisma/client";
import { ReceiptList } from "../../../../features/receipt-viewing/components/receipt-list";
import { ReceiptListHeader } from "../../../../features/receipt-viewing/components/receipts-page-header";
import { requireReceiptAccess } from "../../../../features/receipt-viewing/lib/receipt-access";
import { prisma } from "../../../../lib/prisma";

export const metadata = {
  title: "Receipts | Village Fund Collection System",
};

const RECEIPT_LIMIT = 50;

export default async function ReceiptsPage() {
  const { user, villageId, accessLevel } = await requireReceiptAccess();

  let whereClause: Prisma.ReceiptWhereInput;

  switch (accessLevel) {
    case "village":
      whereClause = { villageId };
      break;
    case "collector":
      whereClause = {
        villageId,
        OR: [
          { payment: { collectorUserId: user.id } },
          { payment: { payerUserId: user.id } },
        ],
      };
      break;
    case "own":
      whereClause = {
        villageId,
        payment: { payerUserId: user.id },
      };
      break;
  }

  const receipts = await prisma.receipt.findMany({
    where: whereClause,
    orderBy: {
      payment: {
        createdAt: "desc",
      },
    },
    take: RECEIPT_LIMIT,
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      payment: {
        select: {
          id: true,
          amount: true,
          createdAt: true,
          fund: { select: { name: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <ReceiptListHeader accessLevel={accessLevel} />
      <ReceiptList
        limit={RECEIPT_LIMIT}
        receipts={receipts.map((receipt) => ({
          ...receipt,
          payment: {
            ...receipt.payment,
            paymentMethod: "CASH",
          },
        }))}
      />
    </div>
  );
}
