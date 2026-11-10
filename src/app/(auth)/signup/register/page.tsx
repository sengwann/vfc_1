import { redirect } from "next/navigation";
import { VillageStatus } from "@prisma/client";
import {
  NoHousesScreen,
  RegisterScreen,
} from "@/features/villager-registration/components/registration-screens";
import { normalizeVillageCode } from "@/features/villager-registration/lib/registration-validators";
import { DEFAULT_POST_LOGIN_ROUTE } from "@/lib/auth/auth.constants";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = {
  title: "Complete Registration | Village Fund Collection System",
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

function getFirstStringValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function SignupRegisterPage({
  searchParams,
}: {
  searchParams?: unknown;
}) {
  const user = await getCurrentUser();

  if (user) {
    redirect(DEFAULT_POST_LOGIN_ROUTE);
  }

  const params = await resolveSearchParams(searchParams);
  const rawCode = getFirstStringValue(params.code) ?? "";
  const villageCode = normalizeVillageCode(rawCode);

  if (!villageCode) {
    redirect("/signup");
  }

  const village = await prisma.village.findFirst({
    where: {
      villageCode,
      status: VillageStatus.ACTIVE,
    },
    select: {
      id: true,
      villageCode: true,
      name: true,
    },
  });

  if (!village) {
    redirect("/signup");
  }

  const houses = await prisma.house.findMany({
    where: {
      villageId: village.id,
      isActive: true,
    },
    orderBy: {
      houseNumber: "asc",
    },
    select: {
      houseNumber: true,
    },
  });

  if (houses.length === 0) {
    return <NoHousesScreen villageName={village.name} />;
  }

  return (
    <RegisterScreen
      houses={houses}
      villageCode={village.villageCode}
      villageName={village.name}
    />
  );
}
