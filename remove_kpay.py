import os
import re
import shutil
import datetime

REPO_DIR = "."


def update_file(path, replacements):
    if not os.path.exists(path):
        print(f"Warning: {path} not found. Skipping.")
        return
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    for pattern, repl in replacements:
        content = re.sub(pattern, repl, content, flags=re.DOTALL)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Updated: {path}")


def delete_path(path):
    if os.path.exists(path):
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        print(f"Deleted: {path}")


print("--- Starting KPay & Dispute Removal ---")

# 1. Update Prisma Schema
schema_path = os.path.join(REPO_DIR, "prisma/schema.prisma")
with open(schema_path, "r", encoding="utf-8") as f:
    schema = f.read()

schema = re.sub(r"enum PaymentMethod \{\s*KPAY\s*CASH\s*\}\n*", "", schema)
schema = re.sub(
    r"enum PaymentStatus \{\s*PENDING\s*ACCEPTED\s*REJECTED\s*VOIDED\s*\}\n*",
    "enum PaymentStatus { \n  ACCEPTED \n  VOIDED \n}\n",
    schema,
)
schema = re.sub(r"enum DisputeStatus \{[^\}]*\}\n*", "", schema)
schema = re.sub(r"\s*kpayAccountName String\?\n", "\n", schema)
schema = re.sub(r"\s*kpayAccountNumber String\?\n", "\n", schema)
schema = re.sub(
    r'\s*raisedDisputes Dispute\[\] @relation\("DisputeRaisedBy"\)\n', "\n", schema
)
schema = re.sub(
    r"\s*kpayTransactionId String\? @unique @db\.VarChar\(64\)\n", "\n", schema
)
schema = re.sub(r"\s*kpaySenderName String\?\n", "\n", schema)
schema = re.sub(r"\s*kpaySenderAccount String\?\n", "\n", schema)
schema = re.sub(r"\s*kpayReceiverAccount String\?\n", "\n", schema)
schema = re.sub(r"\s*paymentMethod PaymentMethod\n", "\n", schema)
schema = re.sub(r"\s*disputes Dispute\[\]\n", "\n", schema)
schema = re.sub(r"model Dispute \{[^\}]*\}\n*", "", schema)
schema = re.sub(
    r"status PaymentStatus @default\(PENDING\)",
    "status PaymentStatus @default(ACCEPTED)",
    schema,
)
schema = re.sub(r"\s*rejectionNote String\?\n", "\n", schema)

with open(schema_path, "w", encoding="utf-8") as f:
    f.write(schema)
print(f"Updated: {schema_path}")

# 2. Create Migration SQL
timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
migration_dir = os.path.join(
    REPO_DIR, f"prisma/migrations/{timestamp}_remove_kpay_disputes"
)
os.makedirs(migration_dir, exist_ok=True)
sql = """
-- DropEnum "PaymentMethod"
ALTER TABLE "Payment" DROP COLUMN "paymentMethod";
DROP TYPE "PaymentMethod";

-- DropEnum "DisputeStatus"
DROP TYPE "DisputeStatus";

-- AlterEnum "PaymentStatus"
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
CREATE TYPE "PaymentStatus" AS ENUM ('ACCEPTED', 'VOIDED');
ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "status" TYPE "PaymentStatus" USING ("status"::text::"PaymentStatus");
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';
DROP TYPE "PaymentStatus_old";

-- DropTable "Dispute"
DROP TABLE "Dispute";

-- DropColumns from "User"
ALTER TABLE "User" DROP COLUMN "kpayAccountName";
ALTER TABLE "User" DROP COLUMN "kpayAccountNumber";

-- DropColumns from "Payment"
ALTER TABLE "Payment" DROP COLUMN "kpayTransactionId";
ALTER TABLE "Payment" DROP COLUMN "kpaySenderName";
ALTER TABLE "Payment" DROP COLUMN "kpaySenderAccount";
ALTER TABLE "Payment" DROP COLUMN "kpayReceiverAccount";
ALTER TABLE "Payment" DROP COLUMN "rejectionNote";
"""
with open(os.path.join(migration_dir, "migration.sql"), "w", encoding="utf-8") as f:
    f.write(sql)
print(f"Created Migration: {migration_dir}")

# 3. Update Analytics and Dashboard files
update_file(
    os.path.join(REPO_DIR, "src/app/(village)/village/dashboard/page.tsx"),
    [
        (r"PaymentMethod,\n", ""),
        (r"pendingPayments,\s*", ""),
        (r"openDisputes,\s*", ""),
        (r"prisma\.payment\.count\(\{[^}]+\}\),\s*", ""),
        (r"prisma\.dispute\.count\(\{[^}]+\}\),\s*", ""),
        (
            r"const \[acceptedCount, rejectedCount, cashCount\] = await Promise\.all\(\[\s*",
            "const [acceptedCount] = await Promise.all([\n      ",
        ),
        (r"prisma\.payment\.count\(\{[^}]*REJECTED[^}]*\}\),\s*", ""),
        (r"prisma\.payment\.count\(\{[^}]*CASH[^}]*\}\),\s*", ""),
        (
            r"collectorData = \{ acceptedCount, rejectedCount, cashCount \};\n",
            "collectorData = { acceptedCount };\n",
        ),
        (
            r"status: \{ in: \[PaymentStatus\.ACCEPTED, PaymentStatus\.PENDING\] \},",
            "status: PaymentStatus.ACCEPTED,",
        ),
        (r"paymentMethod: true,\n\s*", ""),
        (
            r"const \[recentPayments, receiptsCount, rejectedCount\] = await Promise\.all\(\[\s*",
            "const [recentPayments, receiptsCount] = await Promise.all([\n      ",
        ),
        (r"receiptsCount,\n\s*rejectedCount,\n", "receiptsCount,\n"),
    ],
)

update_file(
    os.path.join(REPO_DIR, "src/features/analytics/components/dashboard-types.ts"),
    [
        (r"pendingPayments: number;\n", ""),
        (r"openDisputes: number;\n", ""),
        (r"rejectedCount: number;\n", ""),
        (r"cashCount: number;\n", ""),
        (r"paymentMethod: string;\n", ""),
    ],
)

update_file(
    os.path.join(REPO_DIR, "src/features/analytics/lib/collector-analytics.ts"),
    [
        (r"PaymentMethod, PaymentStatus", "PaymentStatus"),
        (r"totalPendingAmount: number;\n", ""),
        (r"pendingCount: number;\n", ""),
        (r"rejectedCount: number;\n", ""),
        (r"cashCount: number;\n", ""),
        (r"pendingResult,\s*", ""),
        (r"rejectedCount,\s*", ""),
        (r"cashCount,\s*", ""),
        (r"prisma\.payment\.aggregate\(\{[^}]*PENDING[^}]*\}\),\s*", ""),
        (r"prisma\.payment\.count\(\{[^}]*REJECTED[^}]*\}\),\s*", ""),
        (r"prisma\.payment\.count\(\{[^}]*CASH[^}]*\}\),\s*", ""),
        (r"totalPendingAmount: pendingResult\._sum\.amount \?\? 0,\n", ""),
        (r"pendingCount: pendingResult\._count\.id,\n", ""),
        (r"rejectedCount,\n", ""),
        (r"cashCount,\n", ""),
        (r"const paidVsPending = \[[^\]]*\];\n", ""),
        (r"paidVsPending,\n", ""),
    ],
)

update_file(
    os.path.join(REPO_DIR, "src/features/analytics/components/chief-overview.tsx"),
    [
        (
            r'<StatCard\s+label=\{t\("dashboard\.stat\.pendingPayments"\)\}[^/]*/>\s*',
            "",
        ),
        (r'<StatCard\s+label=\{t\("dashboard\.stat\.openDisputes"\)\}[^/]*/>\s*', ""),
        (r"lg:grid-cols-5", "lg:grid-cols-3"),
    ],
)

update_file(
    os.path.join(REPO_DIR, "src/features/analytics/components/collector-overview.tsx"),
    [
        (r'import \{ PaidVsPendingChart \} from "\./paid-vs-pending-chart";\n', ""),
        (r'<StatCard\s+label=\{t\("dashboard\.collector\.rejected"\)\}[^/]*/>\s*', ""),
        (r'<StatCard\s+label=\{t\("dashboard\.collector\.cash"\)\}[^/]*/>\s*', ""),
        (r"lg:grid-cols-3", "lg:grid-cols-2"),
        (
            r'<StatCard\s+label=\{t\("dashboard\.collector\.pendingAmount"\)\}[^/]*/>\s*',
            "",
        ),
        (
            r'<StatCard\s+label=\{t\("dashboard\.collector\.pendingCollections"\)\}[^/]*/>\s*',
            "",
        ),
        (r"grid-cols-2 gap-3 lg:grid-cols-4", "grid-cols-2 gap-3 lg:grid-cols-2"),
        (
            r'<Card>\s*<CardHeader[^>]*>.*?t\("dashboard\.charts\.paidPendingTitle"\).*?</Card>\s*',
            "",
        ),
    ],
)

update_file(
    os.path.join(REPO_DIR, "src/features/analytics/components/villager-overview.tsx"),
    [
        (r"const METHOD: Record<string, TranslationKey> = \{[^\}]*\};\n*", ""),
        (
            r'REJECTED: \{ variant: "danger", key: "dashboard\.status\.rejected" \},\n',
            "",
        ),
        (
            r'PENDING: \{ variant: "warning", key: "dashboard\.status\.pending" \},\n',
            "",
        ),
        (
            r"\{data\.rejectedCount > 0 \? \(\s*<Alert[^>]*>\s*</Alert>\s*\) : null\}\n*",
            "",
        ),
        (r"const methodKey = METHOD\[payment\.paymentMethod\];\n\s*", ""),
        (r"\{methodKey \? t\(methodKey\) : payment\.paymentMethod\} · ", "Cash · "),
    ],
)

# 4. Update Receipts
update_file(
    os.path.join(
        REPO_DIR, "src/features/receipt-viewing/components/receipt-detail-card.tsx"
    ),
    [
        (r'import \{ ReceiptMethodLabel \} from "\./receipt-method-label";\n', ""),
        (
            r'<DetailRow label=\{t\("receipts\.field\.method"\)\}>\s*<ReceiptMethodLabel method=\{payment\.paymentMethod\} />\s*</DetailRow>\s*',
            "",
        ),
        (r'const isKpay = payment\.paymentMethod === "KPAY";\n\s*', ""),
        (
            r'\{isKpay \? \(\s*<Section[^>]*>\s*<Card>\s*<dl[^>]*>\s*<DetailRow label=\{t\("receipts\.kpay\.txn"\)\} mono>\s*\{payment\.kpayTransactionId \?\? <Missing />\}\s*</DetailRow>\s*<DetailRow label=\{t\("receipts\.kpay\.receiver"\)\} mono>\s*\{payment\.kpayReceiverAccount \?\? <Missing />\}\s*</DetailRow>\s*</dl>\s*<p[^>]*>\s*\{t\("receipts\.kpay\.privacy"\)\}\s*</p>\s*</Card>\s*</Section>\s*\) : null\}\n*',
            "",
        ),
        (r"\s*kpayTransactionId: string \| null;\n", "\n"),
        (r"\s*kpayReceiverAccount: string \| null;\n", "\n"),
        (r"\s*paymentMethod: PaymentMethod;\n", "\n"),
    ],
)

update_file(
    os.path.join(REPO_DIR, "src/app/(village)/village/receipts/[receiptId]/page.tsx"),
    [
        (r"paymentMethod: true,\n\s*", ""),
        (r"kpayTransactionId: true,\n\s*", ""),
        (r"kpayReceiverAccount: true,\n\s*", ""),
    ],
)

# 5. Update Cash Payment Actions
for p in [
    "src/features/cash-payment/actions/record-cash-payment.action.ts",
    "src/features/cash-payment/lib/record-cash-payment.action.ts",
]:
    update_file(
        os.path.join(REPO_DIR, p),
        [
            (r"PaymentMethod,\n", ""),
            (
                r"status: \{\s*in: \[PaymentStatus\.ACCEPTED, PaymentStatus\.PENDING\],?\s*\},",
                "status: PaymentStatus.ACCEPTED,",
            ),
            (
                r"status: \{ in: \[PaymentStatus\.ACCEPTED, PaymentStatus\.PENDING\] \},",
                "status: PaymentStatus.ACCEPTED,",
            ),
            (r"paymentMethod: PaymentMethod\.CASH,\n\s*", ""),
            (
                r'"A valid or pending payment already exists for this fund and house\."',
                '"A valid payment already exists for this fund and house."',
            ),
        ],
    )

# 6. Update Audit Logs
update_file(
    os.path.join(REPO_DIR, "src/lib/audit/audit.types.ts"),
    [
        (r'\s*DISPUTE: "DISPUTE",\n', "\n"),
        (r"\s*paymentMethod\?: string;\n", "\n"),
    ],
)
update_file(
    os.path.join(REPO_DIR, "src/features/audit/lib/audit-entity-labels.ts"),
    [
        (r"case AuditEntityType\.DISPUTE:\s*\{[^\}]*\}\n*", ""),
    ],
)
update_file(
    os.path.join(REPO_DIR, "src/features/audit/lib/audit-labels.ts"),
    [
        (r'\s*DISPUTE: "audit\.entity\.dispute",\n', "\n"),
    ],
)

# 7. Update Shell & Notifications
update_file(
    os.path.join(REPO_DIR, "src/features/notifications/lib/notification-service.ts"),
    [
        (r"\s*DisputeStatus,\n", "\n"),
        (r"\s*disputesNeedingAction: number;\n", "\n"),
        (r"disputesNeedingAction,\s*", ""),
        (r"prisma\.dispute\.count\(\{[^}]*\}\),\s*", ""),
        (r"disputesNeedingAction,\n\s*", ""),
    ],
)
update_file(
    os.path.join(REPO_DIR, "src/features/shell/lib/navigation.ts"),
    [
        (r'\s*\| "shield-alert"\n', "\n"),
        (r"const disputeCount =\s*[^;]+;\n", ""),
        (r"const disputes: NavItem = [^;]+;\n*", ""),
        (r"disputes, ", ""),
        (r", disputes", ""),
        (r"disputes", ""),
    ],
)
update_file(
    os.path.join(REPO_DIR, "src/features/shell/components/nav-icon.tsx"),
    [
        (r'\s*"shield-alert": ShieldAlert,\n', "\n"),
        (r"\s*ShieldAlert,\n", "\n"),
        (r'\| "shield-alert" ', ""),
    ],
)
update_file(
    os.path.join(REPO_DIR, "src/features/shell/components/needs-attention-card.tsx"),
    [
        (
            r"const \{\s*disputesNeedingAction,[^}]*\} = notifications\.chief;\n",
            "const {\n      hasActiveCollector,\n      hasActiveFund,\n      pendingHeadlessMembers,\n      singleHeadlessHouseId,\n    } = notifications.chief;\n",
        ),
        (r"if \(disputesNeedingAction > 0\) \{[^}]*\}\n*", ""),
        (r"} = notifications\.chief;\n\s*\);\n\s*}\n", "} = notifications.chief;\n"),
    ],
)

# 8. Update i18n files
for file_name in ["en.ts", "my.ts"]:
    file_path = os.path.join(REPO_DIR, f"src/lib/i18n/{file_name}")
    if not os.path.exists(file_path):
        continue
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    content = re.sub(r"disputes:\s*\{[^\}]*\}\n*", "", content, flags=re.DOTALL)
    content = re.sub(r"kpay:\s*\{[^\}]*\}\n*", "", content, flags=re.DOTALL)
    content = re.sub(r'kpay: "KPay",?\n?', "", content)
    content = re.sub(r'cash: "Cash",?\n?', "", content)
    content = re.sub(r'openDisputes: "Open Disputes",?\n?', "", content)
    content = re.sub(r'rejected: "Rejected",?\n?', "", content)
    content = re.sub(r'disputes: "Disputes",?\n?', "", content)
    content = re.sub(r'disputesOne: "1 dispute needs your attention",?\n?', "", content)
    content = re.sub(
        r'disputesOther: "\{count\} disputes need your attention",?\n?', "", content
    )
    content = re.sub(r"rejected:\s*\{[^\}]*\}\n*", "", content, flags=re.DOTALL)
    content = re.sub(r"method:\s*\{[^\}]*\}\n*", "", content, flags=re.DOTALL)
    content = re.sub(r'dispute: "Dispute",?\n?', "", content)
    content = re.sub(r'dispute: "အငြင်းပွားမှု",?\n?', "", content)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Updated: {file_path}")

# 9. Delete Obsolete Directories and Files
delete_path(os.path.join(REPO_DIR, "src/app/(village)/village/disputes"))
delete_path(os.path.join(REPO_DIR, "src/features/dispute-management"))
delete_path(os.path.join(REPO_DIR, "src/lib/payments/accept-payment-service.ts"))
delete_path(
    os.path.join(
        REPO_DIR, "src/features/receipt-viewing/components/receipt-method-label.tsx"
    )
)
delete_path(
    os.path.join(
        REPO_DIR, "src/features/analytics/components/paid-vs-pending-chart.tsx"
    )
)

print("\n✅ Removal complete! Next steps:")
print(
    "1. Run `npx prisma migrate dev --name remove_kpay_disputes` to apply database changes."
)
print("2. Run `npm run test` to verify test suites pass.")
print("3. Run `npm run lint` and fix any lingering unused imports.")
