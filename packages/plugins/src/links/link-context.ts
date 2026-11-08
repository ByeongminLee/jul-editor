// Host injection points for the views (same pattern as ResolveDataProvider):
// wrap <Editor> in <LinkContextProvider value={{ fetchMetadata, iframePolicy }}>.
// Without a provider: no metadata fetch (URL-rule cards) and default-deny iframes
// (only built-in provider transforms render).
import { createContext, useContext } from "react";
import type { IframePolicy } from "./iframe.js";
import type { FetchMetadata } from "./metadata.js";

export interface LinkContextValue {
  fetchMetadata?: FetchMetadata;
  iframePolicy?: IframePolicy;
}

const LinkContext = /* @__PURE__ */ createContext<LinkContextValue>({});
export const LinkContextProvider = LinkContext.Provider;
export function useLinkContext(): LinkContextValue {
  return useContext(LinkContext);
}
