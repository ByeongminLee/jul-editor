import type { Block, Doc, Inline } from "@jul-editor/core";

// Sample document for the Notion-like showcase: the same shape as Tiptap's Notion-like template
// ("Welcome to Notion-like template", an invite callout, "Try some Markdown", a toggle, columns ...).
// Block ids are stable ("nt-...") so tests and comments can address them.

type Locale = "en" | "ko";
type Part = string | ["b" | "i" | "c", string] | ["m", string, string];

const inline = (parts: Part[]): Inline[] => parts.map((part): Inline => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part[0] === "m") return { type: "mention", attrs: { kind: "user", id: part[1], label: part[2] } };
  const mark = part[0] === "b" ? "bold" : part[0] === "i" ? "italic" : "code";
  return { type: "text", text: part[1], marks: [{ type: mark }] };
});

const p = (id: string, ...parts: Part[]): Block => ({ id, type: "paragraph", props: {}, content: inline(parts) });
const h = (id: string, level: 1 | 2 | 3, text: string): Block => ({ id, type: "heading", props: { level }, content: [{ type: "text", text }] });
const li = (id: string, type: "bulletListItem" | "todoListItem", text: string, checked = false): Block => ({
  id, type, props: type === "todoListItem" ? { checked } : {}, content: [{ type: "text", text }],
});

export const NOTION_DOC_ID = "jul-notion-showcase";

export function notionSampleDoc(locale: Locale): Doc {
  const ko = locale === "ko";
  const t = (en: string, kr: string) => (ko ? kr : en);

  const markdownCheatsheet = ko
    ? "# 제목\n- 목록\n> 인용\n`인라인 코드`\n---"
    : "# Headings\n- Lists\n> Quotes\n`Inline code`\n---";

  return {
    version: 1,
    blocks: [
      h("nt-title", 1, t("Welcome to Notion-like template", "노션형 템플릿에 오신 것을 환영합니다")),
      {
        id: "nt-invite", type: "callout", props: { icon: "👋", color: "info" },
        content: inline([["b", t("Invite your colleagues. ", "동료를 초대해 보세요. ")], t("Open this page in another tab to edit together in real time, with live cursors and comments.", "이 페이지를 다른 탭에서 열면 실시간 커서와 댓글과 함께 같이 편집할 수 있습니다.")]),
      },
      p("nt-lead", t("A calm, block based workspace. Select text for the formatting bubble, press ", "차분한 블록형 작업 공간입니다. 글자를 선택하면 서식 메뉴가 나타나고, "), ["c", "/"], t(" for the command menu, and hover a block to drag it or open its menu.", " 를 누르면 명령 메뉴가, 블록에 마우스를 올리면 이동 핸들과 메뉴가 나타납니다.")),
      h("nt-h-markdown", 2, t("Try some Markdown", "마크다운을 써 보세요")),
      p("nt-md-intro", t("Type these at the start of a line, or paste Markdown anywhere. Use the ", "줄 맨 앞에 입력하거나 어디든 마크다운을 붙여 넣어 보세요. "), ["c", "/"], t(" command menu to see every block.", " 명령 메뉴에서 모든 블록을 볼 수 있습니다.")),
      { id: "nt-md-code", type: "codeBlock", props: { language: "markdown" }, content: [{ type: "text", text: markdownCheatsheet }] },
      { id: "nt-divider", type: "divider", props: {} },
      h("nt-h-blocks", 2, t("Blocks that hold other blocks", "다른 블록을 담는 블록")),
      {
        id: "nt-toggle", type: "toggle", props: { open: true },
        content: [{ type: "text", text: t("Toggle: click the arrow to collapse", "토글: 화살표를 눌러 접어 보세요") }],
        children: [
          p("nt-toggle-body", t("Anything can live inside a toggle: text, lists, even another toggle. Its open state is part of the document, so collaborators see it too.", "토글 안에는 글, 목록, 다른 토글까지 무엇이든 넣을 수 있습니다. 열림 상태는 문서의 일부라 함께 편집하는 사람에게도 보입니다.")),
        ],
      },
      {
        id: "nt-columns", type: "columns", props: {},
        children: [
          { id: "nt-col-1", type: "column", props: {}, children: [
            h("nt-col-1-h", 3, t("Write", "쓰기")),
            li("nt-col-1-a", "bulletListItem", t("Headings, lists and quotes", "제목, 목록, 인용")),
            li("nt-col-1-b", "bulletListItem", t("Callouts and toggles", "콜아웃과 토글")),
          ] },
          { id: "nt-col-2", type: "column", props: {}, children: [
            h("nt-col-2-h", 3, t("Collaborate", "협업")),
            li("nt-col-2-a", "bulletListItem", t("Live cursors across tabs", "탭 사이의 실시간 커서")),
            li("nt-col-2-b", "bulletListItem", t("Comments on any selection", "선택 영역에 댓글")),
          ] },
        ],
      },
      h("nt-h-links", 2, t("Links, bookmarks and embeds", "링크, 북마크, 임베드")),
      p("nt-links-intro", t("Paste a URL and choose Link, Bookmark, Embed or Mention. Metadata below is demo data, no network is used for the card.", "URL을 붙여 넣고 링크, 북마크, 임베드, 멘션 중에서 고르세요. 아래 카드의 메타데이터는 데모 데이터이며 네트워크를 쓰지 않습니다.")),
      { id: "nt-bookmark", type: "bookmark", props: { url: "https://github.com/example/jul-editor" } },
      { id: "nt-figma", type: "bookmark", props: { url: "https://www.figma.com/design/1234567890123456789/Jul-demo" } },
      p("nt-embed-note", t("The embed block below only loads after you click it, so opening this page makes no third-party request.", "아래 임베드 블록은 클릭해야 불러오므로 이 페이지를 열 때 외부 요청이 발생하지 않습니다.")),
      { id: "nt-embed", type: "iframe", props: { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", title: "Embed", height: 300 } },
      p("nt-mention", t("Ping ", "멘션: "), ["m", "mina", "Mina"], t(" about the design review.", " 님께 디자인 리뷰를 요청하세요.")),
      h("nt-h-todo", 2, t("To do", "할 일")),
      li("nt-todo-1", "todoListItem", t("Open this page in a second tab", "두 번째 탭에서 이 페이지 열기"), true),
      li("nt-todo-2", "todoListItem", t("Select a sentence and add a comment", "문장을 선택해 댓글 달기")),
      li("nt-todo-3", "todoListItem", t("Type /callout to add a note", "/callout 으로 노트 추가")),
      { id: "nt-divider-2", type: "divider", props: {} },
      h("nt-h-toc", 2, t("Table of contents", "목차")),
      { id: "nt-toc", type: "toc", props: {} },
      p("nt-end"),
    ],
  };
}
