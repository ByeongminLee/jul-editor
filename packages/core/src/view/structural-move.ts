import type { Registry } from "../model/schema.js";
import { buildIndentOps, buildOutdentOps } from "../store/edits.js";
import { canAdmit, comparePreOrder, containerInfo, nearestIsolatingAncestor, siblingsOf } from "../store/store.js";
import type { Transaction } from "../store/transaction.js";
import type { EditorState, Op, Store } from "../store/types.js";
import { textSelectionBlockIds } from "./marks.js";

/** Plan from the original tree; simulate each primitive so later indices stay valid. */
export function structuralMove(state: EditorState, registry: Registry, action: "indent" | "outdent" | "up" | "down", explicitIds?: string[], root?: HTMLElement): ((tx: Transaction) => Transaction) | null {
  const original = state.store;
  const sel = state.selection;
  const ids = [...new Set(explicitIds ?? (sel?.type === "text" ? textSelectionBlockIds(original, sel) : sel?.type === "block" ? sel.ids : []))]
    .filter((id) => original.records.has(id)).sort((a, b) => comparePreOrder(original, a, b));
  const selected = new Set(ids);
  let toggleStates: Map<string, string | null> | undefined;
  const closed = (id: string) => {
    const rec = original.records.get(id)!;
    if (rec.type !== "toggle") return false;
    if (!toggleStates) {
      toggleStates = new Map();
      for (const wrapper of root?.querySelectorAll('[data-type="toggle"]') ?? []) {
        const wrapperId = wrapper.getAttribute("data-id");
        if (wrapperId !== null && !toggleStates.has(wrapperId)) toggleStates.set(wrapperId, wrapper.getAttribute("data-jul-editor-open"));
      }
    }
    const open = toggleStates.get(id);
    return open === null || open === undefined ? rec.props.open !== true : open !== "true";
  };
  const roots = ids.filter((id) => {
    for (let p = original.records.get(id)?.parentId; p; p = original.records.get(p)?.parentId) if (selected.has(p)) return false;
    return true;
  });
  if (!roots.length) return null;
  const selectedAncestors = new Set<string>();
  for (const id of roots) for (let p: string | null | undefined = id; p; p = original.records.get(p)?.parentId) selectedAncestors.add(p);
  const safe = (id: string) => {
    const rec = original.records.get(id)!;
    if (["tableRow", "tableCell", "column"].includes(rec.type)) return false;
    for (let p: string | null | undefined = rec.parentId; p; p = original.records.get(p)?.parentId) {
      const parent = original.records.get(p)!;
      if (["table", "tableRow", "tableCell"].includes(parent.type) || closed(p)) return false;
    }
    return true;
  };
  const store: Store = { ...original, records: new Map(original.records), rootIds: [...original.rootIds] };
  const ops: Op[] = [];
  const add = (op: Op) => {
    if (op.type !== "moveBlock") return;
    const rec = store.records.get(op.id)!;
    const source = siblingsOf(store, op.id);
    const target = op.newParentId === source.parentId ? source.siblings : op.newParentId === null ? store.rootIds : store.records.get(op.newParentId)!.childIds;
    const index = Math.max(0, Math.min(op.index, target.length - (source.parentId === op.newParentId ? 1 : 0)));
    if (source.parentId === op.newParentId && source.index === index) return;
    const without = source.siblings.filter((id) => id !== op.id);
    const dest = source.parentId === op.newParentId ? without : [...target];
    dest.splice(index, 0, op.id);
    const setChildren = (parent: string | null, children: string[]) => {
      if (parent === null) store.rootIds = children;
      else store.records.set(parent, { ...store.records.get(parent)!, childIds: children });
    };
    if (source.parentId !== op.newParentId) setChildren(source.parentId, without);
    setChildren(op.newParentId, dest);
    store.records.set(op.id, { ...rec, parentId: op.newParentId });
    ops.push(op);
  };
  if (roots.length === 1 && (ids.length === 1 || action === "up" || action === "down") && safe(roots[0]!) && !(action === "outdent" && (closed(roots[0]!) || registry.blocks.get(original.records.get(roots[0]!)!.type)?.isolating))) {
    const id = roots[0]!;
    const rec = original.records.get(id)!;
    if (action === "indent" || action === "outdent") {
      const { siblings, index } = siblingsOf(original, id);
      const previous = original.records.get(siblings[index - 1] ?? "");
      if (!(action === "indent" && previous && closed(previous.id)) && !(action === "outdent" && rec.parentId && registry.blocks.get(original.records.get(rec.parentId)!.type)?.isolating) && !(action === "indent" && previous && (rec.parentId ? nearestIsolatingAncestor(original, rec.parentId, registry) : null) !== nearestIsolatingAncestor(original, previous.id, registry))) {
        for (const op of (action === "indent" ? buildIndentOps : buildOutdentOps)(original, id, registry)) add(op);
      }
    } else {
      const { parentId, siblings, index } = siblingsOf(original, id);
      const next = index + (action === "up" ? -1 : 1);
      if (next >= 0 && next < siblings.length) add({ type: "moveBlock", id, newParentId: parentId, index: next });
      else if (!explicitIds && parentId !== null && !registry.blocks.get(original.records.get(parentId)!.type)?.isolating) {
        const parent = siblingsOf(original, parentId);
        const container = containerInfo(original, parent.parentId, registry);
        if (canAdmit(registry, rec.type, container.type, container.children)) add({ type: "moveBlock", id, newParentId: parent.parentId, index: parent.index + (action === "down" ? 1 : 0) });
      }
    }
  } else {
    const groups: string[][] = [];
    for (const id of roots) {
      const { parentId, siblings, index } = siblingsOf(original, id);
      const last = groups.at(-1);
      if (last && original.records.get(last[0]!)?.parentId === parentId && siblings[index - 1] === last.at(-1)) last.push(id);
      else groups.push([id]);
    }
    for (const group of action === "down" || action === "outdent" ? [...groups].reverse() : groups) {
      if (group.some((id) => !safe(id))) continue;
      const { parentId, siblings, index } = siblingsOf(original, group[0]!);
      if (action === "indent") {
        const target = siblings[index - 1];
        const targetRec = target && original.records.get(target);
        if (!target || !targetRec || selected.has(target) || closed(target) || (parentId ? nearestIsolatingAncestor(original, parentId, registry) : null) !== nearestIsolatingAncestor(original, target, registry)) continue;
        const container = containerInfo(original, target, registry);
        if (group.some((id) => registry.blocks.get(original.records.get(id)!.type)?.indentable === false || !canAdmit(registry, original.records.get(id)!.type, container.type, container.children))) continue;
        for (const id of group) add({ type: "moveBlock", id, newParentId: target, index: store.records.get(target)!.childIds.length });
      } else if (action === "outdent") {
        if (!parentId || registry.blocks.get(original.records.get(parentId)!.type)?.isolating) continue;
        const live = siblingsOf(store, group.at(-1)!);
        const later = live.siblings.slice(live.index + 1);
        if (later.some((sibling) => roots.some((rootId) => {
          for (let p: string | null | undefined = rootId; p; p = store.records.get(p)?.parentId) if (p === sibling) return true;
          return false;
        }))) continue;
        const parent = siblingsOf(original, parentId);
        const container = containerInfo(original, parent.parentId, registry);
        if (group.some((id) => registry.blocks.get(original.records.get(id)!.type)?.indentable === false || !canAdmit(registry, original.records.get(id)!.type, container.type, container.children))) continue;
        for (const id of [...group].reverse()) add({ type: "moveBlock", id, newParentId: parent.parentId, index: siblingsOf(store, parentId).index + 1 });
      } else {
        const adjacent = siblings[action === "up" ? index - 1 : index + group.length];
        if (!adjacent || selectedAncestors.has(adjacent)) continue;
        const targetIndex = siblingsOf(store, group[0]!).index;
        add({ type: "moveBlock", id: adjacent, newParentId: parentId, index: action === "up" ? targetIndex + group.length - 1 : targetIndex });
      }
    }
  }
  if (!ops.length) return null;
  const postIds = sel?.type === "text" ? textSelectionBlockIds(store, sel) : [];
  const exactText = postIds.length === ids.length && postIds.every((id, index) => id === ids[index]);
  return (tx) => {
    for (const op of ops) if (op.type === "moveBlock") tx.moveBlock(op.id, op.newParentId, op.index);
    if (sel?.type === "block" || explicitIds || (sel?.type === "text" && !exactText)) {
      const selectable = roots.filter(safe).sort((a, b) => comparePreOrder(store, a, b));
      if (selectable.length) tx.setSelection({ type: "block", ids: selectable }, { preserveOnRepair: true });
    } else if (sel?.type === "text") tx.setSelection(sel, { preserveOnRepair: true });
    return tx;
  };
}
