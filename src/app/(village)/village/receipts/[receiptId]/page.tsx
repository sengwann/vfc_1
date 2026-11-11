import { notFound } from "next/navigation";
import { ReceiptDetailCard } from "../../../../../features/receipt-viewing/components/receipt-detail-card";
import { ReceiptDetailHeader } from "../../../../../features/receipt-viewing/components/receipts-page-header";
import {
  requireReceiptAccess,
  type ReceiptAccessLevel,
} from "../../../../../features/receipt-viewing/lib/receipt-access";
import { prisma } from "../../../../../lib/prisma";

export const metadata = {
  title: "Receipt Detail | Village Fund Collection System",
};

type RouteParams = Record<string, string | string[] | undefined>;

async function extractReceiptId(rawParams: unknown): Promise<string> {
  if (!rawParams) {
    return "";
  }
  let params: RouteParams;
  const maybePromise = rawParams as {
    then?: unknown;
  };
  if (typeof maybePromise.then === "function") {
    params = await (rawParams as Promise<RouteParams>);
  } else {
    params = rawParams as RouteParams;
  }
  const receiptId = params.receiptId;
  if (Array.isArray(receiptId)) {
    return receiptId[0] ?? "";
  }
  return receiptId ?? "";
}

function canAccessReceiptDetail(
  accessLevel: ReceiptAccessLevel,
  receipt: {
    villageId: string;
    payment: {
      collectorUserId: string | null;
      payerUserId: string;
    };
  },
  villageId: string,
  userId: string,
): boolean {
  if (receipt.villageId !== villageId) {
    return false;
  }

  switch (accessLevel) {
    case "village":
      return true;
    case "collector":
      return (
        receipt.payment.collectorUserId === userId ||
        receipt.payment.payerUserId === userId
      );
    case "own":
      return receipt.payment.payerUserId === userId;
    default:
      return false;
  }
}

export default async function ReceiptDetailPage({
  params,
}: {
  params: unknown;
}) {
  const { user, villageId, accessLevel } = await requireReceiptAccess();

  const receiptId = await extractReceiptId(params);
  if (!receiptId) {
    notFound();
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      villageId: true,
      createdAt: true,
      payment: {
        select: {
          id: true,
          amount: true,
          voidReason: true,
          createdAt: true,
          collectorUserId: true,
          payerUserId: true,
          fund: {
            select: { name: true },
          },
          assessment: {
            select: { houseNumberSnapshot: true },
          },
          payer: {
            select: { name: true },
          },
          collector: {
            select: { name: true },
          },
        },
      },
    },
  });

  if (!receipt) {
    notFound();
  }

  if (!canAccessReceiptDetail(accessLevel, receipt, villageId, user.id)) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <ReceiptDetailHeader />
      <ReceiptDetailCard receipt={receipt} />
    </div>
  );
}
