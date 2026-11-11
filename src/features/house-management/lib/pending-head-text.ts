import type { LanguagePreference } from "@prisma/client";

/*
 * Wording for the Chief's "Choose the Head of House" section.
 * Feature-local on purpose for this step; to be moved into the central
 * en.ts / my.ts dictionaries in the translations step. Client-safe: no
 * server-only imports. The Burmese text should be reviewed by a native speaker.
 */
export interface PendingHeadText {
  title: string;
  description: string;
  registered: string;
  approveTrigger: string;
  approveConfirmBody: string;
  approveConfirm: string;
  inactiveNote: string;
}

export const pendingHeadText: Record<LanguagePreference, PendingHeadText> = {
  EN: {
    title: "Choose the Head of House",
    description:
      "This house has no Head of House yet. Approve one member as Head of House. The other pending members will then wait for the new head's approval.",
    registered: "Registered {date}",
    approveTrigger: "Approve as Head of House",
    approveConfirmBody:
      "{name} will become the Head of House and will approve the other pending members of this house.",
    approveConfirm: "Yes, approve as head",
    inactiveNote:
      "Reactivate this house before approving a Head of House. You can still reject pending requests.",
  },
  MY: {
    title: "အိမ်ထောင်စုခေါင်းဆောင် ရွေးချယ်ရန်",
    description:
      "ဤအိမ်တွင် အိမ်ထောင်စုခေါင်းဆောင် မရှိသေးပါ။ အဖွဲ့ဝင်တစ်ဦးကို အိမ်ထောင်စုခေါင်းဆောင်အဖြစ် အတည်ပြုပါ။ ကျန်သော စောင့်ဆိုင်းနေသူများသည် အိမ်ထောင်စုခေါင်းဆောင်အသစ်၏ အတည်ပြုချက်ကို စောင့်ရပါမည်။",
    registered: "စာရင်းသွင်းသည့်ရက် {date}",
    approveTrigger: "အိမ်ထောင်စုခေါင်းဆောင်အဖြစ် အတည်ပြုရန်",
    approveConfirmBody:
      "{name} သည် အိမ်ထောင်စုခေါင်းဆောင် ဖြစ်လာမည်ဖြစ်ပြီး ဤအိမ်၏ ကျန်စောင့်ဆိုင်းနေသူများကို အတည်ပြုရမည်။",
    approveConfirm: "ဟုတ်ကဲ့၊ ခေါင်းဆောင်အဖြစ် အတည်ပြုမည်",
    inactiveNote:
      "အိမ်ကို ပြန်ဖွင့်ပြီးမှ အိမ်ထောင်စုခေါင်းဆောင်ကို အတည်ပြုနိုင်မည်။ စောင့်ဆိုင်းနေသော တောင်းဆိုမှုများကို ပယ်ချနိုင်ပါသေးသည်။",
  },
};

export function getPendingHeadText(
  language: LanguagePreference,
): PendingHeadText {
  return pendingHeadText[language] ?? pendingHeadText.EN;
}
