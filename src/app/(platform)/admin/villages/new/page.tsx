import { PageHeader } from "@/components/ui/page-header";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { CreateVillageForm } from "@/features/village-management/components/create-village-form";
import { requireSystemAdmin } from "@/lib/authz";
import { getT } from "@/lib/i18n/translations";

export const metadata = {
  title: "Create Village | Village Fund Collection System",
};

export default async function NewVillagePage() {
  await requireSystemAdmin();
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/admin/villages"
        backLabel={t("adminVillages.back")}
        description={t("adminVillages.new.description")}
        title={t("adminVillages.new.title")}
      />

      <CreateVillageForm />
    </div>
  );
}
