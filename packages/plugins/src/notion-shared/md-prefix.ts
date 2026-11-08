/** Prefixes every line with the blockquote marker ("> "), empty lines with a bare ">". */
export function quotePrefix(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : "> " + line))
    .join("\n");
}

/** Strips exactly one ">" marker (plus one optional space) from each line. */
export function quoteUnprefix(text: string): string {
  return text.replace(/^ {0,3}> ?/gm, "");
}
