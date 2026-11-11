import Link from "next/link";
import { LanguagePreference } from "@prisma/client";
import { ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BrandMark } from "@/features/shell/components/brand-mark";
import { LOGIN_ROUTE } from "@/lib/auth/auth.constants";
import { getCurrentUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Forbidden | Village Fund Collection System",
};

/*
 * Read-only lookup of the visitor's saved language. Anything that goes wrong
 * (no session, no settings row, database hiccup) falls back to English so the
 * access-denied page can always render.
 */
async function loadVisitor(): Promise<{
  signedIn: boolean;
  language: LanguagePreference;
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { signedIn: false, language: LanguagePreference.EN };
    }
    const settings = await prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: { language: true },
    });
    return {
      signedIn: true,
      language: settings?.language ?? LanguagePreference.EN,
    };
  } catch {
    return { signedIn: false, language: LanguagePreference.EN };
  }
}

export default async function ForbiddenPage() {
  const { signedIn, language } = await loadVisitor();
  const t = getT(language);

  const href = signedIn ? "/dashboard" : LOGIN_ROUTE;
  const actionLabel = signedIn ? t("forbidden.goHome") : t("login.submit");

  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]"
      lang={language === LanguagePreference.MY ? "my" : "en"}
    >
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <BrandMark variant="village" />
            <p className="min-w-0 text-sm font-semibold leading-snug">
              {t("shell.villageFundCollection")}
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 text-center">
            <span
              aria-hidden="true"
              className="flex size-16 items-center justify-center rounded-full bg-warning-soft text-warning-strong"
            >
              <ShieldAlert className="size-8" />
            </span>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold leading-snug tracking-tight">
                {t("forbidden.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("forbidden.body")}
              </p>
            </div>
          </div>

          <Alert tone="info">{t("forbidden.hint")}</Alert>

          <Link
            className={buttonVariants({ size: "lg", className: "w-full" })}
            href={href}
          >
            {actionLabel}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
