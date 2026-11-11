const FALLBACK_APP_NAME = "Village Fund Collection System";

export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || FALLBACK_APP_NAME;
