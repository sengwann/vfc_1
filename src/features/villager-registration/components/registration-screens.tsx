"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";

import { buttonVariants } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import {
  TranslationProvider,
  useTranslation,
} from "../../../lib/i18n/provider";
import { useLoginLanguage } from "../../auth/components/login-language-switch";
import { RegisterVillagerForm } from "./register-villager-form";
import { RegistrationShell } from "./registration-shell";
import { VillageCodeForm } from "./village-code-form";

/*
 * Presentation entry points for the signup routes. The pages (server) decide
 * which one to show and pass only data they already loaded. Visitors are not
 * signed in, so the language is the same browser-only choice the sign-in
 * screen uses (see login-language-switch.tsx).
 */

function SignupContent() {
  const { t } = useTranslation();
  return (
    <RegistrationShell
      description={t("signup.codeSubtitle")}
      step={1}
      title={t("signup.codeTitle")}
    >
      <VillageCodeForm />
    </RegistrationShell>
  );
}

export function SignupScreen() {
  const language = useLoginLanguage();
  return (
    <TranslationProvider language={language}>
      <SignupContent />
    </TranslationProvider>
  );
}

function RegisterContent({
  villageCode,
  villageName,
  houses,
}: {
  villageCode: string;
  villageName: string;
  houses: { houseNumber: string }[];
}) {
  const { t } = useTranslation();
  return (
    <RegistrationShell
      description={t("signup.registerSubtitle")}
      size="lg"
      step={2}
      title={t("signup.registerTitle")}
    >
      <RegisterVillagerForm
        houses={houses}
        villageCode={villageCode}
        villageName={villageName}
      />
    </RegistrationShell>
  );
}

export function RegisterScreen(props: {
  villageCode: string;
  villageName: string;
  houses: { houseNumber: string }[];
}) {
  const language = useLoginLanguage();
  return (
    <TranslationProvider language={language}>
      <RegisterContent {...props} />
    </TranslationProvider>
  );
}

function NoHousesContent({ villageName }: { villageName: string }) {
  const { t } = useTranslation();
  return (
    <RegistrationShell title={t("signup.noHousesTitle")}>
      <EmptyState
        action={
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/signup"
          >
            {t("signup.backToCode")}
          </Link>
        }
        description={t("signup.noHousesBody").replace("{village}", villageName)}
        icon={<Building2 />}
        title={villageName}
      />
    </RegistrationShell>
  );
}

export function NoHousesScreen({ villageName }: { villageName: string }) {
  const language = useLoginLanguage();
  return (
    <TranslationProvider language={language}>
      <NoHousesContent villageName={villageName} />
    </TranslationProvider>
  );
}
