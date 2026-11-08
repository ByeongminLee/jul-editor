// Test helpers (not exported from index.ts): headless editors + collab clients.
import { coreRegistry, createEditor, toDoc } from "@jul-editor/core";
import type { Block, Doc, Editor } from "@jul-editor/core";
import { createCollaboration } from "./client.js";
import type { CollabClient, CollaborationOptions } from "./client.js";
import { createMemoryHub } from "./memory-transport.js";
import type { MemoryHub, MemoryHubOptions } from "./memory-transport.js";

export function para(id: string, text = ""): Block {
  return { id, type: "paragraph", props: {}, content: text ? [{ type: "text", text }] : [] };
}

export function docOf(...blocks: Block[]): Doc {
  return { version: 1, blocks };
}

export function makeEditor(doc: Doc = docOf(para("a", "hello"), para("b", "world"))): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return createEditor({ element, registry: coreRegistry, defaultValue: doc });
}

export interface Peer {
  editor: Editor;
  client: CollabClient;
}

export function connect(hub: MemoryHub, editor: Editor, name: string, extra: Partial<CollaborationOptions> = {}): Peer {
  const client = createCollaboration(editor, {
    transport: hub.createTransport(),
    user: { id: name, name, color: "#3b82f6" },
    docId: "doc",
    clientId: name,
    joinTimeoutMs: 5,
    heartbeatMs: 60_000,
    presenceThrottleMs: 0,
    ...extra,
  });
  return { editor, client };
}

export async function room(names: string[], hubOptions?: MemoryHubOptions, doc?: Doc): Promise<{ hub: MemoryHub; peers: Peer[] }> {
  const hub = createMemoryHub(hubOptions);
  const peers: Peer[] = [];
  for (const name of names) {
    const p = connect(hub, makeEditor(doc), name);
    peers.push(p);
    await until(() => p.client.getStatus() === "connected", hub); // sequential joins: the first leads, the rest sync from it
  }
  return { hub, peers };
}

export const text = (editor: Editor, id: string): string =>
  (editor.getState().store.records.get(id)?.content ?? []).map((i) => (i.type === "text" ? (i as { text: string }).text : "￼")).join("");

export const docJson = (editor: Editor): string => JSON.stringify(toDoc(editor.getState().store));

export function type(editor: Editor, blockId: string, offset: number, s: string): void {
  editor.update((tx) => tx.insertText({ blockId, offset }, s));
}

/** Polls (real timers) until `cond` holds, draining the hub in between. */
export async function until(cond: () => boolean, hub?: MemoryHub, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: timed out");
    await (hub ? hub.idle() : new Promise((r) => setTimeout(r, 2)));
    await new Promise((r) => setTimeout(r, 2));
  }
}
