import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryPanel } from "./history-panel";
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
for (const language of ["EN", "MY"] as const) {
  describe(`history recovery and navigation ${language}`, () => {
    it.each(["STALE", "CURSOR", "UNAVAILABLE", "DATE", "REVERSED", "REPEATED"] as const)("renders controlled %s recovery without records", (error) => {
      const markup = renderToStaticMarkup(createElement(TranslationProvider, { language }, createElement(HistoryPanel, {
        result: { ok: false, error, funds: [], villageId: "v", accessLevel: "own" },
        params: { dateFrom: "bad" }, basePath: "/village/receipts", children: "PRIVATE RECORDS",
      })));
      expect(markup).toContain('role="alert"'); expect(markup).not.toContain("PRIVATE RECORDS");
      expect(markup).toContain(getT(language)("history.restart")); expect(markup).toContain('value="bad"');
    });
    it("uses GET filter submission without old cursors and preserves filters in history links", () => {
      const markup = renderToStaticMarkup(createElement(TranslationProvider, { language }, createElement(HistoryPanel, {
        result: { ok: true, funds: [{ id: "f", name: "Historical Fund" }], villageId: "v", accessLevel: "own", payments: [], receipts: [], baseQuery: "fundId=f&status=VOIDED", older: "next", newer: "previous" },
        params: { fundId: "f", status: "VOIDED", cursor: "old" }, basePath: "/village/receipts", children: "RECORDS",
      })));
      expect(markup).toContain('method="get"'); expect(markup).not.toContain('name="cursor"');
      expect(markup).toContain("fundId=f&amp;status=VOIDED&amp;cursor=next&amp;direction=older");
      expect(markup).toContain("RECORDS"); expect(markup).toContain(getT(language)("history.timezone"));
    });
  });
}
