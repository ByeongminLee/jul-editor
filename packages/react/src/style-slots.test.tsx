import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from './';
const suggestion = vi.hoisted(() => ({ open: true, items: [{id:'p',type:'paragraph',title:'Paragraph',description:'Body',label:'Person',kind:'user'}], activeIndex:0, loading:false, rect:null, getListboxProps:()=>({role:'listbox'}),getOptionProps:()=>({role:'option'}) }));
vi.mock('./menus/use-suggestion.js', () => ({ useSuggestion: () => suggestion }));
afterEach(cleanup);
it('toolbar slots style atoms, retain explicit classes and preserve asChild elements', () => {
 render(<Editor><Editor.Toolbar className={{container:'bar',button:'btn',text:'label'}}><Editor.Bold className="own"/><Editor.Italic asChild><a className="link">Italic link</a></Editor.Italic><Editor.Undo/></Editor.Toolbar></Editor>);
 expect(screen.getByRole('toolbar').className).toBe('bar');
 expect(screen.getByRole('button',{name:'Bold'}).className).toBe('btn own');
 expect(screen.getByText('Bold').className).toBe('label');
 expect(screen.getByText('Undo').className).toBe('label');
 expect(screen.getByText('Italic link').tagName).toBe('A');
 expect(screen.getByText('Italic link').className).toBe('btn link');
});
it('menu slots style default markup and retain string roots', () => {
 const {container} = render(<Editor><Editor.SlashMenu className={{container:'menu',item:'item',text:'text',description:'description'}}/><Editor.TagMenu onSearch={()=>[]} className={{container:'tags',item:'tag',text:'tagText'}}/><Editor.MentionMenu onSearch={async()=>[]} className="mentions"/></Editor>);
 expect(container.querySelector('[data-jul-editor-slash-menu]')?.className).toBe('menu');
 expect(container.querySelector('[data-jul-editor-slash-item]')?.className).toBe('item');
 expect(screen.getByText('Paragraph').className).toBe('text');
 expect(screen.getByText('Body').className).toBe('description');
 expect(screen.getByText('#Person').className).toBe('tagText');
 expect(container.querySelector('[data-jul-editor-mention-menu]')?.className).toBe('mentions');
});

it('empty and loading slots are explicit, render props retain control', () => {
 const items = suggestion.items;
 suggestion.items = [];
 try {
  const {container, rerender} = render(<Editor><Editor.SlashMenu className={{empty:'empty'}}/><Editor.MentionMenu onSearch={async()=>[]} className={{empty:'emptyMention',loading:'loadingMention'}}/><Editor.TagMenu onSearch={()=>[]} className={{empty:'emptyTag',loading:'loadingTag'}}/></Editor>);
  expect(container.querySelector('[data-jul-editor-slash-empty]')?.className).toBe('empty');
  expect(container.querySelector('[data-jul-editor-mention-empty]')?.className).toBe('emptyMention');
  expect(container.querySelector('[data-jul-editor-tag-empty]')?.className).toBe('emptyTag');
  suggestion.loading = true;
  rerender(<Editor><Editor.MentionMenu onSearch={async()=>[]} className={{loading:'loadingMention'}}/><Editor.TagMenu onSearch={()=>[]} className={{loading:'loadingTag'}}/></Editor>);
  expect(container.querySelector('[data-jul-editor-mention-loading]')?.className).toBe('loadingMention');
  expect(container.querySelector('[data-jul-editor-tag-loading]')?.className).toBe('loadingTag');
  rerender(<Editor><Editor.SlashMenu className={{container:'unused'}}>{()=> <div className="custom">Custom</div>}</Editor.SlashMenu><Editor.Toolbar><Editor.Bold/></Editor.Toolbar></Editor>);
  expect(screen.getByText('Custom').className).toBe('custom');
  expect(container.querySelector('[data-jul-editor-slash-menu]')).toBeNull();
  expect(screen.getByRole('button', {name:'Bold'}).getAttribute('class')).toBeNull();
 } finally { suggestion.items = items; suggestion.loading = false; }
});
