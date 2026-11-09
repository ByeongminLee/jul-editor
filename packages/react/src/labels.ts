// I18n for every built-in UI label @jul-editor/react itself renders --
// SlashMenu's built-in item titles, MentionMenu's "Loading.../No results"/
// kind labels, TurnInto's labels, the toolbar atoms' default text + aria-
// labels, and CodeBlockView's language-select/copy-button labels. `<Editor
// locale>` picks a full preset (`EN_LABELS`/`KO_LABELS`); `<Editor labels>`
// overrides individual keys on top of it -- see Editor.tsx's own
// `resolveLabels` call. Default is 'en', and every EN_LABELS value below is
// the exact pre-i18n hardcoded string each component used to have baked in,
// so an app that passes neither prop sees byte-identical text to before.
//
// Search keywords (menus/slashItems.ts's BUILTIN_ITEMS) are NOT part of this
// -- they already carry both English and Korean terms unconditionally (e.g.
// `["text", "paragraph", "본문", "텍스트"]`), so "/tex" and "/텍" both find
// the same item regardless of which locale's TITLE is currently displayed.
export interface Labels {
  // ---- SlashMenu built-in item titles (menus/slashItems.ts) ----
  slashText: string;
  slashHeading1: string;
  slashHeading2: string;
  slashHeading3: string;
  slashHeading4: string;
  slashHeading5: string;
  slashHeading6: string;
  slashBulletList: string;
  slashOrderedList: string;
  slashTodoList: string;
  slashQuote: string;
  slashCode: string;
  slashDivider: string;
  slashImage: string;
  slashEmbedYoutube: string;
  slashEmbed: string;
  slashTable: string;
  slashChart: string;
  slashDiagram: string;
  slashDataTable: string;
  slashCodeWorkspace: string;
  slashNoResults: string;

  // ---- TurnInto's own curated item labels (turnInto.tsx) ----
  turnIntoText: string;
  turnIntoHeading1: string;
  turnIntoHeading2: string;
  turnIntoHeading3: string;
  turnIntoBulletList: string;
  turnIntoOrderedList: string;
  turnIntoTodoList: string;
  turnIntoQuote: string;
  turnIntoCode: string;

  // ---- toolbar atoms' default text + aria-label (toolbar.tsx) ----
  toolbarFormatting: string;
  toolbarBold: string;
  toolbarItalic: string;
  toolbarStrike: string;
  toolbarCode: string;
  toolbarUnderline: string;
  toolbarSubscript: string;
  toolbarSuperscript: string;
  toolbarLink: string;
  toolbarBulletList: string;
  toolbarOrderedList: string;
  toolbarTodoList: string;
  toolbarQuote: string;
  toolbarCodeBlock: string;
  /** Prefixed onto a heading level to build "Heading 2"/"제목 2" -- see
   * toolbar.tsx's EditorHeading. */
  toolbarHeadingWord: string;
  toolbarUndo: string;
  toolbarRedo: string;

  // ---- MentionMenu (menus/MentionMenu.tsx) ----
  mentionUser: string;
  mentionPost: string;
  mentionLoading: string;
  mentionNoResults: string;
  tagLabel: string;

  // ---- CodeBlockView chrome (blocks/CodeBlockView.tsx) ----
  codeLanguage: string;
  codeCopy: string;
  codeCopyLabel: string;
  codeCopyDoneLabel: string;

  // ---- ImageView chrome (blocks/ImageView.tsx) ----
  imageUrl: string;
  imageUploadPending: string;
  imageUploading: string;
  imageAltText: string;
  imageCaption: string;
  imageCaptionPlaceholder: string;
  imageResizeLeft: string;
  imageResizeRight: string;
  imageAlignGroup: string;
  imageAlignLeft: string;
  imageAlignCenter: string;
  imageAlignRight: string;
  imageRetry: string;

  // ---- EmbedView chrome (blocks/EmbedView.tsx) ----
  embedUrl: string;
  embedUrlPlaceholder: string;
  embedInvalidUrl: string;
  embedTitle: string;
  embedTitlePlaceholder: string;

  // ---- table atoms (table/TableCommands.tsx) ----
  tableInsertTable: string;
  tableAddRowBefore: string;
  tableAddRowAfter: string;
  tableAddColumnBefore: string;
  tableAddColumnAfter: string;
  tableDeleteRow: string;
  tableDeleteColumn: string;
  tableDeleteTable: string;
  tableMergeCells: string;
  tableSplitCell: string;
  tableMoveRowUp: string;
  tableMoveRowDown: string;
  tableMoveColumnLeft: string;
  tableMoveColumnRight: string;
  tableHeaderRow: string;
}

export type Locale = "en" | "ko";

export const EN_LABELS: Labels = {
  slashText: "Text",
  slashHeading1: "Heading 1",
  slashHeading2: "Heading 2",
  slashHeading3: "Heading 3",
  slashHeading4: "Heading 4",
  slashHeading5: "Heading 5",
  slashHeading6: "Heading 6",
  slashBulletList: "Bulleted list",
  slashOrderedList: "Numbered list",
  slashTodoList: "To-do list",
  slashQuote: "Quote",
  slashCode: "Code",
  slashDivider: "Divider",
  slashImage: "Image",
  slashEmbedYoutube: "YouTube",
  slashEmbed: "Embed",
  slashTable: "Table",
  slashChart: "Chart",
  slashDiagram: "Diagram",
  slashDataTable: "Data table",
  slashCodeWorkspace: "Code Workspace",
  slashNoResults: "No results",

  turnIntoText: "Text",
  turnIntoHeading1: "Heading 1",
  turnIntoHeading2: "Heading 2",
  turnIntoHeading3: "Heading 3",
  turnIntoBulletList: "Bulleted list",
  turnIntoOrderedList: "Numbered list",
  turnIntoTodoList: "To-do list",
  turnIntoQuote: "Quote",
  turnIntoCode: "Code",

  toolbarFormatting: "Formatting",
  toolbarBold: "Bold",
  toolbarItalic: "Italic",
  toolbarStrike: "Strike",
  toolbarCode: "Code",
  toolbarUnderline: "Underline",
  toolbarSubscript: "Subscript",
  toolbarSuperscript: "Superscript",
  toolbarLink: "Link",
  toolbarBulletList: "Bullet list",
  toolbarOrderedList: "Numbered list",
  toolbarTodoList: "To-do",
  toolbarQuote: "Quote",
  toolbarCodeBlock: "Code block",
  toolbarHeadingWord: "Heading",
  toolbarUndo: "Undo",
  toolbarRedo: "Redo",

  mentionUser: "User",
  mentionPost: "Post",
  mentionLoading: "Loading...",
  mentionNoResults: "No results",
  tagLabel: "Tags",

  codeLanguage: "Language",
  codeCopy: "Copy code",
  codeCopyLabel: "Copy",
  codeCopyDoneLabel: "Copied",

  imageUrl: "Image URL",
  imageUploadPending: "Pending upload",
  imageUploading: "Uploading…",
  imageAltText: "Alt text",
  imageCaption: "Caption",
  imageCaptionPlaceholder: "Add a caption",
  imageResizeLeft: "Resize from left",
  imageResizeRight: "Resize from right",
  imageAlignGroup: "Align image",
  imageAlignLeft: "Align left",
  imageAlignCenter: "Align center",
  imageAlignRight: "Align right",
  imageRetry: "Retry",

  embedUrl: "Embed URL",
  embedUrlPlaceholder: "Paste a YouTube, Vimeo, or link URL",
  embedInvalidUrl: "Enter a valid http(s) URL",
  embedTitle: "Embed title",
  embedTitlePlaceholder: "Add a title",

  tableInsertTable: "Table",
  tableAddRowBefore: "Add row above",
  tableAddRowAfter: "Add row below",
  tableAddColumnBefore: "Add column before",
  tableAddColumnAfter: "Add column after",
  tableDeleteRow: "Delete row",
  tableDeleteColumn: "Delete column",
  tableDeleteTable: "Delete table",
  tableMergeCells: "Merge cells",
  tableSplitCell: "Split cell",
  tableMoveRowUp: "Move row up",
  tableMoveRowDown: "Move row down",
  tableMoveColumnLeft: "Move column left",
  tableMoveColumnRight: "Move column right",
  tableHeaderRow: "Header row",
};

export const KO_LABELS: Labels = {
  slashText: "텍스트",
  slashHeading1: "제목 1",
  slashHeading2: "제목 2",
  slashHeading3: "제목 3",
  slashHeading4: "제목 4",
  slashHeading5: "제목 5",
  slashHeading6: "제목 6",
  slashBulletList: "글머리 기호 목록",
  slashOrderedList: "번호 목록",
  slashTodoList: "할 일 목록",
  slashQuote: "인용",
  slashCode: "코드",
  slashDivider: "구분선",
  slashImage: "이미지",
  slashEmbedYoutube: "유튜브",
  slashEmbed: "임베드",
  slashTable: "표",
  slashChart: "차트",
  slashDiagram: "다이어그램",
  slashDataTable: "데이터 표",
  slashCodeWorkspace: "코드 워크스페이스",
  slashNoResults: "결과 없음",

  turnIntoText: "텍스트",
  turnIntoHeading1: "제목 1",
  turnIntoHeading2: "제목 2",
  turnIntoHeading3: "제목 3",
  turnIntoBulletList: "글머리 기호 목록",
  turnIntoOrderedList: "번호 목록",
  turnIntoTodoList: "할 일 목록",
  turnIntoQuote: "인용",
  turnIntoCode: "코드",

  toolbarFormatting: "서식",
  toolbarBold: "굵게",
  toolbarItalic: "기울임꼴",
  toolbarStrike: "취소선",
  toolbarCode: "코드",
  toolbarUnderline: "밑줄",
  toolbarSubscript: "아래 첨자",
  toolbarSuperscript: "위 첨자",
  toolbarLink: "링크",
  toolbarBulletList: "글머리 기호 목록",
  toolbarOrderedList: "번호 목록",
  toolbarTodoList: "할 일",
  toolbarQuote: "인용",
  toolbarCodeBlock: "코드 블록",
  toolbarHeadingWord: "제목",
  toolbarUndo: "실행 취소",
  toolbarRedo: "다시 실행",

  mentionUser: "사용자",
  mentionPost: "게시물",
  mentionLoading: "불러오는 중...",
  mentionNoResults: "결과 없음",
  tagLabel: "태그",

  codeLanguage: "언어",
  codeCopy: "코드 복사",
  codeCopyLabel: "복사",
  codeCopyDoneLabel: "복사됨",

  imageUrl: "이미지 URL",
  imageUploadPending: "업로드 대기",
  imageUploading: "업로드 중…",
  imageAltText: "대체 텍스트",
  imageCaption: "캡션",
  imageCaptionPlaceholder: "캡션 추가",
  imageResizeLeft: "왼쪽에서 크기 조절",
  imageResizeRight: "오른쪽에서 크기 조절",
  imageAlignGroup: "이미지 정렬",
  imageAlignLeft: "왼쪽 정렬",
  imageAlignCenter: "가운데 정렬",
  imageAlignRight: "오른쪽 정렬",
  imageRetry: "재시도",

  embedUrl: "임베드 URL",
  embedUrlPlaceholder: "유튜브, 비메오 또는 링크 URL 붙여넣기",
  embedInvalidUrl: "올바른 http(s) URL을 입력하세요",
  embedTitle: "임베드 제목",
  embedTitlePlaceholder: "제목 추가",

  tableInsertTable: "표",
  tableAddRowBefore: "위에 행 추가",
  tableAddRowAfter: "아래에 행 추가",
  tableAddColumnBefore: "왼쪽에 열 추가",
  tableAddColumnAfter: "오른쪽에 열 추가",
  tableDeleteRow: "행 삭제",
  tableDeleteColumn: "열 삭제",
  tableDeleteTable: "표 삭제",
  tableMergeCells: "셀 병합",
  tableSplitCell: "셀 분할",
  tableMoveRowUp: "행 위로 이동",
  tableMoveRowDown: "행 아래로 이동",
  tableMoveColumnLeft: "열 왼쪽으로 이동",
  tableMoveColumnRight: "열 오른쪽으로 이동",
  tableHeaderRow: "머리글 행",
};

const PRESETS: Record<Locale, Labels> = { en: EN_LABELS, ko: KO_LABELS };

/** `locale`'s full preset, with `overrides` layered on top of it (a caller
 * can localize everything via `locale` alone, override one or two strings
 * via `labels` alone, or both -- `labels` always wins per-key). */
export function resolveLabels(locale: Locale | undefined, overrides: Partial<Labels> | undefined): Labels {
  return { ...PRESETS[locale ?? "en"], ...overrides };
}
