import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { sanitizeHtml } from '../src/sanitize.js';
import { render,renderSourceLines } from '../src/parser.js';
const win=new JSDOM('').window;
test('removes scripts, handlers, CSS, unsafe links and SVG foreign content',()=>{
 const html=sanitizeHtml('<img src=x onerror="alert(1)"><a href="javascript:alert(1)">bad</a><script>alert(1)</script><div style="position:fixed">safe</div><svg><foreignObject><iframe src="x"></iframe></foreignObject><animate onbegin="alert(1)"/></svg>',win);
 assert.doesNotMatch(html,/onerror|javascript:|<script|style=|foreignObject|iframe|animate|onbegin/i);assert.match(html,/safe/);
});
test('preserves sketch geometry, links, source lines and checkbox controls',()=>{
 const source='# Product\n[ ] Print\n[210x99mm+3 r5 fold]\nhttps://example.com\n| A | B |\n| --- | --- |\n| 1 | 2 |';
 const preview=sanitizeHtml(render(source).html,win);assert.match(preview,/sketch-fold/);assert.match(preview,/viewBox/);assert.match(preview,/data-check/);assert.match(preview,/<th/);assert.match(preview,/href="https:\/\/example.com"/);
 const editor=sanitizeHtml(renderSourceLines(source),win);assert.match(editor,/data-toggle="1"/);assert.match(editor,/contenteditable="false"/);assert.match(editor,/data-line="1"/);
});
test('committed vendor matches locked dependency',()=>assert.deepEqual(readFileSync(new URL('../src/vendor/dompurify.js',import.meta.url)),readFileSync(new URL('../node_modules/dompurify/dist/purify.es.mjs',import.meta.url))));
