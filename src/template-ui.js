import { searchTemplates,templatePath,suggestTemplateName } from './templates.js';
// Native DOM controls: names and bodies are never interpolated into UI HTML.
export function createTemplateUI({store,t,preview,onInsert,onClose}){
 const doc=document;let parent=null,query='',activeId=null,editing=null,busy=false,epoch=0;
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const overlay=make('div','cheat template-overlay');overlay.hidden=true;
 const box=make('div','cheat-box template-box');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
 const head=make('div','cheat-head'),title=make('b'),close=make('button','ghost','×');close.type='button';close.onclick=hide;head.append(title,close);
 title.id='templateDialogTitle';box.setAttribute('aria-labelledby',title.id);
 const message=make('p','template-message');message.setAttribute('role','status');
 const tools=make('div','template-tools'),search=make('input');search.type='search';search.id='templateSearch';search.oninput=()=>{query=search.value;activeId=null;draw();};
 const back=button(()=>{const n=store.data.nodes.find(n=>n.id===parent);parent=n?.parent||null;query='';search.value='';activeId=null;draw();},'templateBack');
 const newTpl=button(()=>edit({kind:'template',body:'',name:'',parent}),'templateNew'),newFolder=button(()=>edit({kind:'folder',name:'',parent}),'folderNew');tools.append(search,back,newTpl,newFolder);
 const body=make('div','template-browser'),list=make('div','template-list'),right=make('div','template-right');list.setAttribute('role','listbox');list.id='templateList';
 const previewTitle=make('b'),previewBody=make('article','rendered template-preview');previewBody.id='templatePreview';
 const actions=make('div','template-actions');const insert=button(insertCurrent,'templateInsert'),modify=button(()=>{const n=current();if(n)edit(n);},'templateEdit'),del=button(deleteCurrent,'templateDelete');actions.append(insert,modify,del);right.append(previewTitle,previewBody,actions);body.append(list,right);
 const form=make('form','template-form');form.hidden=true;
 const name=field('input','templateName'),folder=field('select','templateFolder'),source=field('textarea','templateBody');name.input.maxLength=120;source.input.rows=9;name.input.id='templateName';source.input.id='templateBody';
 const formActions=make('div','template-actions'),save=button(null,'templateSave'),cancel=button(()=>{editing=null;draw();},'templateCancel');save.type='submit';formActions.append(save,cancel);form.append(name.label,folder.label,source.label,formActions);form.onsubmit=saveEdit;
 box.append(head,message,tools,body,form);overlay.append(box);doc.body.append(overlay);
 function field(tag,key){const label=make('label'),span=make('span'),input=make(tag);label.append(span,input);label._key=key;return {label,span,input};}
 function button(fn,key){const b=make('button','tb-btn');b.type='button';b.dataset.key=key;b.onclick=fn;return b;}
 function text(){title.textContent=t('templateLibrary');close.setAttribute('aria-label',t('templateClose'));search.placeholder=t('templateSearch');search.setAttribute('aria-label',t('templateSearch'));previewTitle.textContent=t('templatePreview');for(const b of box.querySelectorAll('[data-key]'))b.textContent=t(b.dataset.key);for(const f of [name,folder,source])f.span.textContent=t(f.label._key);}
 const current=()=>store.data?.nodes.find(n=>n.id===activeId);
 function showMessage(msg){message.textContent=msg;message.hidden=!msg;}
 function rows(){const nodes=store.data?.nodes||[];return (query.trim()?searchTemplates(nodes,query):nodes.filter(n=>n.parent===parent)).sort((a,b)=>a.sort-b.sort||a.name.localeCompare(b.name));}
 function drawPreview(){const n=current();insert.disabled=busy||!n||n.kind!=='template';modify.disabled=del.disabled=busy||!n;previewBody.replaceChildren();if(n?.kind==='template')preview(previewBody,n.body);}
 function draw(){
  text();tools.hidden=!!editing;body.hidden=!!editing;form.hidden=!editing;back.hidden=!parent&&!query;
  if(editing)return;
  const items=rows();if(!items.some(n=>n.id===activeId))activeId=items[0]?.id||null;list.replaceChildren();
  if(!items.length)list.append(make('p','template-empty',t('templateEmpty')));
  for(const n of items){const b=make('button','template-row'+(n.id===activeId?' active':''));b.type='button';b.dataset.id=n.id;b.setAttribute('role','option');b.setAttribute('aria-selected',String(n.id===activeId));
   b.append(make('span','template-row-kind',n.kind==='folder'?'›':''),make('span','template-row-name',n.name));
   if(query)b.append(make('small','template-row-path',templatePath(store.data.nodes,n.id).join(' › ')));
   b.onclick=()=>{if(n.kind==='folder'){parent=n.id;query='';search.value='';activeId=null;draw();}else{activeId=n.id;draw();}};b.ondblclick=()=>{if(n.kind==='template'){activeId=n.id;insertCurrent();}};list.append(b);
  }drawPreview();
 }
 function edit(node){editing={...node,id:node.id||crypto.randomUUID()};name.input.value=node.name;source.input.value=node.body||'';source.label.hidden=node.kind==='folder';folder.input.replaceChildren();
  const option=(id,label)=>{const o=make('option',null,label);o.value=id||'';folder.input.append(o);};option(null,t('templateRoot'));
  for(const n of store.data.nodes.filter(n=>n.kind==='folder'&&n.id!==editing.id)){option(n.id,[...templatePath(store.data.nodes,n.id),n.name].join(' › '));}
  folder.input.value=node.parent||'';draw();name.input.focus();
 }
 async function mutate(fn){if(busy)return false;busy=true;box.setAttribute('aria-busy','true');for(const b of box.querySelectorAll('button'))b.disabled=true;
  try{await fn();showMessage('');return true;}catch(e){showMessage(t(e.message).startsWith('library')?t('templateWriteError'):t(e.message)===e.message?t('templateWriteError'):t(e.message));return false;}
  finally{busy=false;box.removeAttribute('aria-busy');for(const b of box.querySelectorAll('button'))b.disabled=false;drawPreview();}
 }
 async function saveEdit(e){e.preventDefault();if(!editing||busy)return;const node={...editing,name:name.input.value.trim(),parent:folder.input.value||null,body:source.input.value};
  if(!node.name||(node.kind==='template'&&!node.body.trim())){showMessage(t(node.kind==='folder'?'folderRequired':'templateRequired'));return;}
  if(await mutate(()=>store.upsert(node))){parent=node.parent;activeId=node.id;editing=null;draw();search.focus();}
 }
 async function deleteCurrent(){const n=current();if(!n||!confirm(t('templateConfirmDelete',{name:n.name})))return;if(await mutate(()=>store.remove(n.id))){activeId=null;draw();}}
 function insertCurrent(){const n=current();if(n?.kind==='template'&&!busy){hide(false);onInsert(n.body);}}
 function hide(restore=true){if(busy)return;epoch++;overlay.hidden=true;editing=null;if(restore)onClose?.();}
 async function show(sourceText=null){const request=++epoch;overlay.hidden=false;text();showMessage(t('templateLoading'));tools.hidden=body.hidden=form.hidden=true;close.focus();
  try{await store.load();if(request!==epoch||overlay.hidden)return;parent=null;query='';search.value='';activeId=null;editing=null;showMessage('');if(sourceText!=null)edit({kind:'template',name:suggestTemplateName(sourceText),body:sourceText,parent:null});else{draw();search.focus();}}
  catch(e){showMessage(t('templateError'));}
 }
 overlay.addEventListener('mousedown',e=>{if(e.target===overlay)hide();});overlay.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(editing){editing=null;draw();search.focus();}else hide();return;}
  if(e.key==='Tab'){const focus=[...box.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&!n.closest('[hidden]'));if(e.shiftKey&&doc.activeElement===focus[0]){e.preventDefault();focus.at(-1)?.focus();}else if(!e.shiftKey&&doc.activeElement===focus.at(-1)){e.preventDefault();focus[0]?.focus();}return;}
  if(editing||!store.data)return;
  const items=rows(),at=items.findIndex(n=>n.id===activeId);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();activeId=items[(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.id;draw();list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});}
  else if(e.key==='Enter'){e.preventDefault();const n=current();if(n?.kind==='folder'){parent=n.id;query='';search.value='';activeId=null;draw();}else insertCurrent();}
  else if(e.key==='ArrowLeft'&&!query&&parent){e.preventDefault();back.click();}
 });
 return {show,hide,refresh:()=>{if(!overlay.hidden)draw();},get open(){return !overlay.hidden;}};
}
