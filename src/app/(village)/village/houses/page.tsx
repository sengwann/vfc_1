import { requireChief } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { HousesDirectory } from "@/features/house-management/components/houses-directory";

export const metadata = {
  title: "Houses | Village Fund Collection System",
};

export default async function HousesPage() {
  const { villageId } = await requireChief();

  const rows = await prisma.house.findMany({
    where: {
      villageId,
    },
    select: {
      id: true,
      houseNumber: true,
      isActive: true,
    },
  });

  // Natural order: "2" before "10", "A-2" before "A-10".
  const houses = [...rows].sort((a, b) =>
    a.houseNumber.localeCompare(b.houseNumber, "en", { numeric: true }),
  );

  return <HousesDirectory houses={houses} />;
}
