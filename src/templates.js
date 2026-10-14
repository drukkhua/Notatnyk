// Offline, versioned library. All edits are validated before writing, and the
// in-memory state changes only after storage confirms the new snapshot.
export const TEMPLATE_VERSION=1;
export const MAX_DEPTH=3;
export function validateLibrary(value){
  if(!value || value.version!==TEMPLATE_VERSION || !Array.isArray(value.nodes))throw new Error('libraryInvalid');
  const nodes=structuredClone(value.nodes), map=new Map();
  for(const n of nodes){
    if(!n || typeof n.id!=='string' || !n.id || map.has(n.id) || !['folder','template'].includes(n.kind) || typeof n.name!=='string' || !n.name.trim() || (n.parent!=null && typeof n.parent!=='string') || (n.kind==='template' && (typeof n.body!=='string'||!n.body.trim())))throw new Error('libraryInvalid');
    n.name=n.name.trim();n.parent=n.parent||null;n.sort=Number.isFinite(n.sort)?n.sort:0;map.set(n.id,n);
  }
  for(const n of nodes){
    let p=n,depth=1;const seen=new Set([n.id]);
    while(p.parent){p=map.get(p.parent);if(!p||p.kind!=='folder'||seen.has(p.id))throw new Error('libraryInvalid');seen.add(p.id);depth++;}
    if(depth>MAX_DEPTH || (n.kind==='folder'&&depth>=MAX_DEPTH))throw new Error('libraryDepth');
  }
  return {version:TEMPLATE_VERSION,nodes};
}
export function templatePath(nodes,id){const map=new Map(nodes.map(n=>[n.id,n]));let n=map.get(id),out=[];while(n?.parent){n=map.get(n.parent);if(!n)break;out.unshift(n.name);}return out;}
const norm=s=>s.toLowerCase().normalize('NFKC').replace(/\s+/g,' ').trim();
export function searchTemplates(nodes,query){const words=norm(query).split(' ').filter(Boolean);return nodes.filter(n=>n.kind==='template'&&words.every(w=>norm([...templatePath(nodes,n.id),n.name].join(' ')).includes(w)));}
export function suggestTemplateName(text){for(const raw of text.split('\n')){if(/^\s*[-=]{3,}\s*$/.test(raw))continue;const name=raw.replace(/^\s*(\[[ xX]\]|#{1,3}|[-*]|\d+\.|!{1,2}|>)\s*/,'').replace(/[*_~=]{2}/g,'').replace(/[:：]\s*$/,'').trim();if(name)return name.slice(0,120);}return '';}
export function starterLibrary(lang='ru',keywords={}){
  const unit=keywords.unit||(lang==='en'?'pcs':'шт'),currency=keywords.currency||(lang==='en'?'UAH':'грн');
  const names={ru:['Полиграфия','Изделие','Визитки','Наклейки','Листовки','Буклет'],uk:['Поліграфія','Виріб','Візитки','Наліпки','Листівки','Буклет'],en:['Printing','Product','Business cards','Stickers','Flyers','Booklet']}[lang];
  const words={ru:['Размер','Тираж','Материал','Печать','Отделка','Итого'],uk:['Розмір','Тираж','Матеріал','Друк','Оздоблення','Разом'],en:['Size','Quantity','Material','Print','Finishing','Total']}[lang];
  const dims=['90x50mm','90x50mm','50x50mm','148x210mm','210x297mm fold'];
  const nodes=[{id:'printing',kind:'folder',name:names[0],parent:null,sort:0}];
  for(let i=1;i<names.length;i++)nodes.push({id:'starter-'+i,kind:'template',name:names[i],parent:'printing',sort:i,
    body:`[ ] ${names[i]}:\n- ${words[0]}: ${dims[i-1].split(' ')[0]}\n- ${words[1]}: — ${unit}\n- ${words[2]}: —\n- ${words[3]}: 4+4\n- ${words[4]}: —\n[${dims[i-1]}]\n= 0 ${currency}\n${keywords.total||words[5]}: 0 ${currency}`});
  return validateLibrary({version:TEMPLATE_VERSION,nodes});
}
export function createTemplateStore({read,write,lang=()=> 'ru',keywords=()=>({})}){
  let data=null,loading=null,queue=Promise.resolve();
  async function load(){
    if(data)return data;
    if(!loading)loading=(async()=>{const raw=await read();const next=raw==null?starterLibrary(lang(),keywords()):validateLibrary(JSON.parse(raw));if(raw==null)await write(next,null);data=next;return data;})().finally(()=>{loading=null;});
    return loading;
  }
  function change(fn){
    const task=queue.then(async()=>{await load();const next=structuredClone(data);fn(next.nodes);const valid=validateLibrary(next);await write(valid,data);data=valid;return data;});
    queue=task.catch(()=>{});return task;
  }
  return {
    load, get data(){return data;},
    upsert(node){return change(nodes=>{const i=nodes.findIndex(n=>n.id===node.id);const next={sort:i<0?nodes.length:nodes[i].sort,...node};if(i<0)nodes.push(next);else nodes[i]=next;});},
    remove(id){return change(nodes=>{if(nodes.some(n=>n.parent===id))throw new Error('libraryNotEmpty');const i=nodes.findIndex(n=>n.id===id);if(i>=0)nodes.splice(i,1);});},
  };
}
