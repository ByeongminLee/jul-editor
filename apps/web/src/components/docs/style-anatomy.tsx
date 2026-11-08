import { useState } from "react";
import { useSiteSettings } from "../../app/site-settings.js";
import "../../styles/docs-style-anatomy.css";

type Kind = "toolbar" | "slash" | "chart" | "workspace" | "diagram" | "table";
type Region = { key: string; x: number; y: number; width: number; height: number; labelX: number; labelY: number };

const diagrams: Record<Kind, { en: string; ko: string; regions: Region[] }> = {
  toolbar: { en: "Toolbar", ko: "툴바", regions: [
    { key: "container", x: 180, y: 98, width: 398, height: 100, labelX: 18, labelY: 50 },
    { key: "button", x: 213, y: 123, width: 64, height: 50, labelX: 18, labelY: 232 },
    { key: "text", x: 228, y: 140, width: 36, height: 17, labelX: 601, labelY: 69 },
  ] },
  slash: { en: "Slash menu", ko: "슬래시 메뉴", regions: [
    { key: "container", x: 283, y: 36, width: 270, height: 236, labelX: 18, labelY: 47 },
    { key: "item", x: 299, y: 88, width: 238, height: 82, labelX: 18, labelY: 185 },
    { key: "text", x: 331, y: 101, width: 92, height: 23, labelX: 601, labelY: 67 },
    { key: "description", x: 331, y: 130, width: 176, height: 19, labelX: 601, labelY: 201 },
  ] },
  chart: { en: "Chart", ko: "차트", regions: [
    { key: "container", x: 191, y: 33, width: 367, height: 248, labelX: 18, labelY: 43 },
    { key: "plot", x: 215, y: 67, width: 320, height: 147, labelX: 18, labelY: 168 },
    { key: "tooltip", x: 388, y: 88, width: 125, height: 68, labelX: 601, labelY: 82 },
    { key: "legend", x: 270, y: 191, width: 174, height: 19, labelX: 601, labelY: 163 },
    { key: "controls", x: 215, y: 230, width: 320, height: 34, labelX: 601, labelY: 246 },
  ] },
  workspace: { en: "Code Workspace", ko: "코드 워크스페이스", regions: [
    { key: "container", x: 173, y: 26, width: 421, height: 258, labelX: 18, labelY: 36 },
    { key: "tree", x: 188, y: 59, width: 141, height: 210, labelX: 18, labelY: 173 },
    { key: "tabs", x: 334, y: 59, width: 244, height: 33, labelX: 601, labelY: 55 },
    { key: "toolbar", x: 334, y: 98, width: 244, height: 36, labelX: 601, labelY: 120 },
    { key: "gutter", x: 334, y: 140, width: 44, height: 129, labelX: 18, labelY: 250 },
    { key: "code", x: 384, y: 140, width: 194, height: 129, labelX: 601, labelY: 230 },
  ] },
  diagram: { en: "Diagram", ko: "다이어그램", regions: [
    { key: "container", x: 183, y: 30, width: 393, height: 249, labelX: 18, labelY: 40 },
    { key: "source", x: 199, y: 68, width: 167, height: 191, labelX: 18, labelY: 181 },
    { key: "preview", x: 382, y: 68, width: 177, height: 191, labelX: 601, labelY: 76 },
    { key: "error", x: 402, y: 214, width: 139, height: 28, labelX: 601, labelY: 220 },
  ] },
  table: { en: "Data table", ko: "데이터 표", regions: [
    { key: "container", x: 184, y: 29, width: 392, height: 253, labelX: 18, labelY: 36 },
    { key: "head", x: 202, y: 71, width: 356, height: 39, labelX: 18, labelY: 128 },
    { key: "row", x: 202, y: 115, width: 356, height: 44, labelX: 18, labelY: 215 },
    { key: "cell", x: 377, y: 115, width: 181, height: 44, labelX: 601, labelY: 153 },
    { key: "controls", x: 202, y: 223, width: 356, height: 38, labelX: 601, labelY: 232 },
  ] },
};

export function DocsStyleAnatomy() {
  const { locale } = useSiteSettings();
  const [kind, setKind] = useState<Kind>("toolbar");
  const diagram = diagrams[kind];
  return <div className="docs-style-anatomy" aria-label={locale === "ko" ? "컴포넌트 스타일 영역" : "Component style anatomy"}>
    <div className="docs-style-anatomy-tabs" role="group" aria-label={locale === "ko" ? "컴포넌트 선택" : "Choose a component"}>
      {(Object.keys(diagrams) as Kind[]).map((key) => <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}>{diagrams[key][locale]}</button>)}
    </div>
    <div className="docs-style-anatomy-scroll"><svg viewBox="0 0 760 310" role="img" aria-label={`${diagram[locale]} ${locale === "ko" ? "클래스 영역 도식" : "class slots diagram"}`}>
      <defs><marker id="style-slot-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="none" stroke="currentColor" strokeWidth="1.3" /></marker></defs>
      <rect x="0" y="0" width="760" height="310" rx="12" className="anatomy-canvas" />
      {diagram.regions.map((region, index) => <g key={region.key}>
        <rect x={region.x} y={region.y} width={region.width} height={region.height} rx="7" className={`anatomy-region anatomy-region-${index}`} />
        <line x1={region.labelX < region.x ? region.labelX + 144 : region.labelX} y1={region.labelY + 15} x2={region.labelX < region.x ? region.x + 6 : region.x + region.width - 6} y2={region.y + Math.min(region.height / 2, 31)} className="anatomy-arrow" markerEnd="url(#style-slot-arrow)" />
        <rect x={region.labelX} y={region.labelY} width="145" height="30" rx="5" className="anatomy-label" />
        <text x={region.labelX + 10} y={region.labelY + 20}>{region.key}</text>
      </g>)}
      <g className="anatomy-preview-content" aria-hidden="true">
        {kind === "toolbar" && <><text x="236" y="152">B</text><text x="303" y="152">I</text><text x="360" y="152">H2</text><text x="427" y="152">↶</text></>}
        {kind === "slash" && <><text x="301" y="72">INSERT BLOCK</text><text x="339" y="119">Heading 1</text><text x="339" y="146">A large section title</text><text x="312" y="215">Paragraph</text></>}
        {kind === "chart" && <><rect x="241" y="156" width="35" height="38" /><rect x="291" y="132" width="35" height="62" /><rect x="341" y="108" width="35" height="86" /><text x="400" y="119">Jan · 120</text><text x="303" y="205">●  Visitors</text></>}
        {kind === "workspace" && <><text x="199" y="93">src/</text><text x="210" y="117">index.ts</text><text x="347" y="81">index.ts</text><text x="347" y="121">+  3-7, 11</text><text x="345" y="165">1</text><text x="392" y="165">const doc = ...</text></>}
        {kind === "diagram" && <><text x="210" y="99">graph TD</text><text x="210" y="125">A --&gt; B</text><text x="420" y="130">A → B</text><text x="411" y="233">Error</text></>}
        {kind === "table" && <><text x="213" y="94">Month</text><text x="392" y="94">Visitors</text><text x="213" y="143">Jan</text><text x="392" y="143">120</text><text x="215" y="248">Source · CSV</text></>}
      </g>
    </svg></div>
    <p>{locale === "ko" ? "레이블은 className 객체의 키입니다. 아래 표에서 같은 영역의 DOM 훅도 확인할 수 있습니다." : "Each label is a className object key. The table below lists matching DOM hooks."}</p>
  </div>;
}

export default DocsStyleAnatomy;
