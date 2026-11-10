import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en").format(amount);
}

type DateTimeFormat = "date" | "datetime";
export function formatYangonDateTime(
  date: Date,
  format: DateTimeFormat = "datetime",
): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Yangon",
    day: "2-digit",
    month: "short",
    year: "numeric",
  };
  if (format === "datetime") {
    options.hour = "2-digit";
    options.minute = "2-digit";
    // options.second = "2-digit";
    options.hourCycle = "h12";
  }
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}
