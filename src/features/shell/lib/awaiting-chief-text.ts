import type { LanguagePreference } from "@prisma/client";

/*
 * Wording for a pending member whose house has no Head of House yet, so the
 * Village Chief (not a head) is the one choosing. Feature-local on purpose for
 * this step; to be moved into the central en.ts / my.ts dictionaries in the
 * translations step. Client-safe: no server-only imports. The Burmese text
 * should be reviewed by a native speaker.
 */
export interface AwaitingChiefText {
  banner: string;
  dashboardBody: string;
}

export const awaitingChiefText: Record<LanguagePreference, AwaitingChiefText> =
  {
    EN: {
      banner:
        "Your house has no Head of House yet. The Village Chief is choosing one. Some village features are unavailable until you are approved.",
      dashboardBody:
        "Your house has no Head of House yet. The Village Chief will choose one, and your membership will then be reviewed. Financial and household features will become available after approval.",
    },
    MY: {
      banner:
        "သင့်အိမ်တွင် အိမ်ထောင်စုခေါင်းဆောင် မရှိသေးပါ။ ကျေးရွာ အုပ်ချုပ်ရေးမှူးက ခေါင်းဆောင်ကို ရွေးချယ်နေပါသည်။ အတည်ပြုခံရသည်အထိ ကျေးရွာ လုပ်ဆောင်ချက် အချို့ကို အသုံးပြု၍ မရပါ။",
      dashboardBody:
        "သင့်အိမ်တွင် အိမ်ထောင်စုခေါင်းဆောင် မရှိသေးပါ။ ကျေးရွာ အုပ်ချုပ်ရေးမှူးက ခေါင်းဆောင်ကို ရွေးချယ်ပြီးနောက် သင့်အဖွဲ့ဝင်ခွင့်ကို စစ်ဆေးမည်ဖြစ်သည်။ အတည်ပြုပြီးနောက် ငွေကြေးနှင့် အိမ်ထောင်စု လုပ်ဆောင်ချက်များကို အသုံးပြုနိုင်မည်။",
    },
  };

export function getAwaitingChiefText(
  language: LanguagePreference,
): AwaitingChiefText {
  return awaitingChiefText[language] ?? awaitingChiefText.EN;
}
