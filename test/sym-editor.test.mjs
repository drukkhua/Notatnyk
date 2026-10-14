import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createSymEditor } from '../src/sym-editor.js';
import { renderSourceLines } from '../src/parser.js';
function setup(text){const w=new Window(),el=w.document.createElement('div');el.contentEditable='true';w.document.body.append(el);const changes=[];const editor=createSymEditor(el,{renderLines:renderSourceLines,onChange:t=>changes.push(t),delay:5});editor.load(text);el.focus();return {w,el,editor,changes};}
test('typing updates model without replacing the active DOM; undo/redo restores text and selection',async()=>{
 const {w,el,editor,changes}=setup('hello');editor.setSelection(5);
 const block=el.firstElementChild;
 el.dispatchEvent(new w.InputEvent('beforeinput',{inputType:'insertText'}));block.append('!');editor.setSelection(6);el.dispatchEvent(new w.InputEvent('input',{inputType:'insertText'}));
 await new Promise(r=>setTimeout(r,15));assert.equal(el.firstElementChild,block);assert.equal(changes.at(-1),'hello!');
 editor.undo();assert.equal(editor.readText(),'hello');assert.equal(editor.selection().start,5);editor.undo(true);assert.equal(editor.readText(),'hello!');editor.destroy();
});
test('IME emits after composition ends and never repaints live text',()=>{
 const {w,el,editor,changes}=setup('abc');editor.setSelection(3);const block=el.firstElementChild;
 el.dispatchEvent(new w.CompositionEvent('compositionstart'));block.append('字');el.dispatchEvent(new w.InputEvent('input',{inputType:'insertCompositionText'}));assert.equal(changes.length,0);editor.repaint();assert.equal(el.firstElementChild,block);
 el.dispatchEvent(new w.CompositionEvent('compositionend'));assert.equal(changes.at(-1),'abc字');assert.equal(el.firstElementChild,block);editor.destroy();
});
test('programmatic replacements preserve multi-line ranges and undo',()=>{
 const {editor}=setup('# Title\n[ ] Work');editor.setSelection(2,7);editor.replace('# New\n[ ] Work',{start:2,end:5});assert.deepEqual(editor.selection(),{start:2,end:5});editor.undo();assert.equal(editor.readText(),'# Title\n[ ] Work');assert.deepEqual(editor.selection(),{start:2,end:7});editor.load('other note');editor.undo();assert.equal(editor.readText(),'other note');editor.destroy();
});

test('decoration and mode changes preserve indentation and trailing spaces',()=>{
 const original='  # Title  \n\t[ ] Work \n   \n!! Warning  ';
 const {editor}=setup(original);assert.equal(editor.readText(),original);editor.repaint();assert.equal(editor.readText(),original);editor.destroy();
});

test('native bare text and nested paragraphs survive paste and selection round trips',()=>{
 const {w,el,editor}=setup('initial');el.replaceChildren(w.document.createTextNode('first'));
 const second=w.document.createElement('div');second.innerHTML='second<br>third<br>';el.append(second);
 assert.equal(editor.readText(),'first\nsecond\nthird');editor.setSelection(8,14);assert.deepEqual(editor.selection(),{start:8,end:14});editor.commit();editor.repaint();assert.equal(editor.readText(),'first\nsecond\nthird');editor.destroy();
});
