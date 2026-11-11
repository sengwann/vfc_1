"use client";
import {
  Banknote,
  Building2,
  CreditCard,
  Home,
  Landmark,
  PowerOff,
  Receipt,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
  Settings,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import type { NavIconName } from "../lib/navigation";

/*
 * `navigation.ts` also uses "shield-alert" (disputes) although NavIconName does
 * not list it yet, so the map accepts the wider key set and falls back to Home.
 */
type IconKey = NavIconName | "user-circle" | "settings";

const iconMap: Record<IconKey, LucideIcon> = {
  home: Home,
  landmark: Landmark,
  "scroll-text": ScrollText,
  building: Building2,
  users: Users,
  "user-cog": UserCog,
  wallet: Wallet,
  "credit-card": CreditCard,
  receipt: Receipt,
  "shield-check": ShieldCheck,
  banknote: Banknote,
  power: PowerOff,
  "user-circle": UserCircle,
  settings: Settings,
};

export function NavIcon({
  name,
  className,
}: {
  name: NavIconName;
  className?: string;
}) {
  const Icon = iconMap[name as IconKey] ?? Home;
  return <Icon aria-hidden className={className} />;
}
