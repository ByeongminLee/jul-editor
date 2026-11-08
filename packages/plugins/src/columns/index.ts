import { columnsBlocks, columnsSlashItems } from "./block.js";

export { columnsBlock, columnBlock, columnsBlocks, columnsSlashItems, createColumnsBlock, addColumn, removeColumn, unwrapColumns, MIN_COLUMNS, MAX_COLUMNS } from "./block.js";
export { COLUMNS_CSS } from "./columns-css.js";

/** Spread into `<Editor.Plugin {...columnsPlugin} />`. No renderer: columns are pure structure + CSS. */
export const columnsPlugin = {
  blocks: columnsBlocks,
  slashItems: columnsSlashItems,
};
