import { requireChief } from "@/lib/authz";
import { CreateHouseForm } from "@/features/house-management/components/create-house-form";

export const metadata = {
  title: "Create House | Village Fund Collection System",
};

export default async function NewHousePage() {
  await requireChief();

  return <CreateHouseForm />;
}