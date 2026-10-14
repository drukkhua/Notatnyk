// Application integration with isolated filesystem. No real notes or desktop UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom=new JSDOM(readFileSync(new URL('../src/index.html',import.meta.url),'utf8'),{url:'http://localhost',pretendToBeVisual:true});
const w=dom.window;const files=new Map([['notatnyk/one.md','# First\nРазом: 3072 грн'],['notatnyk/two.md','# Second\n= 100 грн\nИтого: 100,01 грн']]);let failWrites=false;
w.__TAURI__={core:{invoke:async(cmd,args,options)=>{
 if(cmd.endsWith('|exists'))return files.has(args.path)||args.path==='notatnyk';
 if(cmd.endsWith('|read_dir'))return [...files.keys()].filter(k=>k.startsWith(args.path+'/')&&k.endsWith('.md')).map(k=>({name:k.split('/').at(-1)}));
 if(cmd.endsWith('|read_text_file'))return new TextEncoder().encode(files.get(args.path));
 if(cmd.endsWith('|write_text_file')){if(failWrites)throw new Error('disk full');files.set(decodeURIComponent(options.headers.path),new TextDecoder().decode(args));return null;}
 if(cmd.endsWith('|stat'))return {mtime:0};if(cmd.endsWith('|remove'))files.delete(args.path);return null;
}}};
w.matchMedia=query=>({matches:query.includes('max-width:640'),addEventListener(){},removeEventListener(){}});
w.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,height:0});
w.HTMLElement.prototype.scrollIntoView=function(){};
Object.assign(globalThis,{window:w,document:w.document,localStorage:w.localStorage,requestAnimationFrame:w.requestAnimationFrame.bind(w),getComputedStyle:w.getComputedStyle.bind(w),NodeFilter:w.NodeFilter,ResizeObserver:class{observe(){}},alert:()=>{},confirm:()=>true});
Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
const $=s=>w.document.querySelector(s);const pause=()=>new Promise(r=>setTimeout(r,20));
await import('../src/main.js');
for(let i=0;i<100&&!w.document.body.dataset.ready;i++)await pause();
test('application boots with safe markup and correct declared-only totals',()=>{
 assert.equal(w.document.body.dataset.ready,'true');assert.equal($('#sumState').className,'ok');assert.match($('#sumLabel').textContent,/3.072/);assert.equal($('#sym .r-h1').textContent,'# First');
});
test('diagnostics lead to the line; clean mode retains original source',async()=>{
 $('#noteList').children[1].click();assert.equal($('#diagnostics').hidden,false);$('#diagnosticsList button').click();assert.equal($('#split').dataset.view,'sym');
 $('#hideMarkers').checked=true;$('#hideMarkers').dispatchEvent(new w.Event('change'));assert.equal($('#split').dataset.view,'clean');assert.ok($('#sym').classList.contains('clean-mode'));assert.match($('#sym').textContent,/Итого: 100,01/);
 $('#segSplit').click();assert.match($('#src').value,/Итого: 100,01/);$('#noteList').children[1].click();await pause();
});
test('library loads, searches, saves selection, previews, inserts and persists',async()=>{
 $('#segSplit').click();$('#src').setSelectionRange(0,7);$('#saveTemplateBtn').dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,cancelable:true}));$('#saveTemplateBtn').click();await pause();
 assert.equal($('.template-form').hidden,false);$('#templateName').value='Selected header';$('.template-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();assert.ok(files.has('templates.json'));assert.match(files.get('templates.json'),/Selected header/);
 $('#templateSearch').value='Selected header';$('#templateSearch').dispatchEvent(new w.Event('input'));assert.equal($('#templateList').children.length,1);assert.match($('#templatePreview').textContent,/First|Second/);
 $('.template-actions button[data-key="templateInsert"]').click();assert.equal($('.template-overlay').hidden,true);assert.match($('#src').value,/# /);
 $('#templatesBtn').click();await pause();$('.template-row').click();assert.ok($('#templateList').children.length>=5);$('.template-overlay .ghost').click();
});
test('presets cycle without losing document, command palette still has its input',()=>{
 $('#docBtn').click();assert.ok($('#out').classList.contains('doc-mode'));$('#docBtn').click();assert.ok($('#out').classList.contains('spec-mode'));$('#docBtn').click();assert.equal($('#out').classList.contains('spec-mode'),false);
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));assert.ok($('.palette-input'));assert.equal($('.palette-wrap').hidden,false);
});
test('template management creates a folder, moves and edits a template, and safely deletes it',async()=>{
 $('.palette-input').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));$('#templatesBtn').click();await pause();
 $('.template-tools [data-key="folderNew"]').click();$('#templateName').value='Projects';$('.template-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();
 let library=JSON.parse(files.get('templates.json'));const parent=library.nodes.find(n=>n.name==='Projects').id;
 $('#templateSearch').value='Selected header';$('#templateSearch').dispatchEvent(new w.Event('input'));$('.template-actions [data-key="templateEdit"]').click();$('#templateName').value='Moved header';$('.template-form select').value=parent;$('#templateBody').value='# Updated header';$('.template-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause();
 library=JSON.parse(files.get('templates.json'));const moved=library.nodes.find(n=>n.name==='Moved header');assert.equal(moved.parent,parent);assert.equal(moved.body,'# Updated header');assert.ok(files.has('templates.backup.json'));
 $('#templateSearch').value='Moved header';$('#templateSearch').dispatchEvent(new w.Event('input'));$('.template-actions [data-key="templateDelete"]').click();await pause();assert.equal(JSON.parse(files.get('templates.json')).nodes.some(n=>n.id===moved.id),false);$('.template-overlay .ghost').click();
});
test('save failure remains visible and can be retried; switching notes flushes both edits',async()=>{
 $('#segSplit').click();failWrites=true;$('#src').value='# Changed';$('#src').dispatchEvent(new w.Event('input'));await new Promise(r=>setTimeout(r,350));assert.match($('#saveStatus').textContent,/Ошибка/);failWrites=false;$('#saveStatus').click();await pause();assert.equal($('#saveStatus').disabled,true);assert.ok([...files.values()].some(v=>v==='# Changed'));
 $('#src').value='# Before switch';$('#src').dispatchEvent(new w.Event('input'));$('#noteList').children[1].click();$('#src').value='# After switch';$('#src').dispatchEvent(new w.Event('input'));await new Promise(r=>setTimeout(r,350));assert.ok([...files.values()].includes('# Before switch'));assert.ok([...files.values()].includes('# After switch'));
});
