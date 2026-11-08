/** Optional stylesheet: lays the `columns` children container out as a flex row (stacks on narrow screens). */
export const COLUMNS_CSS = `
[data-type="columns"]>[data-jul-editor-children]{display:flex;gap:16px;align-items:flex-start}
[data-type="columns"]>[data-jul-editor-children]>[data-type="column"]{flex:1 1 0;min-width:0}
[data-type="column"]{padding:2px 4px;border-radius:4px}
[data-type="columns"]:hover>[data-jul-editor-children]>[data-type="column"]{outline:1px dashed rgba(0,0,0,.12)}
@media (max-width:640px){[data-type="columns"]>[data-jul-editor-children]{flex-direction:column}}
`;
