// @jul-editor/plugins is injected with a resolveData(source) =>
// Promise<Rows>. A React context is the injection point so ChartView/
// DataTableView don't need a `resolveData` prop threaded through the fixed
// VoidRendererProps shape (see viewProps.ts) -- a consumer who has `view`
// or URL sources wraps its <Editor> in <ResolveDataProvider value={...}>.
// createFetchResolveData is the opt-in HTTP(S) resolver; without a provider,
// views fall back to `defaultResolveData` (inline CSV/JSON only).
import { createContext, useContext } from "react";
import { defaultResolveData, type ResolveData } from "./data";

const ResolveDataContext = /* @__PURE__ */ createContext<ResolveData>(defaultResolveData);

export const ResolveDataProvider = ResolveDataContext.Provider;

export function useResolveData(): ResolveData {
  return useContext(ResolveDataContext);
}
