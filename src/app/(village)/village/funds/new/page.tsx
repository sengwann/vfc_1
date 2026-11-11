import { CreateFundForm } from "@/features/fund-management/components/create-fund-form";
import { requireChief } from "@/lib/authz";

export const metadata = {
  title: "Create Fund | Village Fund Collection System",
};

export default async function NewFundPage() {
  await requireChief();

  return <CreateFundForm />;
}
