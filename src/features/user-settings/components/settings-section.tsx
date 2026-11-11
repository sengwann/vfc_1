import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/*
 * A titled settings card: icon, <h2>, short description, then the content.
 * Presentation only (no hooks, no translation): pass translated strings.
 * The section is labelled by its heading for assistive technology.
 */
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} id={id}>
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-5"
          >
            <Icon />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle as="h2" className="text-base" id={headingId}>
              {title}
            </CardTitle>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}
