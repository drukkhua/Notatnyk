import createDOMPurify from './vendor/dompurify.js';
const instances=new WeakMap();
export function sanitizeHtml(html, win=window){
  let purifier=instances.get(win);
  if(!purifier){purifier=createDOMPurify(win);purifier.addHook('uponSanitizeAttribute',(_node,data)=>{if(data.attrName==='contenteditable' && data.attrValue!=='false')data.keepAttr=false;});instances.set(win,purifier);}
  return purifier.sanitize(String(html),{
    USE_PROFILES:{html:true,svg:true},
    ALLOW_DATA_ATTR:true, ADD_ATTR:['contenteditable'],
    FORBID_TAGS:['script','style','iframe','object','embed','form','input','textarea','select','foreignObject','animate','set','use'],
    FORBID_ATTR:['style'],
  });
}
export function setSafeHtml(el,html){el.innerHTML=sanitizeHtml(html,el.ownerDocument.defaultView);}
