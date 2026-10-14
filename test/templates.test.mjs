import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateStore,starterLibrary,validateLibrary,searchTemplates,suggestTemplateName } from '../src/templates.js';
test('library persists separate editable starters and supports path search',async()=>{
 let disk=null;const a=createTemplateStore({read:async()=>disk,write:async d=>disk=JSON.stringify(d),lang:()=> 'uk'});await a.load();assert.equal(a.data.nodes.filter(n=>n.kind==='template').length,5);assert.equal(searchTemplates(a.data.nodes,'поліграфія наліпки').length,1);
 await a.upsert({id:'mine',kind:'template',name:'Own',body:'# Text',parent:null});const b=createTemplateStore({read:async()=>disk,write:async()=>{}});await b.load();assert.equal(b.data.nodes.at(-1).body,'# Text');
});
test('rejects cycles, wrong versions, duplicate IDs and destructive folder removal',async()=>{
 const initial=starterLibrary();const a=createTemplateStore({read:async()=>JSON.stringify(initial),write:async()=>{}});await a.load();await assert.rejects(a.remove('printing'),/libraryNotEmpty/);assert.throws(()=>validateLibrary({...initial,version:2}),/libraryInvalid/);assert.throws(()=>validateLibrary({version:1,nodes:[{id:'a',name:'A',kind:'folder',parent:'a'}]}),/libraryInvalid/);assert.throws(()=>validateLibrary({version:1,nodes:[initial.nodes[0],initial.nodes[0]]}),/libraryInvalid/);
});
test('storage failure preserves in-memory library and later retry succeeds',async()=>{
 let fail=true;const a=createTemplateStore({read:async()=>JSON.stringify(starterLibrary()),write:async()=>{if(fail)throw new Error('disk full');}});await a.load();const before=JSON.stringify(a.data);await assert.rejects(a.remove('starter-1'),/disk full/);assert.equal(JSON.stringify(a.data),before);fail=false;await a.remove('starter-1');assert.equal(a.data.nodes.length,5);
});
test('concurrent edits are serialized; invalid source is never overwritten',async()=>{
 let writes=0;const a=createTemplateStore({read:async()=>JSON.stringify(starterLibrary()),write:async()=>writes++});await Promise.all([a.upsert({id:'a',kind:'template',name:'A',body:'A'}),a.upsert({id:'b',kind:'template',name:'B',body:'B'})]);assert.equal(a.data.nodes.length,8);assert.equal(writes,2);
 const broken=createTemplateStore({read:async()=>'{broken',write:async()=>writes++});await assert.rejects(broken.load());assert.equal(writes,2);assert.equal(suggestTemplateName('\n===\n[ ] **Визитки**:'),'Визитки');
});

test('English and custom-keyword starters have parseable quantity and money placeholders',()=>{
 const en=starterLibrary('en').nodes[1].body;assert.match(en,/— pcs/);assert.match(en,/= 0 UAH/);assert.match(en,/Total: 0 UAH/);
 const custom=starterLibrary('ru',{unit:'упак',currency:'EUR',total:'Total'}).nodes[1].body;assert.match(custom,/— упак/);assert.match(custom,/= 0 EUR/);assert.match(custom,/Total: 0 EUR/);
});
