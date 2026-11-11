import type { LanguagePreference } from "@prisma/client";

/*
 * Field-error wording for house forms. Feature-local on purpose (same
 * approach as pending-head-text.ts); to be moved into the central en.ts /
 * my.ts dictionaries in the translations step. Client-safe: no server-only
 * imports. The Burmese text should be reviewed by a native speaker.
 */
export type HouseErrorCode =
  | "required"
  | "length"
  | "chars"
  | "noContent"
  | "duplicate";

export type HouseErrorText = Record<HouseErrorCode, string>;

export const houseErrorText: Record<LanguagePreference, HouseErrorText> = {
  EN: {
    required: "House number is required.",
    length: "House number must be between 2 and 30 characters.",
    chars:
      "House number can only contain letters, numbers, spaces, hyphens, slashes, dots, and parentheses.",
    noContent: "House number must contain at least one letter or number.",
    duplicate: "House number already exists in this village.",
  },
  MY: {
    required: "အိမ်နံပါတ် ထည့်ရန် လိုအပ်ပါသည်။",
    length: "အိမ်နံပါတ်သည် စာလုံး ၂ လုံးမှ ၃၀ လုံးအတွင်း ဖြစ်ရပါမည်။",
    chars:
      "အိမ်နံပါတ်တွင် စာလုံး၊ ဂဏန်း၊ နေရာလွတ်၊ တုံးတို၊ ဆလက်ရှ်၊ အစက်နှင့် ကွင်းစကွင်းပိတ်များသာ ပါဝင်နိုင်သည်။",
    noContent:
      "အိမ်နံပါတ်တွင် စာလုံး သို့မဟုတ် ဂဏန်း အနည်းဆုံး တစ်လုံး ပါရပါမည်။",
    duplicate: "ဤအိမ်နံပါတ်သည် ဤကျေးရွာတွင် ရှိပြီးသား ဖြစ်သည်။",
  },
};

export function getHouseErrorText(
  language: LanguagePreference,
): HouseErrorText {
  return houseErrorText[language] ?? houseErrorText.EN;
}
