// Re-exports `marked` for bench/suites/serde.mjs, which lives outside any
// package with `marked` as a listed dependency and so can't resolve the bare
// specifier itself. Not exported from index.ts -- bench-only.
export { marked } from "marked";
