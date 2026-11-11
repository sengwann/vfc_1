import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { VillagesSearch } from "@/features/village-management/components/villages-search";
import { requireSystemAdmin } from "@/lib/authz";
import { getT } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Villages | Village Fund Collection System",
};

export default async function AdminVillagesPage() {
  await requireSystemAdmin();
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  const villages = await prisma.village.findMany({
    select: {
      id: true,
      villageCode: true,
      name: true,
      status: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const createAction = (
    <Button asChild>
      <Link href="/admin/villages/new">
        <Plus aria-hidden />
        {t("adminVillages.create")}
      </Link>
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        actions={villages.length > 0 ? createAction : null}
        description={t("adminVillages.description")}
        title={t("adminVillages.title")}
      />

      {villages.length === 0 ? (
        <EmptyState
          action={createAction}
          description={t("adminVillages.emptyBody")}
          title={t("adminVillages.emptyTitle")}
        />
      ) : (
        <VillagesSearch villages={villages} />
      )}
    </div>
  );
}
