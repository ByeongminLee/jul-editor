// Controls for a selected chart block, grouped into Type, Data, Axes and Colors
// sections. Every element carries a stable `jul-editor-chart-editor__*` class
// (plus data-active / aria state and a data-testid), so a host styles it with
// plain CSS. The component ships only zero-specificity structural defaults
// (layout, spacing, a visible active state) in one <style> element built from
// :where() selectors, so any host rule overrides them without !important.
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { Json } from "@jul-editor/core";
import { parseCSV, parseJSON, type ColumnType, type DataSource, type RangeSpec } from "../data";
import type { ChartKind } from "./recharts-chart.js";
import { DEFAULT_COLORS, DEFAULT_PALETTE_HEX, PALETTE_PRESETS, PALETTE_SIZE, type ColorBy } from "./palette.js";

export interface ChartEditorProps {
  locale?: "en" | "ko";
  kind: ChartKind;
  source: DataSource;
  range: RangeSpec | null;
  x: string;
  /** First selected series (kept for single-series callers). */
  y: string;
  /** All selected series; defaults to `[y]`. */
  ys?: string[];
  columns: string[];
  yColumns: string[];
  /** Types of `columns`, used for the data preview of URL/view sources. */
  columnTypes?: ColumnType[];
  palette?: string[] | null;
  colorBy?: ColorBy;
  updateProps: (patch: Record<string, Json | undefined>) => void;
}

export const KINDS: ChartKind[] = ["bar", "line", "area", "pie", "radar", "radial"];

export const SAMPLE_CSV = "Month,Visitors,Signups,Revenue\nJan,120,30,42\nFeb,160,44,55\nMar,140,38,51\nApr,220,71,90\nMay,260,85,112";
export const SAMPLE_JSON = JSON.stringify([
  { Month: "Jan", Visitors: 120, Signups: 30, Revenue: 42 },
  { Month: "Feb", Visitors: 160, Signups: 44, Revenue: 55 },
  { Month: "Mar", Visitors: 140, Signups: 38, Revenue: 51 },
  { Month: "Apr", Visitors: 220, Signups: 71, Revenue: 90 },
  { Month: "May", Visitors: 260, Signups: 85, Revenue: 112 },
], null, 2);

const CARTESIAN: ChartKind[] = ["bar", "line", "area"];

function KindIcon({ kind }: { kind: ChartKind }): ReactNode {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "bar": return <svg {...common}><path d="M5 20V11M12 20V4M19 20v-6" /></svg>;
    case "line": return <svg {...common}><path d="M3 17l5-6 4 3 8-9" /></svg>;
    case "area": return <svg {...common}><path d="M3 18l5-7 4 3 8-8v12z" /></svg>;
    case "pie": return <svg {...common}><path d="M12 3v9h9" /><circle cx="12" cy="12" r="9" /></svg>;
    case "radar": return <svg {...common}><path d="M12 3l8 6-3 10H7L4 9z" /><path d="M12 8l4 3-1.5 5h-5L8 11z" /></svg>;
    default: return <svg {...common}><path d="M12 3a9 9 0 1 1-9 9" /><path d="M12 8a4 4 0 1 1-4 4" /></svg>;
  }
}

const ROOT = ".jul-editor-chart-editor";
const DEFAULT_STYLES = `
:where(${ROOT}) { display: flex; flex-direction: column; gap: 10px; min-width: 0; font-size: 12px; }
:where(${ROOT}__title, ${ROOT}__heading) { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
:where(${ROOT}__section) { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
:where(${ROOT}__row) { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
:where(${ROOT}__kinds) { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 6px; }
:where(${ROOT}__field) { display: flex; flex-direction: column; gap: 4px; min-width: 140px; flex: 1 1 140px; }
:where(${ROOT}__label) { font-size: 11px; opacity: .75; }
:where(${ROOT}__kind) { display: flex; flex-direction: column; align-items: center; gap: 3px; }
:where(${ROOT}__formats) { display: inline-flex; gap: 4px; }
:where(${ROOT}__code) { box-sizing: border-box; width: 100%; min-height: 110px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
:where(${ROOT}__button, ${ROOT}__choice) { cursor: pointer; font: inherit; font-size: 12px; }
:where(${ROOT}__button[data-active], ${ROOT}__choice[data-active]) { font-weight: 650; text-decoration: underline; }
:where(${ROOT}__choice) { display: inline-flex; align-items: center; gap: 5px; }
:where(${ROOT}__preview) { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; }
:where(${ROOT}__chip em) { opacity: .65; }
:where(${ROOT}__palette) { display: inline-flex; align-items: center; gap: 6px; }
:where(${ROOT}__swatches) { display: inline-flex; }
:where(${ROOT}__swatch) { display: inline-block; width: 9px; height: 14px; }
:where(${ROOT}__color) { width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
:where(${ROOT}__error) { font-size: 12px; color: #d1495b; }
`;

interface Preview { error: string | null; columns: string[]; types: ColumnType[]; rows: number | null }

function previewOf(source: DataSource, columns: string[], columnTypes: ColumnType[] | undefined): Preview {
  if (source.type === "inline") {
    const json = "format" in source && source.format === "json";
    const text = (json ? source.json : source.csv) ?? "";
    if (text.trim() === "") return { error: null, columns: [], types: [], rows: 0 };
    try {
      const table = json ? parseJSON(text) : parseCSV(text);
      return { error: null, columns: table.columns, types: table.columnTypes, rows: table.rows.length };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), columns: [], types: [], rows: null };
    }
  }
  return { error: null, columns, types: columnTypes ?? columns.map(() => "string" as ColumnType), rows: null };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Best-effort hex for a palette entry: a literal hex, else the host's `--chart-N` value, else the built-in default. */
function swatchHex(color: string, index: number, el: HTMLElement | null): string {
  if (HEX.test(color)) return color;
  const name = /^var\((--[\w-]+)/.exec(color)?.[1];
  const themed = name && el ? getComputedStyle(el).getPropertyValue(name).trim() : "";
  if (HEX.test(themed)) return themed;
  const fallback = /,\s*(#[0-9a-fA-F]{6})\s*\)$/.exec(color)?.[1];
  return fallback ?? DEFAULT_PALETTE_HEX[index % PALETTE_SIZE]!;
}

/**
 * One palette color input. Dragging inside the browser's color picker fires `input` on every step;
 * those only update a local draft. The palette is written once when the value is committed
 * (native `change` when the picker closes, or blur), so a drag is a single history step.
 */
function ColorSwatch({ index, color, label, onCommit, "data-testid": testId }: { "data-testid": string; index: number; color: string; label: string; onCommit: (hex: string) => void }): ReactNode {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [resolved, setResolved] = useState(() => swatchHex(color, index, null));
  // A palette change (our own commit landing, or an external edit) supersedes any lingering draft, so the swatch
  // follows the palette even while it keeps focus.
  useEffect(() => { setDraft(null); lastCommitted.current = null; setResolved(swatchHex(color, index, ref.current)); }, [color, index]);
  const lastCommitted = useRef<string | null>(null);
  // change and blur can both arrive before the rerender that reflects the first commit; commit a value once.
  const commit = (hex: string) => {
    if (lastCommitted.current !== hex.toLowerCase() && (hex.toLowerCase() !== resolved.toLowerCase() || !HEX.test(color))) { lastCommitted.current = hex.toLowerCase(); onCommit(hex); }
    setDraft(null);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => commitRef.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return <input ref={ref} type="color" className="jul-editor-chart-editor__color" aria-label={label} data-testid={testId}
    value={draft ?? resolved}
    onChange={(e) => setDraft(e.target.value)}
    onBlur={(e) => { if (draft !== null) commit(e.target.value); }} />;
}

export function ChartEditor({ kind, source, range, x, y, ys, columns, yColumns, columnTypes, palette, colorBy, updateProps, locale = "en" }: ChartEditorProps): ReactNode {
  const t = (en: string, ko: string) => locale === "ko" ? ko : en;
  const kindsEn = { bar: "Bar", line: "Line", area: "Area", pie: "Pie", radar: "Radar", radial: "Radial" };
  const kindsKo = { bar: "막대", line: "꺾은선", area: "영역", pie: "원형", radar: "레이더", radial: "방사형" };
  const format: "csv" | "json" | null = source.type === "view" ? null : source.type === "url" ? source.format : "format" in source && source.format === "json" ? "json" : "csv";
  const selected = ys && ys.length ? ys : y ? [y] : [];
  const cartesian = CARTESIAN.includes(kind);
  const multi = cartesian || kind === "radar";
  const preview = previewOf(source, columns, columnTypes);
  const typeNames: Record<ColumnType, string> = { number: t("number", "숫자"), date: t("date", "날짜"), string: t("text", "텍스트") };

  const switchFormat = (next: "csv" | "json") => {
    if (source.type === "url") updateProps({ source: { ...source, format: next } });
    else if (source.type === "inline") updateProps({ source: next === "json"
      ? { type: "inline", format: "json", json: source.json ?? "[]", ...(source.csv !== undefined ? { csv: source.csv } : {}) }
      : { type: "inline", csv: source.csv ?? "", ...(source.json !== undefined ? { json: source.json } : {}) } });
  };
  const loadSample = () => {
    if (source.type !== "inline") return;
    updateProps({
      source: format === "json"
        ? { type: "inline", format: "json", json: SAMPLE_JSON, ...(source.csv !== undefined ? { csv: source.csv } : {}) }
        : { type: "inline", csv: SAMPLE_CSV, ...(source.json !== undefined ? { json: source.json } : {}) },
      x: undefined, y: undefined, range: null,
    });
  };
  const setSeries = (names: string[]) => updateProps({ y: names.length === 1 ? names[0]! : names });
  const toggleSeries = (name: string) => {
    if (selected.includes(name)) { if (selected.length > 1) setSeries(selected.filter((c) => c !== name)); }
    else setSeries(yColumns.filter((c) => c === name || selected.includes(c)));
  };

  // Editing one swatch starts from the stored palette, or from the themeable defaults
  // (`var(--chart-N, #hex)`), so slots the user did not touch keep following the host theme.
  const basePalette = (palette && palette.length ? palette : DEFAULT_COLORS).slice();
  while (basePalette.length < PALETTE_SIZE) basePalette.push(DEFAULT_COLORS[basePalette.length % PALETTE_SIZE]!);
  const showColorBy = kind === "bar" && selected.length === 1;
  const effectiveColorBy = colorBy ?? "category";

  const columnSelect = (testId: string, label: string, value: string, options: string[], emptyText: string, onChange: (v: string) => void) => (
    <label className="jul-editor-chart-editor__field">
      <span className="jul-editor-chart-editor__label">{label}</span>
      <select aria-label={label} className="jul-editor-chart-editor__select" data-testid={testId} value={value} disabled={!options.length} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
        {!options.length && <option value="">{emptyText}</option>}
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
  const noColumns = t("No columns available", "선택할 열이 없습니다");
  const noNumeric = t("No numeric columns available", "선택할 숫자 열이 없습니다");

  return (
    <div data-jul-editor-plugin="chart-editor" className="jul-editor-chart-editor">
      <style data-jul-editor-chart-editor-style="">{DEFAULT_STYLES}</style>
      <span data-chart-editor-title="" className="jul-editor-chart-editor__title">{t("Chart settings", "차트 설정")}</span>

      <div data-chart-editor-section="type" className="jul-editor-chart-editor__section">
        <span className="jul-editor-chart-editor__heading">{t("Type", "종류")}</span>
        <div role="radiogroup" aria-label={t("Chart type", "차트 종류")} data-testid="jul-editor-chart-kind" className="jul-editor-chart-editor__kinds">
          {KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} data-testid={`jul-editor-chart-kind-${k}`}
              className="jul-editor-chart-editor__button jul-editor-chart-editor__kind" data-active={kind === k ? "" : undefined}
              onClick={() => updateProps({ kind: k })}>
              <KindIcon kind={k} />
              <span>{locale === "ko" ? kindsKo[k] : kindsEn[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <div data-chart-editor-section="data" className="jul-editor-chart-editor__section">
        <span className="jul-editor-chart-editor__heading">{t("Data", "데이터")}</span>
        <div className="jul-editor-chart-editor__row">
          <select aria-label={t("Data source", "데이터 소스")} className="jul-editor-chart-editor__select" data-testid="jul-editor-chart-source" value={source.type} onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            const type = e.target.value;
            updateProps({ source: type === "url" ? { type: "url", format: "csv", url: "" } : type === "view" ? { type: "view", viewId: "" } : { type: "inline", csv: "" } });
          }}>
            <option value="inline">{t("Inline", "직접 입력")}</option>
            <option value="url">URL</option>
            <option value="view">{t("Host view", "호스트 뷰")}</option>
          </select>
          {format && (
            <div role="tablist" aria-label={t("Data format", "데이터 형식")} data-testid="jul-editor-chart-format" className="jul-editor-chart-editor__formats">
              {(["csv", "json"] as const).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={format === f} data-testid={`jul-editor-chart-format-${f}`} className="jul-editor-chart-editor__button" data-active={format === f ? "" : undefined} onClick={() => switchFormat(f)}>{f.toUpperCase()}</button>
              ))}
            </div>
          )}
          {source.type === "inline" && <button type="button" data-testid="jul-editor-chart-sample" className="jul-editor-chart-editor__button" onClick={loadSample}>{t("Load sample", "샘플 불러오기")}</button>}
        </div>
        {source.type === "inline" && (
          <>
            {format === "json" ? <textarea
              spellCheck={false} className="jul-editor-chart-editor__code"
              aria-label={t("Chart JSON data", "차트 JSON 데이터")}
              aria-invalid={preview.error ? true : undefined}
              placeholder={'[{"Month":"Jan","Visitors":120}]'}
              data-testid="jul-editor-chart-json"
              value={source.json ?? ""}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateProps({ source: { type: "inline", format: "json", json: e.target.value, ...(source.csv !== undefined ? { csv: source.csv } : {}) } })}
            /> : <textarea
              spellCheck={false} className="jul-editor-chart-editor__code"
              aria-label={t("Chart CSV data", "차트 CSV 데이터")}
              aria-invalid={preview.error ? true : undefined}
              placeholder={"Month,Visitors\nJan,120"}
              data-testid="jul-editor-chart-csv"
              value={source.csv ?? ""}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateProps({ source: { type: "inline", csv: e.target.value, ...(source.json !== undefined ? { json: source.json } : {}) } })}
            />}
            <input
              aria-label={t("Data range", "데이터 범위")}
              placeholder={t("Range, e.g. A1:C10", "범위 예: A1:C10")}
              data-testid="jul-editor-chart-range" className="jul-editor-chart-editor__input"
              type="text"
              value={typeof range === "string" ? range : ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => updateProps({ range: e.target.value === "" ? null : e.target.value })}
            />
          </>
        )}
        {source.type === "url" && <input
          aria-label={t("Chart data URL", "차트 데이터 URL")}
          data-testid="jul-editor-chart-url" className="jul-editor-chart-editor__input"
          type="url"
          value={source.url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateProps({ source: { ...source, url: e.target.value } })}
        />}
        {source.type === "view" && <input
          aria-label={t("View ID", "뷰 ID")}
          data-testid="jul-editor-chart-view-id" className="jul-editor-chart-editor__input"
          type="text"
          value={source.viewId}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateProps({ source: { ...source, viewId: e.target.value } })}
        />}
        {preview.error && <div role="alert" data-testid="jul-editor-chart-error" className="jul-editor-chart-editor__error">
          {t("Could not parse data: ", "데이터를 해석할 수 없습니다: ")}{preview.error}
        </div>}
        {!preview.error && preview.columns.length > 0 && <div data-testid="jul-editor-chart-preview" className="jul-editor-chart-editor__preview">
          {preview.columns.map((c, i) => <span key={`${c}-${i}`} className="jul-editor-chart-editor__chip">
            {c} <em>{typeNames[preview.types[i] ?? "string"]}</em>
          </span>)}
          {preview.rows !== null && <span className="jul-editor-chart-editor__rows">{t(`${preview.rows} rows`, `${preview.rows}행`)}</span>}
        </div>}
      </div>

      <div data-chart-editor-section="axes" className="jul-editor-chart-editor__section">
        <span className="jul-editor-chart-editor__heading">{cartesian ? t("Axes", "축") : kind === "radar" ? t("Axes", "축") : t("Mapping", "매핑")}</span>
        <div className="jul-editor-chart-editor__row">
          {columnSelect("jul-editor-chart-x",
            cartesian ? t("Category column", "범주 열") : kind === "radar" ? t("Axis column", "축 열") : t("Label column", "레이블 열"),
            x, columns, noColumns, (v) => updateProps({ x: v }))}
          {multi ? (
            <div className="jul-editor-chart-editor__field">
              <span className="jul-editor-chart-editor__label">{cartesian ? t("Y axis series", "Y축 계열") : t("Series", "계열")}</span>
              <div role="group" aria-label={t("Value columns", "값 열")} data-testid="jul-editor-chart-y" className="jul-editor-chart-editor__row">
                {!yColumns.length && <span className="jul-editor-chart-editor__empty">{noNumeric}</span>}
                {yColumns.map((c) => {
                  const on = selected.includes(c);
                  return <label key={c} className="jul-editor-chart-editor__choice" data-active={on ? "" : undefined}>
                    <input type="checkbox" data-testid={`jul-editor-chart-y-${c}`} checked={on} onChange={() => toggleSeries(c)} />
                    {c}
                  </label>;
                })}
              </div>
            </div>
          ) : columnSelect("jul-editor-chart-y", t("Value column", "값 열"), y, yColumns, noNumeric, (v) => updateProps({ y: v }))}
        </div>
      </div>

      <div data-chart-editor-section="colors" className="jul-editor-chart-editor__section">
        <span className="jul-editor-chart-editor__heading">{t("Colors", "색상")}</span>
        <div className="jul-editor-chart-editor__row" data-testid="jul-editor-chart-palettes">
          {PALETTE_PRESETS.map((p) => (
            <button key={p.id} type="button" aria-label={locale === "ko" ? `${p.ko} 팔레트` : `${p.en} palette`} data-testid={`jul-editor-chart-palette-${p.id}`}
              className="jul-editor-chart-editor__button jul-editor-chart-editor__palette"
              onClick={() => updateProps({ palette: p.id === "default" ? undefined : [...p.colors] })}>
              <span aria-hidden="true" className="jul-editor-chart-editor__swatches">
                {p.colors.slice(0, 4).map((c) => <span key={c} className="jul-editor-chart-editor__swatch" style={{ background: c }} />)}
              </span>
              {locale === "ko" ? p.ko : p.en}
            </button>
          ))}
        </div>
        <div className="jul-editor-chart-editor__row">
          {basePalette.map((color, i) => (
            <ColorSwatch key={i} data-testid={`jul-editor-chart-color-${i}`} index={i} color={color} label={t(`Color ${i + 1}`, `색상 ${i + 1}`)}
              onCommit={(hex) => { const next = basePalette.slice(); next[i] = hex; updateProps({ palette: next }); }} />
          ))}
          <button type="button" data-testid="jul-editor-chart-palette-reset" className="jul-editor-chart-editor__button" disabled={!palette} onClick={() => updateProps({ palette: undefined })}>
            {t("Reset to theme default", "테마 기본값으로")}
          </button>
        </div>
        {showColorBy && (
          <div role="radiogroup" aria-label={t("Color by", "색상 기준")} data-testid="jul-editor-chart-colorby" className="jul-editor-chart-editor__row">
            {(["category", "series"] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={effectiveColorBy === c} data-testid={`jul-editor-chart-colorby-${c}`} className="jul-editor-chart-editor__button" data-active={effectiveColorBy === c ? "" : undefined}
                onClick={() => updateProps({ colorBy: c })}>
                {c === "category" ? t("Each category", "범주별") : t("One color", "단일 색")}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
