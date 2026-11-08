// Tiny commit-subscription emitter.

import type { EditorState } from "./types.js";

export interface CommitPayload {
  state: EditorState;
  changedIds: Set<string>;
  origin?: string;
}

export type CommitListener = (payload: CommitPayload) => void;

export interface Emitter {
  onCommit(listener: CommitListener): () => void;
  emit(payload: CommitPayload): void;
}

export function createEmitter(): Emitter {
  const listeners = new Set<CommitListener>();
  return {
    onCommit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(payload) {
      for (const listener of listeners) listener(payload);
    },
  };
}
