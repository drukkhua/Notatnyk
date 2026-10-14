// Text remains the source of truth. Decorating a line must never replace the
// live DOM while the user is typing or composing with a phone keyboard.
export function createSymEditor(el, { renderLines, onChange, delay = 200 }){
  const doc=el.ownerDocument, win=doc.defaultView;
  let timer, composing=false, dirty=false, activeLine=0, emitting=false;
  let history=[], index=-1, lastType='', lastAt=0;
  // Native contenteditable can produce bare text, nested paragraphs or <br>
  // after paste/Backspace. Read those without discarding text or repainting.
  function model(){
    let text='';const points=new Map(),leaves=[];
    const block=n=>n.nodeType===1&&['DIV','P','LI'].includes(n.tagName);
    function visit(n){
      const start=text.length;
      if(n.nodeType===3){text+=(n.textContent||'').replace(/\u00a0/g,' ');points.set(n,start);leaves.push({node:n,start,end:text.length});return;}
      const children=[...n.childNodes],offsets=[text.length];points.set(n,offsets);
      children.forEach((c,i)=>{
        const prev=children[i-1];if(i>0&&(block(c)||block(prev))&&prev.nodeName!=='BR')text+='\n';
        if(c.nodeName==='BR'){points.set(c,[text.length]);if(!(block(n)&&i===children.length-1))text+='\n';}
        else visit(c);
        offsets.push(text.length);
      });
      if(block(n)&&text.length===start)leaves.push({node:n,start,end:start,empty:true});
    }
    visit(el);return {text,points,leaves};
  }
  const readText=()=>model().text;
  function point(node,off){
    if(!node||!el.contains(node))return null;const m=model(),p=m.points.get(node);
    const global=typeof p==='number'?p+off:p?.[off];if(global==null)return null;
    const prefix=m.text.slice(0,global),parts=prefix.split('\n');return {line:parts.length-1,offset:parts.at(-1).length,global};
  }
  const globalOffset=p=>p?.global??readText().length;
  function selection(){
    const s=win.getSelection();if(!s?.rangeCount)return {start:readText().length,end:readText().length};
    const r=s.getRangeAt(0);return {start:globalOffset(point(r.startContainer,r.startOffset)),end:globalOffset(point(r.endContainer,r.endOffset))};
  }
  function locate(g){
    const m=model(),offset=Math.max(0,Math.min(g,m.text.length));
    for(const leaf of m.leaves){if(offset>=leaf.start&&offset<=leaf.end)return {node:leaf.node,offset:leaf.empty?0:offset-leaf.start};}
    const last=m.leaves.at(-1);return last?{node:last.node,offset:last.empty?0:last.end-last.start}:{node:el,offset:0};
  }
  function setSelection(start,end=start){
    const a=locate(start),b=locate(end),r=doc.createRange(),s=win.getSelection();
    r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);s.removeAllRanges();s.addRange(r);
    activeLine=point(a.node,a.offset)?.line||0;markActive();
  }
  function markActive(){el.querySelectorAll('.sym-active').forEach(n=>n.classList.remove('sym-active'));el.children[activeLine]?.classList.add('sym-active');}
  const snapshot=()=>({text:readText(),...selection()});
  function record(type='edit', before){
    const next=snapshot();if(index>=0 && history[index].text===next.text)return;
    if(before && index>=0 && history[index].text===before.text)history[index]=before;
    history=history.slice(0,index+1);
    const at=Date.now(),merge=type==='insertText' && lastType===type && at-lastAt<750 && index>0 && !next.text.includes('\n',next.start);
    if(merge) history[index]=next;
    else{history.push(next);index++;if(history.length>150){history.shift();index--;}}
    lastType=type;lastAt=at;
  }
  function emit(){clearTimeout(timer);emitting=true;try{onChange(readText());}finally{emitting=false;}}
  function paint(text,range){el.innerHTML=renderLines(text);dirty=false;if(range)setSelection(range.start,range.end);}
  function reconcile(){
    if(composing || !dirty)return;
    const s=win.getSelection();if(!s?.rangeCount || !el.contains(s.anchorNode))return;
    const line=point(s.anchorNode,s.anchorOffset)?.line||0;
    if(line!==activeLine){const state=snapshot();paint(state.text,state);emit();}else markActive();
    activeLine=line;
  }
  let before;
  function undo(redo=false){
    if(composing)return;const next=index+(redo?1:-1);if(next<0||next>=history.length)return;
    clearTimeout(timer);index=next;lastType='';paint(history[index].text,history[index]);emit();
  }
  const events={
    beforeinput(e){if(e.inputType==='historyUndo'||e.inputType==='historyRedo'){e.preventDefault();undo(e.inputType==='historyRedo');}else before=snapshot();},
    input(e){dirty=true;if(composing)return;record(e.inputType||'edit',before);before=null;clearTimeout(timer);timer=setTimeout(emit,delay);},
    focus(){const s=win.getSelection();activeLine=point(s?.anchorNode,s?.anchorOffset)?.line||0;markActive();},
    blur(){if(composing)return;const state=snapshot();record('blur');paint(state.text);emit();},
    compositionstart(){composing=true;clearTimeout(timer);before=snapshot();},
    compositionend(){composing=false;dirty=true;record('composition',before);before=null;emit();},
    keydown(e){if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key.toLowerCase()==='z'||e.key.toLowerCase()==='y')){e.preventDefault();undo(e.key.toLowerCase()==='y'||e.shiftKey);}},
    paste(e){e.preventDefault();const text=e.clipboardData?.getData('text/plain')||'';before=snapshot();doc.execCommand('insertText',false,text);},
  };
  for(const [type,fn] of Object.entries(events))el.addEventListener(type,fn);
  const selChange=()=>{if(doc.activeElement===el)reconcile();};doc.addEventListener('selectionchange',selChange);
  function load(text){clearTimeout(timer);composing=false;paint(text);history=[{text,start:0,end:0}];index=0;lastType='';}
  function replace(text,range){const prev=snapshot();paint(text,range||{start:text.length,end:text.length});record('edit',prev);emit();}
  return {
    readText, selection, setSelection, load, replace,
    commit(){if(!emitting && !composing){record('commit');emit();}},
    repaint(){if(!composing){const state=snapshot();paint(state.text,state);}},
    undo, isComposing:()=>composing,
    destroy(){clearTimeout(timer);for(const [type,fn]of Object.entries(events))el.removeEventListener(type,fn);doc.removeEventListener('selectionchange',selChange);},
  };
}
