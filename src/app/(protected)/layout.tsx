import type { ReactNode } from "react";
import { LanguagePreference } from "@prisma/client";
import { requireAuthenticatedUser } from "../../lib/auth/guards";
import { prisma } from "../../lib/prisma";
import { TranslationProvider } from "../../lib/i18n/provider";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireAuthenticatedUser();
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: { language: true },
  });
  const language = settings?.language ?? LanguagePreference.EN;

  return (
    <TranslationProvider language={language}>{children}</TranslationProvider>
  );
}
