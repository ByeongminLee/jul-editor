// P2: the language picker's option list for @jul-editor/react's codeBlock chrome
// (createCodeBlockRenderer). `value` is what's actually stored in a
// codeBlock's `props.language` AND what's passed straight to lowlight's own
// `.highlight(language, code)` -- every value below is either a grammar name
// lowlight's `common` preset registers directly, or one of that grammar's
// own highlight.js-declared aliases (verified against highlight.js 11.11's
// language definitions), so no separate value->grammar-name mapping table is
// needed. `shell`/`sh`/`zsh` are intentionally NOT included as their own
// entries: highlight.js's "shell" grammar is Shell Session (prompt-based),
// a different thing from plain shell scripting -- "bash" (sh/zsh aliases)
// covers the common "a shell script" case instead.
export interface CodeLanguage {
  value: string;
  label: string;
  aliases?: readonly string[];
}

export const pluginCodeLanguages: readonly CodeLanguage[] = [
  { value: "plaintext", label: "Plain Text", aliases: ["text", "txt", "plain"] },
  { value: "ts", label: "TypeScript", aliases: ["typescript", "mts", "cts"] },
  { value: "tsx", label: "TSX" },
  { value: "js", label: "JavaScript", aliases: ["javascript", "mjs", "cjs"] },
  { value: "jsx", label: "JSX" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash", aliases: ["sh", "zsh"] },
  { value: "python", label: "Python", aliases: ["py"] },
  { value: "go", label: "Go", aliases: ["golang"] },
  { value: "rust", label: "Rust", aliases: ["rs"] },
  { value: "java", label: "Java" },
  { value: "kotlin", label: "Kotlin", aliases: ["kt", "kts"] },
  { value: "swift", label: "Swift" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML", aliases: ["yml"] },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "markdown", label: "Markdown", aliases: ["md"] },
  { value: "diff", label: "Diff", aliases: ["patch"] },
  { value: "c", label: "C", aliases: ["h"] },
  { value: "cpp", label: "C++", aliases: ["c++", "cc", "cxx", "hpp"] },
  { value: "csharp", label: "C#", aliases: ["cs"] },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby", aliases: ["rb"] },
] as const;
