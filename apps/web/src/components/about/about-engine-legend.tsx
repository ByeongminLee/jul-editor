import { ENGINE_NAMES, type EngineId } from "../../lib/about-engines.js";
import { useSiteSettings } from "../../app/site-settings.js";
import "../../styles/about-diagram.css";

/** One fixed color per engine, shared with the About charts and the swimlane lane dots. */
export function AboutEngineLegend() {
  const { t } = useSiteSettings();
  return <ul className="ap-legend" aria-label={t("Engine colors", "엔진별 색상")}>
    {(Object.keys(ENGINE_NAMES) as EngineId[]).map((id) => <li key={id} data-engine={id}><span className="ap-swatch" aria-hidden="true" />{ENGINE_NAMES[id]}</li>)}
  </ul>;
}
