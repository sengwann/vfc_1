import type { ComponentProps, ReactNode } from "react";
import { HistoryPanel } from "./history-panel";

export function historyPanelElement(
  props: Omit<ComponentProps<typeof HistoryPanel>, "children">,
  content: ReactNode,
) {
  return <HistoryPanel {...props}>{content}</HistoryPanel>;
}
