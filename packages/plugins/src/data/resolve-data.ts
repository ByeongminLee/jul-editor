// Resolves chart/diagram/dataTable's `props.source` into rows.
// A source is stored on a block as JSON. Inline CSV remains compatible with
// existing documents; URL fetching is opt-in through createFetchResolveData.
import { parseCSV, type Table } from "./csv.js";
import { parseJSON } from "./json.js";

export type DataSource =
  | { type: "inline"; csv: string; json?: string }
  | { type: "inline"; format: "json"; json: string; csv?: string }
  | { type: "url"; format: "csv" | "json"; url: string }
  | { type: "view"; viewId: string };

export type ResolveData = (source: DataSource) => Promise<Table>;

export function readDataSource(value: unknown): DataSource {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (source.type === "inline" && source.format === "json" && typeof source.json === "string") return { type: "inline", format: "json", json: source.json, ...(typeof source.csv === "string" ? { csv: source.csv } : {}) };
    if (source.type === "inline" && typeof source.csv === "string") return { type: "inline", csv: source.csv, ...(typeof source.json === "string" ? { json: source.json } : {}) };
    if (source.type === "url" && (source.format === "csv" || source.format === "json") && typeof source.url === "string") return { type: "url", format: source.format, url: source.url };
    if (source.type === "view" && typeof source.viewId === "string") return { type: "view", viewId: source.viewId };
  }
  return { type: "inline", csv: "" };
}

/** Thrown by `defaultResolveData` for a `view` source -- there is no
 * consumer-independent way to fetch one. Views (ChartView/DataTableView)
 * catch this specifically to render a headless "missing resolver" state
 * instead of an error state. */
export class MissingResolverError extends Error {
  readonly viewId: string;
  constructor(viewId: string) {
    super(`no resolveData resolver provided for view source "${viewId}"`);
    this.name = "MissingResolverError";
    this.viewId = viewId;
  }
}

export class MissingUrlResolverError extends Error {
  constructor() {
    super("no URL data resolver provided");
    this.name = "MissingUrlResolverError";
  }
}

/** Resolves inline data without network access. URL and view sources need a resolver. */
export const defaultResolveData: ResolveData = async (source) => {
  if (source.type === "inline") return "format" in source && source.format === "json" ? parseJSON(source.json) : parseCSV(source.csv);
  if (source.type === "url") throw new MissingUrlResolverError();
  throw new MissingResolverError(source.viewId);
};

/** Opt-in HTTP(S) CSV/JSON fetching; a host resolver may still own view IDs. */
export function createFetchResolveData(
  fetcher: (url: string) => Promise<Response> = fetch,
  resolveView: ResolveData = defaultResolveData,
): ResolveData {
  return async (source) => {
    if (source.type === "inline") return defaultResolveData(source);
    if (source.type === "view") return resolveView(source);
    let url: URL;
    try { url = new URL(source.url); } catch { throw new Error("data URL must be an absolute HTTP(S) URL"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("data URL must be an absolute HTTP(S) URL");
    const response = await fetcher(source.url);
    if (!response.ok) throw new Error(`data URL request failed (HTTP ${response.status})`);
    const body = await response.text();
    return source.format === "json" ? parseJSON(body) : parseCSV(body);
  };
}
