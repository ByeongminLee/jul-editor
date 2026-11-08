#!/usr/bin/env node
// Deterministic seeded fixture generator for bench/fixtures/doc-{500,5000}.json.
// Doc model:
//   Block = { id, type, props, content?, children? }
//   Inline = { type: 'text', text, marks?: {type, attrs?}[] } | { type: 'mention', attrs: {kind, id, label} }
//
// Hand-rolled mulberry32 PRNG + tiny word bank instead of a faker
// dependency, this only needs to be deterministic and boring.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "fixtures");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "jul-editor", "block", "editor", "notion", "style", "nesting", "markdown", "diff",
  "cursor", "selection", "mention", "table", "chart", "diagram", "mermaid",
  "render", "commit", "history", "undo", "redo", "keymap", "inline", "mark",
  "bold", "italic", "link", "paste", "clipboard", "ime", "compose", "sanitize",
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function words(rng, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(pick(rng, WORDS));
  return out.join(" ");
}

function makeId(counter) {
  return `b${counter.n++}`;
}

function textNode(text, marks) {
  return marks && marks.length ? { type: "text", text, marks } : { type: "text", text };
}

function makeInline(rng) {
  const runs = 2 + Math.floor(rng() * 3);
  const out = [];
  for (let i = 0; i < runs; i++) {
    const roll = rng();
    if (roll < 0.12) {
      out.push({
        type: "mention",
        attrs: {
          kind: rng() < 0.5 ? "user" : "post",
          id: `ref-${Math.floor(rng() * 10000)}`,
          label: pick(rng, WORDS),
        },
      });
      continue;
    }
    const marks = [];
    const m = rng();
    if (m < 0.15) marks.push({ type: "bold" });
    else if (m < 0.3) marks.push({ type: "italic" });
    else if (m < 0.4) marks.push({ type: "link", attrs: { href: "https://example.com/" + pick(rng, WORDS) } });
    out.push(textNode(words(rng, 2 + Math.floor(rng() * 4)), marks));
    out.push(textNode(" "));
  }
  return out;
}

function paragraph(rng, counter) {
  return { id: makeId(counter), type: "paragraph", props: {}, content: makeInline(rng) };
}

function heading(rng, counter) {
  return { id: makeId(counter), type: "heading", props: { level: 1 + Math.floor(rng() * 3) }, content: makeInline(rng) };
}

function quote(rng, counter) {
  return { id: makeId(counter), type: "quote", props: {}, content: makeInline(rng) };
}

function codeBlock(rng, counter) {
  return {
    id: makeId(counter),
    type: "codeBlock",
    props: { language: pick(rng, ["js", "ts", "json", "md"]) },
    content: [textNode(`function ${pick(rng, WORDS)}() {\n  return ${Math.floor(rng() * 100)};\n}`)],
  };
}

const LIST_TYPES = ["bulletListItem", "orderedListItem", "todoListItem"];

function listItem(rng, counter, depth) {
  const type = pick(rng, LIST_TYPES);
  const props = type === "todoListItem" ? { checked: rng() < 0.4 } : {};
  const item = { id: makeId(counter), type, props, content: makeInline(rng) };
  if (depth < 3 && rng() < 0.35) {
    const childCount = 1 + Math.floor(rng() * 2);
    item.children = Array.from({ length: childCount }, () => listItem(rng, counter, depth + 1));
  }
  return item;
}

function image(rng, counter) {
  return {
    id: makeId(counter),
    type: "image",
    props: { src: `https://picsum.photos/seed/${Math.floor(rng() * 9999)}/400/300`, alt: pick(rng, WORDS) },
  };
}

function chart(rng, counter) {
  return {
    id: makeId(counter),
    type: "chart",
    props: { source: { type: "inline", csv: "x,y\n1,2\n2,4\n3,9" } },
  };
}

function diagram(rng, counter) {
  return {
    id: makeId(counter),
    type: "diagram",
    props: { code: "graph TD; A-->B; B-->C;" },
  };
}

function tableCell(rng, counter) {
  return { id: makeId(counter), type: "tableCell", props: {}, content: makeInline(rng) };
}

function tableRow(rng, counter, cols) {
  return {
    id: makeId(counter),
    type: "tableRow",
    props: {},
    children: Array.from({ length: cols }, () => tableCell(rng, counter)),
  };
}

function table(rng, counter) {
  const rows = 3;
  const cols = 3;
  return {
    id: makeId(counter),
    type: "table",
    props: { headerRow: true },
    children: Array.from({ length: rows }, () => tableRow(rng, counter, cols)),
  };
}

// counts every block including nested descendants
function countBlock(block) {
  let n = 1;
  if (block.children) for (const c of block.children) n += countBlock(c);
  return n;
}

function generateDoc(target, seed) {
  const rng = mulberry32(seed);
  const counter = { n: 0 };
  const blocks = [];
  let total = 0;
  let sinceTable = 0;
  let voidCount = 0;
  const voidBudget = Math.max(3, Math.round(target / 300));

  while (total < target) {
    sinceTable++;
    const roll = rng();
    let block;
    if (sinceTable >= 200) {
      block = table(rng, counter);
      sinceTable = 0;
    } else if (voidCount < voidBudget && rng() < 0.02) {
      const kind = pick(rng, ["image", "chart", "diagram"]);
      block = kind === "image" ? image(rng, counter) : kind === "chart" ? chart(rng, counter) : diagram(rng, counter);
      voidCount++;
    } else if (roll < 0.45) {
      block = paragraph(rng, counter);
    } else if (roll < 0.55) {
      block = heading(rng, counter);
    } else if (roll < 0.65) {
      block = quote(rng, counter);
    } else if (roll < 0.72) {
      block = codeBlock(rng, counter);
    } else {
      block = listItem(rng, counter, 1);
    }
    blocks.push(block);
    total += countBlock(block);
  }

  // ensure the void budget is met even for small/unlucky seeds
  while (voidCount < 3) {
    blocks.push(image(rng, counter));
    voidCount++;
  }

  return { version: 1, blocks };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const targets = [
    { name: "doc-500.json", count: 500, seed: 500 },
    { name: "doc-5000.json", count: 5000, seed: 5000 },
  ];
  for (const { name, count, seed } of targets) {
    const doc = generateDoc(count, seed);
    const actual = doc.blocks.reduce((n, b) => n + countBlock(b), 0);
    await writeFile(path.join(OUT_DIR, name), JSON.stringify(doc, null, 2) + "\n");
    console.log(`${name}: ${actual} blocks (target ~${count})`);
  }
}

main();
