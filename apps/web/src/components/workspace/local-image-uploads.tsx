import { useEditor } from '@jul-editor/react';
import { useEffect } from 'react';

/** Settle image uploads while leaving attachments queued for a host upload handler. */
export function LocalImageUploads() {
  const editor = useEditor();
  useEffect(() => {
    if (!editor) return;
    const offUpload = editor.onUpload((id) => {
      if (editor.getUploadState(id)?.status === 'queued' && editor.getState().store.records.get(id)?.type === 'image') editor.retryUpload(id);
    });
    const offChange = editor.on('change', () => {
      for (const { blockId, status } of editor.getPendingUploads()) {
        const record = editor.getState().store.records.get(blockId);
        const upload = editor.getUploadState(blockId);
        if (status === 'error' && upload?.status === 'error' && upload.message === 'The upload target was removed or changed.' && record?.type === 'image' && !record.props.src) editor.retryUpload(blockId);
      }
    });
    return () => { offUpload(); offChange(); };
  }, [editor]);
  return null;
}
