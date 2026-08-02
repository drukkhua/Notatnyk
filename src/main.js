import { render, setLocale, LOCALE, groupBlocks, allSectionKeys, longSectionKeys, renderSourceLines } from './parser.js';
import { I18N, LANGS } from './i18n.js';

// --- fs через глобальный Tauri API (withGlobalTauri) ---
// В этом проекте нет бандлера: файлы из src/ отдаются как есть, поэтому
// bare-импорт '@tauri-apps/plugin-fs' системный webview не резолвит. Вместо
// этого вызываем команды плагина напрямую через window.__TAURI__.core.invoke,
// точно повторяя полезную нагрузку официального JS-пакета.
const invoke = window.__TAURI__.core.invoke;
const BaseDirectory = { AppData: 14 };

const readTextFile = async (path, options) => {
  const arr = await invoke('plugin:fs|read_text_file', { path, options });
  const bytes = arr instanceof ArrayBuffer ? arr : Uint8Array.from(arr);
  return new TextDecoder('utf-8').decode(bytes);
};
const writeTextFile = async (path, data, options) => {
  await invoke('plugin:fs|write_text_file', new TextEncoder().encode(data), {
    headers: { path: encodeURIComponent(path), options: JSON.stringify(options) }
  });
};
const readDir = (path, options) => invoke('plugin:fs|read_dir', { path, options });
const mkdir   = (path, options) => invoke('plugin:fs|mkdir',    { path, options });
const remove  = (path, options) => invoke('plugin:fs|remove',   { path, options });
const exists  = (path, options) => invoke('plugin:fs|exists',   { path, options });
const stat    = (path, options) => invoke('plugin:fs|stat',     { path, options });
// Диалог выбора папки (плагин dialog). Возвращает путь или null.
const pickFolder = () => invoke('plugin:dialog|open',
  { options: { directory: true, multiple: false, title: t('folderTitle') } });
// Диалог сохранения файла (тот же плагин). Возвращает путь или null.
const saveDialog = (options) => invoke('plugin:dialog|save', { options });

const DIR = 'notatnyk';            // папка по умолчанию внутри AppData
const base = { baseDir: BaseDirectory.AppData };
const CONFIG = 'config.json';      // настройки (в AppData) — где лежат заметки

// --- расположение заметок ---
// Либо папка по умолчанию (DIR в AppData), либо выбранная пользователем
// (абсолютный путь, без baseDir). loc.p(name) собирает путь к файлу заметки.
let loc = defaultLoc();
function defaultLoc(){
  return { dir: DIR, opt: base, custom: false, p: n => `${DIR}/${n}` };
}
function customLoc(dir){
  return { dir, opt: {}, custom: true, p: n => `${dir}/${n}` };
}

let kwOverrides = {};              // ручные правки ключевых слов поверх языка
async function loadConfig(){
  try{
    if(await exists(CONFIG, base)){
      const cfg = JSON.parse(await readTextFile(CONFIG, base));
      if(cfg.folder && await exists(cfg.folder, {})) loc = customLoc(cfg.folder);
      if(cfg.lang) lang = LANGS.includes(cfg.lang) ? cfg.lang : 'ru';
      if(cfg.locale) kwOverrides = cfg.locale;     // ручные правки ключевых слов
      if(cfg.doc){                                  // шрифт/размер документа («Aa»)
        if(cfg.doc.font in DOC_FONTS) docFont = cfg.doc.font;
        if(+cfg.doc.size > 10 && +cfg.doc.size < 30) docSize = +cfg.doc.size;
      }
    }
  }catch{ loc = defaultLoc(); }
}
async function saveConfig(){
  const folder = loc.custom ? loc.dir : null;
  await writeTextFile(CONFIG, JSON.stringify({
    folder, lang, locale: kwOverrides,
    doc: { font: docFont, size: docSize },
  }), base);
}

// --- state ---
let notes = [];        // [{id, title, body, updated}]
let currentId = null;
let saveTimer = null;
let query = '';        // строка поиска

// --- els ---
const $ = s => document.querySelector(s);
const noteList = $('#noteList');
const sidebarEl = $('.sidebar');
const src = $('#src');
const out = $('#out');
const docTitle = $('#docTitle');
const counter = $('#counter');
const sumLabel = $('#sumLabel');
const sumState = $('#sumState');
const split = $('#split');
const search = $('#search');
const toolbar = $('#toolbar');
const cheat = $('#cheat');
const cheatTable = $('#cheatTable');
const tableDlg = $('#tableDlg');
const tblCols = $('#tblCols');
const tblRows = $('#tblRows');
const localeDlg = $('#localeDlg');
const locCurrency = $('#locCurrency');
const locTotal = $('#locTotal');
const locDone = $('#locDone');
const locUnit = $('#locUnit');
const locYear = $('#locYear');
const locPositions = $('#locPositions');

// --- локализация ---
let lang = 'ru';
let T = I18N.ru;                          // активный словарь интерфейса
function t(key, vars){                    // строка UI + подстановка {name}
  let s = (T[key] != null ? T[key] : key);
  if(vars) for(const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}
// Проставить статичный текст из data-i18n / -ph / -title / -html.
function applyDomText(){
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-ph]').forEach(el => el.placeholder = t(el.dataset.i18nPh));
  document.querySelectorAll('[data-i18n-title]').forEach(el => el.title = t(el.dataset.i18nTitle));
  document.querySelectorAll('[data-i18n-html]').forEach(el => el.innerHTML = t(el.dataset.i18nHtml));
}
// Применить язык целиком: ключевые слова движка + весь интерфейс.
function applyLang(code, overrides){
  lang = LANGS.includes(code) ? code : 'ru';
  T = I18N[lang];
  setLocale({ ...T.kw, ...(overrides || {}) });   // keywords движка (+ пользовательские правки)
  document.documentElement.setAttribute('lang', lang);
  applyDomText();
  buildToolbar(); buildCheat(); buildFontCards();
  reflectFolder();
  if(currentId !== undefined) paint();
  drawList();
}

// --- storage ---
async function ensureDir(){
  if(!(await exists(loc.dir, loc.opt))) await mkdir(loc.dir, { ...loc.opt, recursive:true });
}

// Время изменения файла (мс). Плагин fs может отдать mtime по-разному —
// разбираем число / ISO-строку / {secs,nanos}; при неудаче — «сейчас».
async function mtimeOf(path){
  try{
    const info = await stat(path, loc.opt);
    const m = info && (info.mtime ?? info.modifiedAt ?? info.mtimeMs);
    if(typeof m === 'number') return m;
    if(typeof m === 'string'){ const t = Date.parse(m); return isNaN(t) ? Date.now() : t; }
    if(m && typeof m === 'object' && 'secs_since_epoch' in m)
      return m.secs_since_epoch * 1000 + Math.floor((m.nanos_since_epoch || 0) / 1e6);
  }catch{}
  return Date.now();
}

async function loadAll(seedIfEmpty=true){
  await ensureDir();
  let entries = [];
  try { entries = await readDir(loc.dir, loc.opt); } catch { entries = []; }
  const loaded = [];
  for(const e of entries){
    if(!e.name.endsWith('.md')) continue;          // заметка = .md файл, и всё
    const id = e.name.slice(0, -3);
    try{
      const body = await readTextFile(loc.p(e.name), loc.opt);
      const updated = await mtimeOf(loc.p(e.name)); // «изменено» = mtime файла
      loaded.push({ id, title: titleFrom(body), body, updated });
    }catch{}
  }
  loaded.sort((a,b)=> (b.updated||0)-(a.updated||0));
  notes = loaded;
  if(notes.length === 0 && seedIfEmpty){ await seed(); }
  currentId = notes[0]?.id || null;
}

async function save(note){
  await writeTextFile(loc.p(`${note.id}.md`), note.body, loc.opt);
}

async function del(id){
  try{ await remove(loc.p(`${id}.md`), loc.opt); }catch{}
  try{ await remove(loc.p(`${id}.json`), loc.opt); }catch{} // подчистить старый мета-файл, если был
}

function titleFrom(body){
  for(const line of body.split('\n')){
    const ln = line.trim();
    if(!ln) continue;
    return ln.replace(/^#+\s*/,'').replace(/[#*=]/g,'').trim() || t('untitled');
  }
  return t('untitled');
}

// --- поиск ---
// Нормализация: разбиваем camelCase, приводим к нижнему регистру и убираем все
// пробелы. Так поиск нечувствителен к регистру и границам слов:
// «camelcase», «camel case» и «camelCase» совпадают.
function key(s){
  return (s||'')
    .replace(/([a-zа-яёіїєґ0-9])([A-ZА-ЯЁІЇЄҐ])/g, '$1 $2')
    .toLowerCase()
    .replace(/\s+/g, '');
}
function matches(n){
  if(!query) return true;
  return key(n.title + ' ' + (n.body||'')).includes(key(query));
}

// --- ui ---
function drawList(){
  noteList.innerHTML = '';
  const shown = notes.filter(matches);
  if(shown.length === 0){
    const li = document.createElement('li');
    li.className = 'note-empty';
    li.textContent = query ? t('notFound') : t('emptyList');
    noteList.appendChild(li);
    return;
  }
  for(const n of shown){
    const li = document.createElement('li');
    li.className = 'note-item' + (n.id===currentId?' active':'');
    const d = new Date(n.updated);
    const stamp = d.toLocaleDateString(T.dateLocale)
      + ' ' + d.toLocaleTimeString(T.dateLocale, { hour:'2-digit', minute:'2-digit' });
    li.innerHTML = `<div class="t">${escapeHtml(n.title)}</div>`
      + `<div class="d">${stamp}</div>`;
    li.onclick = ()=>{ select(n.id); setDrawer(false); };   // на телефоне закрываем drawer после выбора
    noteList.appendChild(li);
  }
}
function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

function current(){ return notes.find(n=>n.id===currentId); }

function select(id){
  currentId = id;
  const n = current();
  src.value = n ? n.body : '';
  loadFolds();            // свёрнутость этой заметки (localStorage), до первого paint
  drawList();
  // режим просмотра — запомненный для этой заметки, иначе дефолт (телефон — симбиоз)
  const mode = loadView() || (window.matchMedia('(max-width:640px)').matches ? 'sym' : 'source');
  applyView(mode);        // ставит панель БЕЗ коммита симбиоза: src.value уже = тело заметки
  paint();
  if(mode === 'sym') symPaint(src.value);   // симбиоз-холст под новую заметку
}

// ── Компактный вид: дерево секций + свёрнутость (порт из BitrixUI) ───────────
// Состояние свёрнутости живёт в localStorage (per-note), НЕ в .md — формат чист.
let renderTree = [];          // groupBlocks(blocks) текущей заметки
let currentFolds = new Set(); // ключи свёрнутых секций
let foldsStored = false;      // есть ли явно сохранённое состояние для этой заметки
let foldsInit = false;        // применили ли дефолт (моб-эвристика) для этой заметки
let lastCheckMap = [];        // checkLineMap последнего рендера (для клика по чек-боксу)

const foldKey = () => currentId ? `notatnyk.folds.${currentId}` : null;
function loadFolds(){
  currentFolds = new Set(); foldsStored = false; foldsInit = false;
  const k = foldKey(); if(!k) return;
  try{ const raw = localStorage.getItem(k);
    if(raw != null){ currentFolds = new Set(JSON.parse(raw)); foldsStored = true; } }catch{}
}
function saveFolds(){
  const k = foldKey(); if(!k) return;
  try{ localStorage.setItem(k, JSON.stringify([...currentFolds])); foldsStored = true; }catch{}
}
// Режим просмотра (Исходник/Симбиоз/Рендер) — тоже per-note, в localStorage (не в .md).
// Сохраняется только когда пользователь сам переключил панель; иначе заметка следует
// дефолту по ширине экрана (телефон — симбиоз, десктоп — исходник).
const viewKey = () => currentId ? `notatnyk.view.${currentId}` : null;
function loadView(){
  const k = viewKey(); if(!k) return null;
  try{ const v = localStorage.getItem(k); return (v === 'source' || v === 'sym' || v === 'view') ? v : null; }catch{ return null; }
}
function saveView(){
  const k = viewKey(); if(!k) return;
  try{ localStorage.setItem(k, viewMode); }catch{}
}
// Дефолт при первом показе заметки: телефон — длинные секции свёрнуты; десктоп — всё открыто.
function applyFoldDefaults(){
  if(foldsInit) return;
  foldsInit = true;
  if(foldsStored) return;                       // у пользователя явное состояние
  const mobile = window.matchMedia('(max-width:640px)').matches;
  currentFolds = new Set(mobile ? longSectionKeys(renderTree) : []);
}

// Подпись свёрнутой шапки: «1/4 ✓ · Итого: N грн» / «▦ 7» (локализовано валютой/словом).
function sectionSummaryText(roll){
  const parts = [];
  if(roll.checks > 0) parts.push(`${roll.done}/${roll.checks} ✓`);
  const money = roll.declared != null && roll.declared > 0 ? roll.declared : (roll.sum > 0 ? roll.sum : 0);
  const nf = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  if(money > 0) parts.push(`${LOCALE.total}: ${nf(money)} ${LOCALE.currency}`);
  else if(roll.rows > 0) parts.push(`▦ ${roll.rows}`);
  return parts.join(' · ');
}

// Дерево узлов → HTML. Подряд идущие блоки — как есть (сохраняем делегирование
// кликов и data-line); секция — обёртка с кликабельной шапкой и (если не свёрнута) телом.
function renderNodesHtml(nodes){
  let h = '';
  for(const n of nodes){
    if(n.block){ h += n.block.html; continue; }
    const sec = n.section;
    const col = currentFolds.has(sec.key);
    h += `<section class="r-sec lvl${sec.level}${col?' collapsed':''}">`
      + `<div class="r-sec-head r-h${sec.level}" data-fold="${encodeURIComponent(sec.key)}"`
      + ` data-line="${sec.header.line}" role="button" tabindex="0" aria-expanded="${!col}">`
      + '<span class="r-sec-caret" aria-hidden="true"></span>'
      + `<span class="r-sec-title">${sec.header.titleHtml}</span>`
      + (col ? `<span class="r-sec-sum">${sectionSummaryText(sec.roll)}</span>` : '')
      + '</div>'
      + (col ? '' : `<div class="r-sec-body">${renderNodesHtml(sec.children)}</div>`)
      + '</section>';
  }
  return h;
}

function toggleFold(key){
  if(currentFolds.has(key)) currentFolds.delete(key); else currentFolds.add(key);
  saveFolds();
  drawRender(); collectAnchors(); updateFoldAllBtn();
}

// Отрисовать рендер из дерева + навесить обработчики (чек-боксы, шапки секций).
function drawRender(){
  out.innerHTML = renderNodesHtml(renderTree);
  out.querySelectorAll('.r-check').forEach(node=>{
    node.onclick = ()=>{
      const idx = +node.dataset.check;
      const lineNo = lastCheckMap[idx];
      const lines = src.value.split('\n');
      lines[lineNo] = lines[lineNo].replace(/\[([ xX])\]/,(m,ch)=>
        ch.toLowerCase()==='x' ? '[ ]' : '[x]');
      src.value = lines.join('\n');
      persist(); paint();
    };
  });
  out.querySelectorAll('.r-sec-head').forEach(head=>{
    const key = decodeURIComponent(head.dataset.fold);
    head.onclick = ()=> toggleFold(key);
    head.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleFold(key); } };
  });
}

function updateFoldAllBtn(){
  const btn = $('#foldAllBtn'); if(!btn) return;
  const keys = allSectionKeys(renderTree);
  if(!keys.length){ btn.hidden = true; return; }
  btn.hidden = false;
  const anyCollapsed = keys.some(k => currentFolds.has(k));
  btn.textContent = anyCollapsed ? t('expandAll') : t('collapseAll');
}

// ── Оглавление (Outline): список секций сметы с их Σ; клик — прыжок к секции ──
// Данные берём из готового дерева groupBlocks(): секция = заголовок #/##/### со
// сводом roll.sum. Кнопка в шапке видна только когда секций ≥ 2 (иначе бесполезна).
function outlineEntries(nodes = renderTree, chain = [], acc = []){
  for(const n of nodes){
    if(!n.section) continue;
    const s = n.section;
    acc.push({ title: s.header.title || '—', level: s.level, line: s.header.line,
               key: s.key, sum: s.roll.sum, ancestors: chain });
    outlineEntries(s.children, chain.concat(s.key), acc);
  }
  return acc;
}
let outlineEl = null;
function updateOutlineBtn(){
  const btn = $('#outlineBtn'); if(!btn) return;
  const few = outlineEntries().length < 2;
  btn.hidden = few;
  if(few) closeOutline();
}
function ensureOutlineEl(){
  if(outlineEl) return;
  outlineEl = document.createElement('div');
  outlineEl.className = 'outline';
  outlineEl.hidden = true;
  document.body.appendChild(outlineEl);
}
function outlineOpen(){ return outlineEl && !outlineEl.hidden; }
function closeOutline(){ if(outlineEl) outlineEl.hidden = true; }
function toggleOutline(){ outlineOpen() ? closeOutline() : openOutline(); }
function openOutline(){
  const entries = outlineEntries();
  if(entries.length < 2) return;
  ensureOutlineEl();
  const nf = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const cur = topLineOf(out);                    // текущая секция вверху рендера — подсветим
  let curIdx = -1; entries.forEach((e, i) => { if(e.line <= cur) curIdx = i; });
  const box = document.createElement('div'); box.className = 'outline-list';
  entries.forEach((e, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `outline-item lvl${e.level}${i === curIdx ? ' cur' : ''}`;
    const sum = e.sum > 0 ? `<span class="outline-sum">${nf(e.sum)} ${LOCALE.currency}</span>` : '';
    b.innerHTML = `<span class="outline-title">${escapeHtml(e.title)}</span>${sum}`;
    b.onclick = () => jumpToSection(e.line, e.ancestors);
    box.appendChild(b);
  });
  outlineEl.innerHTML = ''; outlineEl.appendChild(box);
  outlineEl.hidden = false;
  positionOutline();
  const on = box.children[curIdx]; if(on) on.scrollIntoView({ block:'nearest' });
}
function positionOutline(){
  const btn = $('#outlineBtn'); if(!btn) return;
  const r = btn.getBoundingClientRect();
  const w = outlineEl.offsetWidth || 300;
  outlineEl.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
  outlineEl.style.top = (r.bottom + 6) + 'px';
}
function scrollSrcToLine(line){
  const lh = parseFloat(getComputedStyle(src).lineHeight) || 20;
  src.scrollTop = Math.max(0, line * lh - 20);
}
function jumpToSection(line, ancestors){
  let changed = false;                           // раскрыть свёрнутых предков — иначе шапки нет в DOM
  for(const k of ancestors) if(currentFolds.has(k)){ currentFolds.delete(k); changed = true; }
  if(changed){ saveFolds(); drawRender(); collectAnchors(); updateFoldAllBtn(); }
  scrollPaneToLine(out, line);                   // рендер — канонический «атлас» сметы
  if(viewMode === 'sym') scrollPaneToLine(sym, line);      // и активный редактор, если виден
  else if(viewMode === 'source') scrollSrcToLine(line);
  closeOutline();
}

// ── Командная палитра (Cmd/Ctrl+K): быстрый переход к заметке + частые действия ─
// Пустой запрос — все заметки (свежие сверху). Печатаешь — фильтр по заголовку/телу
// (та же нормализация key(), что и боковой поиск) + команды, совпавшие по названию.
let paletteEl = null, palInput = null, palListEl = null, palItems = [], palIdx = 0;
function paletteCommands(){
  return [
    { label: t('newNote'),      keys:'new note новая заметка смета создать', run: newNote },
    { label: t('cmdExport'),    keys:'export экспорт отдать клиенту pdf',    run: exportNote },
    { label: t('fontTitle'),    keys:'font шрифт документ',                  run: openDocDlg },
    { label: t('settingsTitle'),keys:'settings настройки язык ключевые слова', run: openLocaleDlg },
    { label: t('help'),         keys:'help справка шпаргалка синтаксис',     run: ()=>{ cheat.hidden = false; } },
    { label: t('theme'),        keys:'theme тема тёмная светлая dark light', run: toggleTheme },
  ];
}
function ensurePalette(){
  if(paletteEl) return;
  paletteEl = document.createElement('div');
  paletteEl.className = 'palette-wrap';
  paletteEl.hidden = true;
  paletteEl.innerHTML = '<div class="palette"><input class="palette-input" type="text" spellcheck="false" /><div class="palette-list"></div></div>';
  document.body.appendChild(paletteEl);
  palInput = paletteEl.querySelector('.palette-input');
  palListEl = paletteEl.querySelector('.palette-list');
  palInput.addEventListener('input', renderPalette);
  palInput.addEventListener('keydown', onPaletteKey);
  paletteEl.addEventListener('mousedown', e => { if(e.target === paletteEl) closePalette(); });
}
function paletteOpen(){ return paletteEl && !paletteEl.hidden; }
function closePalette(){ if(paletteEl) paletteEl.hidden = true; }
function openPalette(){
  ensurePalette();
  palInput.value = '';
  palInput.placeholder = t('palettePh');
  paletteEl.hidden = false;
  renderPalette();
  palInput.focus();
}
function togglePalette(){ paletteOpen() ? closePalette() : openPalette(); }
function buildPalItems(qRaw){
  const q = key(qRaw);
  let ns = notes.map(n => ({ kind:'note', label: n.title || t('untitled'), updated: n.updated,
                             body: n.body, run: ()=>{ closePalette(); select(n.id); } }));
  if(q) ns = ns.filter(n => key(n.label + ' ' + (n.body || '')).includes(q))
              .sort((a, b) => (key(a.label).includes(q) ? 0 : 1) - (key(b.label).includes(q) ? 0 : 1)
                              || b.updated - a.updated);
  else  ns = ns.sort((a, b) => b.updated - a.updated);
  let cs = [];
  if(q) cs = paletteCommands()
              .filter(c => key(c.label + ' ' + c.keys).includes(q))
              .map(c => ({ kind:'cmd', label: c.label, run: ()=>{ closePalette(); c.run(); } }));
  return [...ns, ...cs];
}
function renderPalette(){
  palItems = buildPalItems(palInput.value);
  palIdx = 0;
  if(!palItems.length){ palListEl.innerHTML = `<div class="palette-empty">${escapeHtml(t('notFound'))}</div>`; return; }
  palListEl.innerHTML = '';
  palItems.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'palette-item' + (i === palIdx ? ' on' : '');
    const badge = it.kind === 'cmd' ? `<span class="palette-badge">${escapeHtml(t('cmdBadge'))}</span>` : '';
    b.innerHTML = `<span class="palette-label">${escapeHtml(it.label)}</span>${badge}`;
    b.onmousedown = e => { e.preventDefault(); it.run(); };
    b.onmousemove = () => { if(palIdx !== i){ palIdx = i; paintPalActive(); } };
    palListEl.appendChild(b);
  });
}
function paintPalActive(){
  const els = palListEl.querySelectorAll('.palette-item');
  els.forEach((el, i) => el.classList.toggle('on', i === palIdx));
  const on = els[palIdx]; if(on) on.scrollIntoView({ block:'nearest' });
}
function movePal(d){ if(!palItems.length) return; palIdx = (palIdx + d + palItems.length) % palItems.length; paintPalActive(); }
function onPaletteKey(e){
  if(e.key === 'ArrowDown'){ e.preventDefault(); movePal(1); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); movePal(-1); }
  else if(e.key === 'Enter'){ e.preventDefault(); const it = palItems[palIdx]; if(it) it.run(); }
  else if(e.key === 'Escape'){ e.preventDefault(); closePalette(); }
}

function paint(){
  const text = src.value;
  const { stats, checkLineMap, blocks } = render(text);
  lastCheckMap = checkLineMap;
  renderTree = groupBlocks(blocks);
  applyFoldDefaults();
  drawRender();
  updateFoldAllBtn();
  updateOutlineBtn();

  docTitle.textContent = titleFrom(text);
  if(stats.checksTotal>0){
    counter.hidden = false;
    counter.textContent = `${stats.checksDone}/${stats.checksTotal} ${t('printed')}`;
  } else counter.hidden = true;

  const nf = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }); // как в движке
  const C = LOCALE.currency;
  const secs = stats.sections || [];
  if(secs.length){
    // Разбивка по каждому «Итого» + их общая сумма
    const parts = secs.map((s, i) => `${LOCALE.total}(${i+1}): ${nf(s.declared != null ? s.declared : s.sum)} ${C}`);
    const declaredSum = stats.declared != null ? stats.declared : stats.total;
    sumLabel.innerHTML = parts.join(' · ') + `  ·  <b>${t('sumWord')}: ${nf(declaredSum)} ${C}</b>`;
    const diff = Math.round((stats.total - declaredSum) * 100) / 100;
    if(diff === 0){
      sumState.className = 'ok';
      sumState.textContent = t('matchOk');
    }else{
      const sign = diff > 0 ? '+' : '';
      sumState.className = 'bad';
      sumState.textContent = t('mismatch', { x: nf(stats.total), d: sign + nf(diff) });
    }
  }else{
    // Нет ни одного «Итого» — просто общая Σ позиций
    sumLabel.innerHTML = `Σ ${LOCALE.positions} (${stats.positions}) : <b>${nf(stats.total)} ${C}</b>`;
    sumState.className = 'ok';
    sumState.textContent = '—';
  }

  updateGutter();      // номера строк — под новую геометрию текста
  collectAnchors();    // якоря синк-скролла — по свежему рендеру
}

// ── Номера строк и синхронный скролл: редактор ↔ рендер ─────────────────────
// Высоты логических строк меряем «зеркалом» — дивом с метриками textarea: при
// переносе строка занимает несколько визуальных рядов, и её номер должен занять
// её реальную высоту. Синк скролла — по якорям data-line, которые движок ставит
// на каждый блок рендера: проценты «плывут» на таблицах и скрытых блоках, якоря
// с интерполяцией между ними — нет. Ведёт та панель, где находится пользователь.
const gutterInner = $('#gutterInner');
let mirror = null;                       // измеритель высот строк
let lineTops = [0], lineHeights = [];    // геометрия строк источника
let anchors = [];                        // [{line, top}] — блоки рендера
let activePane = null;                   // 'src' | 'out' — кто ведёт синк

function ensureMirror(){
  if(mirror) return;
  const cs = getComputedStyle(src);
  mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position:'absolute', left:'-99999px', top:'0', visibility:'hidden',
    whiteSpace:'pre-wrap', wordBreak:'break-word',
    font:cs.font, letterSpacing:cs.letterSpacing,
  });
  document.body.appendChild(mirror);
}

function updateGutter(){
  const cs = getComputedStyle(src);
  const w = src.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if(w <= 0) return;                     // редактор скрыт (симбиоз/рендер/телефон)
  ensureMirror();
  mirror.style.width = w + 'px';
  const lines = src.value.split('\n');
  mirror.innerHTML = '';
  const cells = lines.map(l => {
    const d = document.createElement('div');
    d.textContent = l === '' ? ' ' : l;
    mirror.appendChild(d);
    return d;
  });
  lineHeights = cells.map(d => d.offsetHeight);
  mirror.innerHTML = '';
  lineTops = [0];
  for(const h of lineHeights) lineTops.push(lineTops[lineTops.length - 1] + h);
  const lh = parseFloat(cs.lineHeight) || 22;  // высота одного визуального ряда
  gutterInner.style.width = (String(lines.length).length + 1) + 'ch';
  gutterInner.innerHTML = lines.map((_, i) =>
    `<div style="height:${lineHeights[i]}px;line-height:${lh}px">${i + 1}</div>`).join('');
}

// Позиции блоков рендера в координатах скролла #out
function collectAnchors(){
  anchors = [];
  const oTop = out.getBoundingClientRect().top;
  out.querySelectorAll('[data-line]').forEach(el => {
    anchors.push({ line:+el.dataset.line, top: el.getBoundingClientRect().top - oTop + out.scrollTop });
  });
}

// y источника (px контента) ↔ дробный номер строки
function lineAtY(y){
  let lo = 0, hi = lineHeights.length - 1, i = 0;
  while(lo <= hi){ const m = (lo + hi) >> 1; if(lineTops[m] <= y){ i = m; lo = m + 1; } else hi = m - 1; }
  const h = lineHeights[i] || 22;
  return i + Math.max(0, Math.min(1, (y - lineTops[i]) / h));
}
const yAtLine = ln => {
  const i = Math.max(0, Math.min(lineHeights.length - 1, Math.floor(ln)));
  return lineTops[i] + (ln - i) * (lineHeights[i] || 22);
};

function syncFromSrc(){
  if(!anchors.length || !lineHeights.length) return;
  const ln = lineAtY(src.scrollTop);
  let a = anchors[0], b = null;
  for(const an of anchors){ if(an.line <= ln) a = an; else { b = an; break; } }
  const base = anchors[0].top;           // верхний отступ рендера — в ноль
  const target = b
    ? a.top + (b.top - a.top) * (ln - a.line) / (b.line - a.line || 1)
    : a.top + (yAtLine(ln) - yAtLine(a.line));
  out.scrollTop = Math.max(0, target - base);
}

function syncFromOut(){
  if(!anchors.length || !lineHeights.length) return;
  const y = out.scrollTop + anchors[0].top;
  let a = anchors[0], b = null;
  for(const an of anchors){ if(an.top <= y) a = an; else { b = an; break; } }
  const ln = b
    ? a.line + (b.line - a.line) * (y - a.top) / (b.top - a.top || 1)
    : a.line + (y - a.top) / (lineHeights[0] || 22);
  src.scrollTop = Math.max(0, yAtLine(ln));
}

// ── Синхроскролл симбиоз-холст (#sym) ↔ рендер (#out) по data-line ──────────
// Обе панели несут data-line на строках/блоках. Ведём по живым координатам DOM
// (без предвычисленных якорей): у ведущей панели находим строку у верхнего края,
// у ведомой прокручиваем эту же строку к верхнему краю.
function topLineOf(pane){
  const pTop = pane.getBoundingClientRect().top;
  let best = null;
  pane.querySelectorAll('[data-line]').forEach(el => {
    const top = el.getBoundingClientRect().top - pTop;
    if(top <= 1 && (!best || top > best.top)) best = { line:+el.dataset.line, top };
  });
  if(best) return best.line;
  const first = pane.querySelector('[data-line]');
  return first ? +first.dataset.line : 0;
}
function scrollPaneToLine(pane, line){
  const el = pane.querySelector(`[data-line="${line}"]`);
  if(!el) return;
  pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
}

src.addEventListener('mouseenter', () => activePane = 'src');
out.addEventListener('mouseenter', () => activePane = 'out');
src.addEventListener('touchstart', () => activePane = 'src', { passive:true });
out.addEventListener('touchstart', () => activePane = 'out', { passive:true });
src.addEventListener('focus', () => activePane = 'src');
src.addEventListener('scroll', () => {
  gutterInner.style.transform = `translateY(${-src.scrollTop}px)`;
  if(activePane === 'src') syncFromSrc();
});
out.addEventListener('scroll', () => {
  if(activePane !== 'out') return;
  if(viewMode === 'sym') scrollPaneToLine(sym, topLineOf(out));  // рендер → симбиоз
  else syncFromOut();                                            // рендер → источник
});
new ResizeObserver(() => { updateGutter(); collectAnchors(); }).observe(src);

function persist(){
  const n = current(); if(!n) return;
  n.body = src.value;
  n.title = titleFrom(src.value);
  n.updated = Date.now();
  notes.sort((a,b)=> b.updated-a.updated);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> save(n), 300);   // дебаунс автосохранения
  drawList();
}

async function newNote(){
  const n = { id: crypto.randomUUID(), title: t('newNote'),
              body: t('newNoteBody'), updated: Date.now() };
  notes.unshift(n);
  await save(n);
  select(n.id);
  src.focus();
}

async function deleteCurrent(){
  const n = current(); if(!n) return;
  if(!confirm(t('confirmDel', { t: n.title }))) return;
  await del(n.id);
  notes = notes.filter(x=>x.id!==n.id);
  currentId = notes[0]?.id || null;
  select(currentId);
}

// Иконки тулбара — инлайн-SVG из набора Lucide (MIT, lucide.dev), тот же стиль,
// что у кнопок шапки («Папка», шестерёнка, «Тема»): 24×24, stroke=2, currentColor.
const tbIcon = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const TBI = {
  head:      tbIcon('<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>'),          // heading
  check:     tbIcon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>'), // square-check
  listNum:   tbIcon('<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/>'
                  + '<path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),       // list-ordered
  list:      tbIcon('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/>'
                  + '<path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),          // list
  callout:   tbIcon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>'
                  + '<path d="M12 9v4"/><path d="M12 17h.01"/>'),                            // triangle-alert
  quote:     tbIcon('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2'
                  + ' 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'
                  + '<path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2'
                  + ' 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'),    // quote
  hrThin:    tbIcon('<path d="M5 12h14"/>'),                                                 // minus
  table:     tbIcon('<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/>'
                  + '<path d="M3 9h18"/><path d="M3 15h18"/>'),                              // table
  hideLine:  tbIcon('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696'
                  + ' 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>'
                  + '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696'
                  + ' 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'),              // eye-off
  hideBlock: tbIcon('<path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/>'
                  + '<path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/>'), // eye-closed
  dimBox:    tbIcon('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>'
                  + '<path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>'
                  + '<rect width="7" height="5" x="7" y="7" rx="1"/>'
                  + '<path d="M7 17H5"/><path d="M19 17h-2"/>'
                  + '<path d="M12 21v-2"/><path d="M12 5V3"/>'),           // frame-square (ruler sketch)
  dimCirc:   tbIcon('<circle cx="12" cy="12" r="10"/>'
                  + '<path d="M12 2v4"/><path d="M12 18v4"/>'
                  + '<path d="M2 12h4"/><path d="M18 12h4"/>'),            // circle with crosshair
  bold:      tbIcon('<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>'), // bold
  italic:    tbIcon('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/>'
                  + '<line x1="15" x2="9" y1="4" y2="20"/>'),                                // italic
  strike:    tbIcon('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/>'
                  + '<line x1="4" x2="20" y1="12" y2="12"/>'),                               // strikethrough
  mark:      tbIcon('<path d="m9 11-6 6v3h9l3-3"/>'
                  + '<path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'), // highlighter
  code:      tbIcon('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),                     // code
  date:      tbIcon('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/>'
                  + '<path d="M3 10h18"/>'),                                                 // calendar
  dateTime:  tbIcon('<path d="M16 14v2.2l1.6 1"/><path d="M16 2v4"/>'
                  + '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5.25"/>'
                  + '<path d="M3 10h18"/><circle cx="16" cy="16" r="6"/>'),                  // calendar-clock
  variable:  tbIcon('<path d="M8 21s-4-3-4-9 4-9 4-9"/><path d="M16 3s4 3 4 9-4 9-4 9"/>'
                  + '<line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/>'), // variable
  calc:      tbIcon('<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/>'
                  + '<line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/>'
                  + '<path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/>'
                  + '<path d="M12 18h.01"/><path d="M8 18h.01"/>'),                          // calculator
};

// --- подсказки синтаксиса (тулбар + шпаргалка) ---
// Список строится под текущий язык и ключевые слова. head — заголовок группы
// (в шпаргалке — секция, в тулбаре — разделитель). btn+ins — кнопка вставки;
// ico — иконка кнопки (без ico кнопка текстовая: ключевые слова валюты/единиц
// видны как есть). table:true — открывает диалог размера таблицы.
// Запись без btn — только в шпаргалке.
function buildSyntax(){
  const cur = LOCALE.currency, unit = LOCALE.unit, tot = LOCALE.total;
  const exDate = dateStr(false), exDateTime = dateStr(true);
  return [
    // Порядок — смысловыми рядами, как пишется заметка:
    // структура: заголовок → списки → цитата/таблица/выноска → линии → скрытие;
    // инлайн: начертания → дата; деньги: переменная → расчёт → цены → итог → тираж.
    { head: t('grpStruct') },
    { ico:'head',    line:'# ',  cls:'head', on:/^#{1,3}\s/, w:'# / ## / ###', g:t('sHead'),
      menu:[['H1','# '],['H2','## '],['H3','### ']] },
    { ico:'list',    line:'- ',  cls:'list', on:/^[-*]\s/,   w:'- / *',        g:t('sList') },
    { ico:'listNum', line:'1. ', cls:'list', on:/^\d+\.\s/,  w:'1.',           g:t('sNum') },
    { ico:'check',   line:'[ ] ', cls:'list', on:/^\[[ xX]\]\s/, w:'[ ] / [x]', g:t('sCheck', { done: LOCALE.done }) },
    { ico:'quote',   line:'> ',  cls:'quote', on:/^>\s?/, w:`> … / > @${LOCALE.client}`, g:t('sQuote') },
    { ico:'table',   table:true,    w:'| A | B |',    g:t('sTable') },
    { ico:'callout', line:'! ',  cls:'callout', on:/^!{1,2}\s/, w:'! / !!',    g:t('sCallout'),
      menu:[['!','! '],['!!','!! ']] },
    { ico:'dimBox',  ins:'[50x90мм]', sel:'50x90', w:'[50x90мм]  [50x90мм r5]  [50x90мм+3]  [210x99мм fold]',  g:t('sDimBox') },
    { ico:'dimCirc', ins:'[d50мм]',  sel:'50',    w:'[d50мм]',    g:t('sDimCirc') },
    { ico:'hrThin',  block:'---\n', w:'---',          g:t('sHrThin'),
      menu:[['—','---\n'],['≡','===\n']] },
    {                               w:'===',          g:t('sHrBold') },
    { ico:'hideLine',  line:'// ', cls:'hide', on:/^\/\//, w:'// …',           g:t('sHide') },
    { ico:'hideBlock', hideBlock:true, w:'/* … */',  g:t('sHideBlock') },

    { head: t('grpInline') },
    { ico:'bold',    wrap:'**', ph:t('exBold'),   w:'**…**',   g:t('sBold') },
    { ico:'italic',  wrap:'*',  ph:t('exItalic'), w:'*…*',     g:t('sItalic') },
    { ico:'strike',  wrap:'~~', ph:t('exStrike'), w:'~~…~~',   g:t('sStrike') },
    { ico:'mark',    wrap:'==', ph:t('exMark'),   w:'== … ==', g:t('sMark') },
    { ico:'code',    wrap:'`',  ph:t('exCode'),   w:'`…`',     g:t('sCode') },
    {                w:'-> · <- · <->',  g:t('sArrow') },
    {                w:'10x15 · м2 · ...', g:t('sTypo') },
    {                w:'(c) · (tm) · +-', g:t('sSym') },
    {                w:'https://…', g:t('sLink') },
    { ico:'date',     ins:'[date]',      w:`[date] → ${exDate}`, g:t('sDate', { date: exDate }) },
    { ico:'dateTime', ins:'[date:time]', w:'[date:time]',        g:t('sDateTime', { datetime: exDateTime }) },

    { head: t('grpMoney') },
    { ico:'variable',       block:`[${t('exVar')}] = `, sel:t('exVar'),
                            w:`[${t('exVar')}] = 1125`,                           g:t('sVar') },
    {                       w:`… [${t('exVar')}] …`,                                g:t('sVarRef') },
    { ico:'calc',           ins:'2*3=', sel:'2*3',      w:'55*3+(2.5+3.5)*2=',    g:t('sCalc') },
    {                       w:`18400/1200*1125= ${cur}`,                          g:t('sCalcPrice') },
    { btn:`= ${cur}`,       ins:`= 0 ${cur}`, sel:'0',  w:`= / : 12 450 ${cur}`,  g:t('sPrice') },
    {                       w:`2490 ${cur} / - 2490 ${cur}`,                      g:t('sPriceOther') },
    {                       w:`\\= / \\: 500 ${cur}`,                             g:t('sEscape') },
    { btn:`${cur}/${unit}`, ins:` ${cur}/${unit}`,      w:`${cur}/${unit}`,       g:t('sPerUnit') },
    { btn:tot,              block:`${tot}  ${cur}`, caret:` ${cur}`,
                            w:`${tot}: N ${cur}`,                                 g:t('sTotal') },
    { btn:`[${unit}]`,      ins:`[4000 ${unit}]`, sel:'4000', w:`[4000 ${unit}]`, g:t('sQtyUnit', { total: tot }) },

    // Денежная петля: строковые и спец-переменные → кнопки в экспорте «Отдать клиенту».
    // Только в шпаргалке (без кнопок тулбара — бюджет хрома, complexity-audit §5).
    { head: t('grpEstimate') },
    {                       w:`[${t('exVar')}] = ${t('exStr')}`,                    g:t('sStrVar') },
    {                       w:`[${LOCALE.payVar}] = https://…`,                     g:t('sPayVar') },
    {                       w:`[${LOCALE.depositVar}] = 30%`,                        g:t('sDeposit', { total: tot }) },
    {                       w:`[${LOCALE.validVar}] = 01.08`,                        g:t('sValid') },
    {                       w:`[${LOCALE.emailVar}] = …`,                            g:t('sEmailVar') },
  ];
}

function buildToolbar(){
  toolbar.innerHTML = '';
  tbState = [];                                   // кнопки с подсветкой состояния — заново
  let empty = true;                               // ещё не добавили ни одной кнопки
  for(const it of buildSyntax()){
    if(it.head){                                  // граница группы — тонкий разделитель
      if(!empty) toolbar.appendChild(Object.assign(document.createElement('span'), { className:'tb-sep' }));
      continue;
    }
    if(!it.btn && !it.ico) continue;              // справочные записи — без кнопки
    const b = document.createElement('button');
    b.className = 'tb-btn';
    b.title = it.w ? `${it.g}  ·  ${it.w}` : it.g;  // в тултипе — и что делает, и синтаксис
    if(it.ico && TBI[it.ico]) b.innerHTML = TBI[it.ico];
    else b.textContent = it.btn;
    // mousedown не отдаём кнопке: фокус и выделение остаются в редакторе
    // (и на мобилке не прячется клавиатура)
    b.onmousedown = e => e.preventDefault();
    if(it.on || it.wrap || it.hideBlock) tbState.push({ b, it });
    // Кнопка с подменю (menu: [[метка, вставка], …]). Десктоп: варианты по ховеру,
    // клик по самой кнопке — вставка по умолчанию. Тач (hover нет): клик открывает меню.
    if(it.menu){
      const g = document.createElement('span'); g.className = 'tb-group';
      const wrap = document.createElement('span'); wrap.className = 'tb-menu';
      const box = document.createElement('span'); box.className = 'tb-menu-box';
      for(const [lbl, ins] of it.menu){
        const mb = document.createElement('button');
        mb.className = 'tb-btn'; mb.textContent = lbl;
        mb.onmousedown = e => e.preventDefault();
        mb.onclick = e => { e.stopPropagation(); g.classList.remove('open'); runInsert(it, ins); };
        box.appendChild(mb);
      }
      b.onclick = () => {
        if(matchMedia('(hover: hover)').matches) runInsert(it);
        else g.classList.toggle('open');
      };
      wrap.appendChild(box); g.appendChild(b); g.appendChild(wrap);
      toolbar.appendChild(g); empty = false;
      continue;
    }
    b.onclick = it.table ? openTableDlg : () => runInsert(it);
    toolbar.appendChild(b);
    empty = false;
  }
  updateToolbarState();
  buildMToolbar();                                  // мобильная панель вставки — тем же языком
}

// --- подсветка «активных» кнопок: их синтаксис уже действует там, где курсор ---
let tbState = [];                     // [{b, it}] — кнопки со считываемым состоянием
function countOcc(s, sub){ let c = 0, i = 0; while((i = s.indexOf(sub, i)) !== -1){ c++; i += sub.length; } return c; }
function updateToolbarState(){
  if(!tbState.length) return;
  const v = src.value, pos = src.selectionStart;
  const ls = v.lastIndexOf('\n', pos - 1) + 1;
  let le = v.indexOf('\n', pos); if(le === -1) le = v.length;
  const line = v.slice(ls, le);       // строчные маркеры читаем по текущей строке
  const before = v.slice(ls, pos);    // инлайн-обёртки — по числу маркеров до курсора
  let inBlock = false;                // строка внутри /* … */? — прогон, как в парсере
  for(const l of v.slice(0, ls).split('\n')){
    const tl = l.trim();
    if(!inBlock && /^\/\*/.test(tl)) inBlock = true;
    else if(inBlock && /^\*\/$/.test(tl)) inBlock = false;
  }
  for(const { b, it } of tbState){
    let on = false;
    if(it.hideBlock) on = inBlock;
    else if(it.wrap === '*')          // курсив: «одиночные» звёзды, пары жирного не в счёт
      on = (countOcc(before, '*') - 2 * countOcc(before, '**')) % 2 === 1;
    else if(it.wrap) on = countOcc(before, it.wrap) % 2 === 1;
    else if(it.on)   on = it.on.test(line);
    b.classList.toggle('active', on);
  }
}
// Тач: открытое подменю тулбара закрывается тапом мимо него
document.addEventListener('click', e => {
  if(e.target.closest && e.target.closest('.tb-group')) return;
  document.querySelectorAll('.tb-group.open').forEach(g => g.classList.remove('open'));
});
function buildCheat(){
  cheatTable.innerHTML = buildSyntax().map(it =>
    it.head
      ? `<tr class="cheat-group"><td colspan="2">${escapeHtml(it.head)}</td></tr>`
      : `<tr><td class="k">${escapeHtml(it.w)}</td><td class="v">${escapeHtml(it.g)}</td></tr>`
  ).join('');
}
// --- вставка из тулбара: уважает выделение, ничего не затирает ---
// Четыре режима кнопок (поле записи buildSyntax):
//  wrap  — инлайн-обёртка (**…**): оборачивает выделение, повторный клик снимает,
//          без выделения вставляет заготовку с выделенным заполнителем;
//  line  — префикс строки (#, -, 1., [ ], >, !, //): ставится в начало всех строк
//          выделения, маркер того же класса заменяется, повторный клик снимает;
//  block — вставка «со своей строки» (---, таблица, Итого, [имя]=): текст не трогаем;
//  ins   — инлайн-токен ([date], = грн, 2*3=): вставка в конец выделения.

// Замена диапазона [a,b) на text. execCommand('insertText') кладёт правку в стек
// отмены <textarea> (Cmd/Ctrl+Z работает), событие input сделает persist+paint.
function replaceRange(a, b, text){
  src.focus();
  src.setSelectionRange(a, b);
  if(document.execCommand && document.execCommand('insertText', false, text)) return;
  // фолбэк (если execCommand недоступен): прямая правка, но без истории отмены
  src.value = src.value.slice(0, a) + text + src.value.slice(b);
  src.setSelectionRange(a + text.length, a + text.length);
  persist(); paint();
}
// После вставки: sel — выделить последнее вхождение подстроки (заполнитель,
// который сразу перепечатывается), caret — поставить курсор перед подстрокой.
function placeCursor(at, ins, sel, caret){
  if(sel){ const k = ins.lastIndexOf(sel); if(k >= 0) return src.setSelectionRange(at + k, at + k + sel.length); }
  if(caret){ const k = ins.lastIndexOf(caret); if(k >= 0) src.setSelectionRange(at + k, at + k); }
}

function insertToken(ins, sel){
  const pos = src.selectionEnd;                   // выделение не затираем — встаём за ним
  replaceRange(pos, pos, ins);
  placeCursor(pos, ins, sel);
}

function wrapSelection(mark, ph){
  const a = src.selectionStart, b = src.selectionEnd, v = src.value, L = mark.length;
  if(a === b){                                    // нет выделения — заготовка, заполнитель выделен
    replaceRange(a, a, mark + ph + mark);
    src.setSelectionRange(a + L, a + L + ph.length);
    return;
  }
  const sel = v.slice(a, b);
  // повторное нажатие снимает обёртку: маркеры внутри выделения…
  if(sel.length >= 2*L && sel.startsWith(mark) && sel.endsWith(mark)){
    replaceRange(a, b, sel.slice(L, sel.length - L));
    src.setSelectionRange(a, b - 2*L);
    return;
  }
  // …или вплотную вокруг него (проверка соседa — чтобы * не «съедал» половину **)
  if(v.slice(Math.max(0, a - L), a) === mark && v.substr(b, L) === mark
     && v[a - L - 1] !== mark[0] && v[b + L] !== mark[0]){
    replaceRange(a - L, b + L, sel);
    src.setSelectionRange(a - L, b - L);
    return;
  }
  replaceRange(a, b, mark + sel + mark);
  src.setSelectionRange(a + L, b + L);            // выделение остаётся на тексте
}

// Классы строчных маркеров: маркер того же класса заменяется новым (- → 1., # → ##)
const LINE_CLS = {
  head:    /^#{1,3}\s+/,
  list:    /^(?:[-*]\s+|\d+\.\s+|\[[ xX]\]\s+)/,
  callout: /^!{1,2}\s+/,
  hide:    /^\/\/\s*/,
  quote:   /^>\s?/,
};
function prefixLines(prefix, clsName){
  const cls = LINE_CLS[clsName], v = src.value;
  const selA = src.selectionStart, selB = src.selectionEnd;
  const ls = v.lastIndexOf('\n', selA - 1) + 1;                  // начало первой строки
  let le = v.indexOf('\n', selB); if(le === -1) le = v.length;   // конец последней
  const lines = v.slice(ls, le).split('\n');
  const numbered = /^\d+\.\s$/.test(prefix);                     // «1. » — нумеруем по порядку
  const hasP = l => numbered ? /^\d+\.\s/.test(l) : l.startsWith(prefix);
  const body = lines.filter(l => l.trim() !== '');
  let n = 1, out;
  if(body.length && body.every(hasP)){                           // все уже с маркером — снять
    out = lines.map(l => hasP(l) ? l.replace(numbered ? /^\d+\.\s/ : prefix, '') : l);
  }else{
    out = lines.map(l => {
      if(l.trim() === '' && lines.length > 1) return l;          // пустые внутри — пропускаем
      const stripped = cls ? l.replace(cls, '') : l;
      return (numbered ? `${n++}. ` : prefix) + stripped;
    });
  }
  const text = out.join('\n');
  replaceRange(ls, le, text);
  if(selA === selB){                                             // курсор — сдвиг на дельту строки
    const p = Math.max(ls, selA + out[0].length - lines[0].length);
    src.setSelectionRange(p, p);
  }else src.setSelectionRange(ls, ls + text.length);             // строки остаются выделенными
}

function insertBlock(text, sel, caret){
  const v = src.value, pos = src.selectionEnd;
  const ls = v.lastIndexOf('\n', pos - 1) + 1;
  let le = v.indexOf('\n', pos); if(le === -1) le = v.length;
  const lineEmpty = v.slice(ls, le).trim() === '';
  const at = lineEmpty ? pos : le;                // строка занята — блок со следующей строки
  const ins = lineEmpty ? text : '\n' + text;
  replaceRange(at, at, ins);
  placeCursor(at, ins, sel, caret);
}

// Скрыть блок: выделенные строки оборачиваются в /* … */ целиком.
// Повторное нажатие — тоггл, как у жирного: если курсор/выделение внутри блока
// (или на его маркерах), маркеры снимаются, текст остаётся.
function wrapHiddenBlock(){
  const v = src.value, selA = src.selectionStart, selB = src.selectionEnd;
  const ls = v.lastIndexOf('\n', selA - 1) + 1;
  let le = v.indexOf('\n', selB); if(le === -1) le = v.length;
  // документ построчно со смещениями: {s,e} — границы, t — trim-текст
  const lines = [];
  for(let p = 0;;){
    let q = v.indexOf('\n', p); if(q === -1) q = v.length;
    lines.push({ s:p, e:q, t:v.slice(p, q).trim() });
    if(q === v.length) break;
    p = q + 1;
  }
  const i1 = lines.findIndex(l => l.s === ls);
  const i2 = lines.findIndex(l => l.e === le);
  // блок /* … */, пересекающийся с выделением (маркеры считаются его частью)
  let openIdx = -1, encO = -1, encC = -1;
  for(let j = 0; j < lines.length; j++){
    if(openIdx === -1 && /^\/\*/.test(lines[j].t)) openIdx = j;
    else if(openIdx !== -1 && /^\*\/$/.test(lines[j].t)){
      if(openIdx <= i2 && j >= i1){ encO = openIdx; encC = j; break; }
      openIdx = -1;
    }
  }
  if(encO === -1 && openIdx !== -1 && openIdx <= i2){ encO = openIdx; encC = -1; } // незакрытый блок
  if(encO !== -1){                                   // уже скрыто — снимаем маркеры
    const till = encC === -1 ? lines.length : encC;
    const text = lines.slice(encO + 1, till).map(l => v.slice(l.s, l.e)).join('\n');
    const to = encC === -1 ? v.length : lines[encC].e;
    replaceRange(lines[encO].s, to, text);
    src.setSelectionRange(lines[encO].s, lines[encO].s + text.length);
    return;
  }
  if(selA === selB) return insertBlock('/*\n\n*/\n', null, '\n*/');
  const text = '/*\n' + v.slice(ls, le) + '\n*/';
  replaceRange(ls, le, text);
  src.setSelectionRange(ls, ls + text.length);
}

// Единая точка запуска кнопки/пункта подменю (payload — вставка пункта подменю)
function runInsert(it, payload){
  if(it.hideBlock)   wrapHiddenBlock();
  else if(it.wrap)   wrapSelection(it.wrap, it.ph || '');
  else if(it.line)   prefixLines(payload ?? it.line, it.cls);
  else if(it.block)  insertBlock(payload ?? it.block, it.sel, it.caret);
  else               insertToken(payload ?? it.ins, it.sel);
  updateToolbarState();
}

// --- дата: [date] / [date:time] заменяются в самом тексте (фиксируются) ---
function dateStr(withTime){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const base = `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()}${LOCALE.yearSuffix}`;
  return withTime ? `${base}. ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}
let expandingDate = false;
// Если пользователь только что дописал токен [date]/[date:time] (курсор сразу за «]»),
// заменяем его на текущую дату прямо в тексте — так дата замораживается и не
// «перегенерируется» при следующем открытии. execCommand сохраняет историю отмены.
function expandDateAtCursor(){
  if(expandingDate) return;
  const pos = src.selectionStart;
  if(pos !== src.selectionEnd) return;
  const m = src.value.slice(0, pos).match(/\[date:time\]$|\[date\]$/i);
  if(!m) return;
  const repl = /:time/i.test(m[0]) ? dateStr(true) : dateStr(false);
  const start = pos - m[0].length;
  expandingDate = true;
  src.setSelectionRange(start, pos);
  if(!(document.execCommand && document.execCommand('insertText', false, repl))){
    src.value = src.value.slice(0, start) + repl + src.value.slice(pos);
    src.setSelectionRange(start + repl.length, start + repl.length);
  }
  expandingDate = false;
}

// --- генерация таблицы по размеру ---
function openTableDlg(){ tableDlg.hidden = false; tblCols.focus(); tblCols.select(); }
function closeTableDlg(){ tableDlg.hidden = true; symTableCtx = null; src.focus(); }
function makeTable(cols, rows){
  const clamp = (v,lo,hi)=> Math.max(lo, Math.min(hi, v|0));
  cols = clamp(cols,1,12); rows = clamp(rows,1,50);
  const header = '| ' + Array.from({length:cols},(_,i)=>`${t('colHeader')} ${i+1}`).join(' | ') + ' |';
  const sep    = '|' + Array.from({length:cols},()=>'---').join('|') + '|';
  const data   = Array.from({length:Math.max(0,rows-1)},
                   ()=> '| ' + Array.from({length:cols},()=>'  ').join(' | ') + ' |');
  return [header, sep, ...data].join('\n') + '\n';
}
function createTable(){
  const text = makeTable(+tblCols.value, +tblRows.value);
  const symCtx = symTableCtx; symTableCtx = null;      // из slash-меню симбиоза (захват до закрытия)
  closeTableDlg();
  if(symCtx){ symApplyInsert(symCtx, slashInsertSpec({ table:true }, text)); return; }
  insertBlock(text);
}

// ── Экспорт «Отдать клиенту» (Э1.2 + Э1.4) ──────────────────────────────────
// Санитайз — В ДВИЖКЕ (render mode:'export'): формулы, объявления переменных и
// скрытые строки/блоки в html не попадают по построению, не пост-обработкой.
// Файл самодостаточен: стили инлайном, печать/PDF — кнопкой window.print().

// Быстрый строковый хеш (djb2) — штамп «#hash» в футере документа. Не крипта:
// подписанный штамп (Ed25519) появится отдельной Rust-командой (Э1.3).
function shortHash(s){
  let h = 5381;
  for(let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Добавка к рендер-стилям (css/render.css + money.css) для автономной страницы:
// центрируем «лист», плавающая
// кнопка печати, чистые поля при печати. Тема — всегда светлая (документ).
const EXPORT_CSS = `
body.export{overflow:auto;background:#eef0f4;}
body.export .rendered{display:block;max-width:820px;margin:28px auto 0;min-height:auto;
  box-shadow:0 2px 26px rgba(15,19,27,.10);border-radius:12px;}
body.export .r-check{cursor:default;pointer-events:none;}
.exp-foot{max-width:820px;margin:12px auto 90px;padding:0 10px;display:flex;
  justify-content:space-between;gap:12px;flex-wrap:wrap;
  color:#8b93a1;font-size:12px;font-family:ui-sans-serif,system-ui,sans-serif;}
.exp-foot b{color:#5b6577;}
.exp-print{position:fixed;right:20px;bottom:20px;padding:11px 18px;border:0;border-radius:10px;
  background:#2f6df0;color:#fff;font-size:14px;font-weight:700;cursor:pointer;
  font-family:ui-sans-serif,system-ui,sans-serif;box-shadow:0 6px 20px rgba(47,109,240,.35);}
.exp-actions{max-width:820px;margin:18px auto 0;padding:0 10px;display:flex;gap:10px;
  flex-wrap:wrap;font-family:ui-sans-serif,system-ui,sans-serif;}
.exp-actions a{flex:1;min-width:220px;text-align:center;padding:14px 18px;border-radius:12px;
  font-size:15px;font-weight:800;text-decoration:none;color:#fff;}
.exp-accept{background:#28a76a;box-shadow:0 6px 18px rgba(40,167,106,.30);}
.exp-pay{background:#2f6df0;box-shadow:0 6px 18px rgba(47,109,240,.30);}
@media print{
  .exp-print,.exp-actions{display:none;}
  body.export{background:#fff;}
  body.export .rendered{box-shadow:none;border-radius:0;max-width:none;margin:0;padding:0;}
  .exp-foot{margin:10px 0 0;}
}`;

async function exportNote(){
  const n = current(); if(!n) return;
  const text = src.value;
  const { html, stats } = render(text, { mode: 'export' });   // санитайз по построению
  paint();  // render() с export-режимом сбросил внутренний флаг общей паинт-цепочки
  const title = titleFrom(text);
  const hash = shortHash(text);
  const C = LOCALE.currency;
  const nf2 = v => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  // Денежная петля (Э1.3): [оплата]/[депозит]/[действительна до]/[email] → кнопки
  const pay = stats.pay || {};
  const base = stats.declared != null ? stats.declared : stats.total;
  // депозит ≤ 1 — доля от итога («30%» → 0.3), > 1 — фикс-сумма
  const depositAmt = pay.deposit ? (pay.deposit <= 1 ? Math.round(base * pay.deposit) : pay.deposit) : null;
  const depositTxt = depositAmt ? `${nf2(depositAmt)} ${C}` : null;
  const stamp = `${dateStr(true)} · #${hash}`
    + (pay.validUntil ? ` · ${t('validLabel')} ${escapeHtml(pay.validUntil)}` : '');

  // «Принять» v1 (офлайн-lite): предзаполненный mailto, привязанный к #hash.
  // Без [email] откроется композер без адресата — клиент подставит сам.
  const subj = encodeURIComponent(t('acceptSubj', { t: title, h: hash }));
  const body = encodeURIComponent(
    t('acceptBody', { t: title, d: dateStr(true), h: hash })
    + (depositTxt ? `\n${t('acceptDeposit', { x: depositTxt })}` : ''));
  const mailto = `mailto:${pay.email || ''}?subject=${subj}&body=${body}`;
  const acceptLabel = depositTxt ? t('acceptBtnDep', { x: depositTxt }) : t('acceptBtn');
  const actions = `<div class="exp-actions">
  <a class="exp-accept" href="${mailto}">${acceptLabel}</a>
  ${pay.url ? `<a class="exp-pay" href="${escapeHtml(pay.url)}" target="_blank" rel="noopener">${t('payBtn')}${depositTxt ? ` · ${depositTxt}` : ''}</a>` : ''}
</div>`;

  // Инлайним в клиентский .html только CSS, влияющий на РЕНДЕР сметы: токены,
  // база, рендер, деньги. Хром (layout/components/editor/responsive) в экспорт
  // не нужен. Эти файлы намеренно без color-mix — у клиента может быть старый браузер.
  let css = '';
  try{
    const parts = await Promise.all(
      ['tokens', 'base', 'render', 'money'].map(f =>
        fetch(`css/${f}.css`).then(r => r.text()).catch(() => '')));
    css = parts.join('\n');
  }catch{}
  // выбранный шрифт/размер документа уезжает вместе со сметой
  const fontCss = `:root{--doc-font:${(DOC_FONTS[docFont]||DOC_FONTS.sans).stack};--doc-size:${docSize}px;}`;
  const page = `<!DOCTYPE html>
<html lang="${lang}" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${css}\n${EXPORT_CSS}\n${fontCss}</style>
</head>
<body class="export">
<article class="rendered doc-mode">${html}</article>
${actions}
<footer class="exp-foot">
  <span>${escapeHtml(title)} · ${stamp}</span>
  <span>${t('exportedWith')} <b>Σ Notatnyk</b></span>
</footer>
<button class="exp-print" onclick="window.print()">${t('printHint')}</button>
</body>
</html>`;
  let path;
  try{
    path = await saveDialog({
      defaultPath: `${title.replace(/[\\/:*?"<>|]/g, '_')}.html`,
      title: t('exportTitle'),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
  }catch{ return; }
  if(!path) return;
  try{ await writeTextFile(path, page, {}); }
  catch(e){ alert(`${t('exportErr')}: ${e}`); }
}

// Тумблер «Документ» — чисто визуальный пресет рендера, состояние в localStorage
const DOCMODE_KEY = 'notatnyk.docmode';
function applyDocMode(on){
  out.classList.toggle('doc-mode', on);
  $('#docBtn').classList.toggle('active', on);
  try{ localStorage.setItem(DOCMODE_KEY, on ? '1' : ''); }catch{}
  collectAnchors();                     // геометрия блоков изменилась — якоря заново
}

// ── Шрифт документа (меню «Aa») ─────────────────────────────────────────────
// Системные кросс-ОС стеки: без бандлинга файлов (лёгкость), у всех — полная
// кириллица и РОВНЫЕ (lining) цифры. Georgia исключена сознательно: её
// минускульные цифры прыгают ниже строки — в смете из цифр это выглядит грязно.
const DOC_FONTS = {
  // ── без засечек ──
  sans: {   // дефолт: родной шрифт каждой ОС — самый «нативный» вид для клиента
    name:'fontSans', note:'fontSansNote',
    stack:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue","Noto Sans",Arial,sans-serif' },
  grotesk: { // прямой нейтральный гротеск: Helvetica — классика деловой Америки,
             // Arial (win), Liberation Sans (linux, метрический клон Arial).
             // Шрифт №1 инвойсов США: QuickBooks поддерживает ровно его.
    name:'fontGrotesk', note:'fontGroteskNote',
    stack:'"Helvetica Neue",Helvetica,Arial,"Liberation Sans",Roboto,"Noto Sans",sans-serif' },
  office: { // дефолт Word: Aptos (2023+) / Calibri (2007–2023) — «большинство
            // офисов». Carlito — свободный метрический клон Calibri (linux).
            // На mac без MS Office честно падает в Segoe/системный.
    name:'fontOffice', note:'fontOfficeNote',
    stack:'Aptos,Calibri,Carlito,"Segoe UI","Helvetica Neue",Arial,sans-serif' },
  friendly: { // Trebuchet MS: тёплый гуманист, Win+mac с полной кириллицей —
              // для «дружелюбных» сфер (клининг, газоны, переезды)
    name:'fontFriendly', note:'fontFriendlyNote',
    stack:'"Trebuchet MS","Segoe UI",Verdana,"DejaVu Sans",sans-serif' },
  // ── с засечками ──
  serif: {  // книжный документ: Charter (mac) / Cambria,Sitka (win) / PT+Noto (linux)
    name:'fontSerif', note:'fontSerifNote',
    stack:'Charter,"Bitstream Charter",Cambria,"Sitka Text","PT Serif","Noto Serif","Times New Roman",serif' },
  times: {  // стандарт деловых/юридических документов США, есть буквально везде
    name:'fontTimes', note:'fontTimesNote',
    stack:'"Times New Roman",Times,"Liberation Serif","Nimbus Roman","Noto Serif",serif' },
  // ── экранная читабельность ──
  legible: { // Verdana: рисован для экрана, максимальный x-height, есть везде кроме Android
    name:'fontLegible', note:'fontLegibleNote',
    stack:'Verdana,"DejaVu Sans",Tahoma,Geneva,sans-serif' },
};
let docFont = 'sans';
let docSize = 15;
function applyDocFont(){
  const f = DOC_FONTS[docFont] || DOC_FONTS.sans;
  document.documentElement.style.setProperty('--doc-font', f.stack);
  document.documentElement.style.setProperty('--doc-size', docSize + 'px');
  // активные состояния в диалоге
  document.querySelectorAll('.font-card').forEach(c =>
    c.classList.toggle('active', c.dataset.font === docFont));
  document.querySelectorAll('#fontSizes .seg-btn').forEach(b =>
    b.classList.toggle('active', parseFloat(b.dataset.size) === docSize));
}
// Карточки шрифтов: каждая рисуется СВОИМ стеком — предпросмотр вместо слов
function buildFontCards(){
  const box = $('#fontCards');
  box.innerHTML = '';
  for(const key in DOC_FONTS){
    const f = DOC_FONTS[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'font-card';
    b.dataset.font = key;
    b.style.fontFamily = f.stack;
    b.innerHTML = `<span class="fc-name">${escapeHtml(t(f.name))}</span>`
      + `<span class="fc-note">${escapeHtml(t(f.note))}</span>`
      + `<span class="fc-sample">${escapeHtml(t('fontSample'))}</span>`;
    b.onclick = ()=>{
      docFont = key;
      applyDocFont(); saveConfig();
      if(!out.classList.contains('doc-mode')) applyDocMode(true); // показать эффект сразу
    };
    box.appendChild(b);
  }
  applyDocFont();
}
function openDocDlg(){
  $('#docDlg').hidden = false;
  if(!out.classList.contains('doc-mode')) applyDocMode(true);   // предпросмотр — на живом рендере
}

// --- настройки языка / ключевых слов ---
function fillLocaleForm(v){
  locCurrency.value = v.currency; locTotal.value = v.total;
  locDone.value = v.done; locUnit.value = v.unit; locYear.value = v.yearSuffix;
  locPositions.value = v.positions;
}
function openLocaleDlg(){ fillLocaleForm(LOCALE); localeDlg.hidden = false; locCurrency.focus(); }
function closeLocaleDlg(){ localeDlg.hidden = true; src.focus(); }
// Кнопка языка: применяем весь язык (UI + ключевые слова), сбрасываем ручные правки.
function pickLang(code){
  kwOverrides = {};
  applyLang(code);
  fillLocaleForm(LOCALE);
  saveConfig();
}
// Сохранить ручные правки ключевых слов поверх текущего языка.
function saveLocale(){
  kwOverrides = {
    currency:  locCurrency.value.trim()  || T.kw.currency,
    total:     locTotal.value.trim()     || T.kw.total,
    done:      locDone.value.trim()      || T.kw.done,
    unit:      locUnit.value.trim()      || T.kw.unit,
    yearSuffix: locYear.value,               // может быть пустым
    positions: locPositions.value.trim() || T.kw.positions,
    section:   T.kw.section,
  };
  setLocale(kwOverrides);
  saveConfig();
  closeLocaleDlg();
  buildToolbar(); buildCheat();
  paint();
}

// --- выбор папки хранения ---
async function chooseFolder(){
  let path;
  try{ path = await pickFolder(); }catch{ return; }
  if(!path) return;
  loc = customLoc(path);
  await saveConfig();
  query = ''; search.value = '';
  await loadAll(false);            // в выбранную папку пример не подсеваем
  select(currentId);
  reflectFolder();
}
function reflectFolder(){
  $('#folderBtn').title = loc.custom ? loc.dir : t('folderDefault');
}

// ── Slash-меню «/»: быстрая вставка наших паттернов в «Исходнике» ────────────
// Триггер: «/» в НАЧАЛЕ строки (после пробелов) → всплывает меню, фильтруется по
// тексту после «/». ↑/↓ — навигация, Enter/Tab — вставить, Esc — закрыть. Так «/»
// внутри строки (грн/шт, 18400/1200, https://) меню НЕ трогает. Работает в ОБЕИХ
// панелях — «Исходник» (textarea) и «Симбиоз» (contenteditable); пункты — общие
// декларативные спеки, вставка примитивами тулбара (src) либо построчно (sym).
function slashItems(){
  const cur = LOCALE.currency, unit = LOCALE.unit, tot = LOCALE.total, ex = t('exVar');
  // Одна из вставок на пункт: ins (токен) | block | prefix+cls | table | hideBlock.
  // sel — заполнитель (выделяется), caret — место каретки. Деньги первыми — это суть.
  return [
    { label:`= 0 ${cur}`,               desc:t('sPrice'),   keys:`price cena цена сумма = : ${cur}`,  ins:`= 0 ${cur}`, sel:'0' },
    { label:`${tot}:`,                  desc:t('sTotal'),   keys:`total итого разом подытог`,          block:`${tot}  ${cur}`, caret:` ${cur}` },
    { label:`[4000 ${unit}]`,           desc:t('sQtyUnit',{total:tot}), keys:`unit шт цена за единицу тираж`, ins:`[4000 ${unit}]`, sel:'4000' },
    { label:'2*3=',                     desc:t('sCalc'),    keys:`calc калькулятор формула math расчёт`, ins:'2*3=', sel:'2*3' },
    { label:`[${ex}] =`,                desc:t('sVar'),     keys:`variable переменная var`,            block:`[${ex}] = `, sel:ex },
    { label:`[${LOCALE.depositVar}] = 30%`, desc:t('sDeposit',{total:tot}), keys:`deposit депозит аванс`, block:`[${LOCALE.depositVar}] = 30%`, sel:'30' },
    { label:`[${LOCALE.payVar}] =`,     desc:t('sPayVar'),  keys:`pay оплата ссылка url платёж`,       block:`[${LOCALE.payVar}] = ` },
    { label:`[${LOCALE.validVar}] =`,   desc:t('sValid'),   keys:`valid действительна срок дата`,      block:`[${LOCALE.validVar}] = ` },
    { label:`[${LOCALE.emailVar}] =`,   desc:t('sEmailVar'),keys:`email почта mail`,                   block:`[${LOCALE.emailVar}] = ` },
    { label:'##',                       desc:t('sHead'),    keys:`heading заголовок h1 h2 h3`,         prefix:'## ', cls:'head' },
    { label:'[ ]',                      desc:t('sCheck',{done:LOCALE.done}), keys:`check чекбокс todo задача`, prefix:'[ ] ', cls:'list' },
    { label:'-',                        desc:t('sList'),    keys:`list список маркер bullet`,          prefix:'- ', cls:'list' },
    { label:'1.',                       desc:t('sNum'),     keys:`number нумерация ordered`,           prefix:'1. ', cls:'list' },
    { label:'!',                        desc:t('sCallout'), keys:`callout выноска warning note важно`, prefix:'! ', cls:'callout' },
    { label:'| A | B |',                desc:t('sTable'),   keys:`table таблица`,                      table:true },
    { label:`> @${LOCALE.client}`,      desc:t('sQuote'),   keys:`quote цитата клиент client`,         prefix:'> ', cls:'quote' },
    { label:'//',                       desc:t('sHide'),    keys:`hide скрыть строка internal себестоимость`, prefix:'// ', cls:'hide' },
    { label:'/* */',                    desc:t('sHideBlock'),keys:`hide block скрытый блок`,           hideBlock:true },
    { label:'---',                      desc:t('sHrThin'),  keys:`hr разделитель линия divider`,       block:'---\n' },
    { label:'[date]',                   desc:t('sDate',{date:dateStr(false)}), keys:`date дата`,       ins:'[date]' },
  ];
}
// ── общий UI меню (обе панели) ──────────────────────────────────────────────
let slashEl = null, slashList = [], slashIdx = 0, slashMode = 'src', slashFrom = -1, symTableCtx = null;
function ensureSlashEl(){
  if(slashEl) return;
  slashEl = document.createElement('div');
  slashEl.className = 'slash-menu';
  slashEl.style.display = 'none';
  document.body.appendChild(slashEl);
}
function slashOpen(){ return slashEl && slashEl.style.display !== 'none'; }
function closeSlash(){ if(slashEl) slashEl.style.display = 'none'; slashFrom = -1; }
function filterSlash(query){
  const q = query.trim().toLowerCase(), all = slashItems();
  slashList = q ? all.filter(it => (it.label + ' ' + it.desc + ' ' + it.keys).toLowerCase().includes(q)) : all;
  slashIdx = 0;
}
function renderSlash(){
  if(!slashList.length){ slashEl.innerHTML = `<div class="slash-empty">${escapeHtml(t('slashEmpty'))}</div>`; return; }
  const box = document.createElement('div'); box.className = 'slash-list';
  slashList.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slash-item' + (i === slashIdx ? ' on' : '');
    b.innerHTML = `<span class="slash-key">${escapeHtml(it.label)}</span><span class="slash-desc">${escapeHtml(it.desc)}</span>`;
    b.onmousedown = e => { e.preventDefault(); slashIdx = i; slashChoose(); };
    b.onmousemove = () => { if(slashIdx !== i){ slashIdx = i; paintSlashActive(); } };
    box.appendChild(b);
  });
  slashEl.innerHTML = '';
  slashEl.appendChild(box);
  const on = box.children[slashIdx]; if(on) on.scrollIntoView({ block:'nearest' });
}
function paintSlashActive(){                         // только переключить подсветку, без пересборки
  const items = slashEl.querySelectorAll('.slash-item');
  items.forEach((el, i) => el.classList.toggle('on', i === slashIdx));
  const on = items[slashIdx]; if(on) on.scrollIntoView({ block:'nearest' });
}
function moveSlash(d){
  if(!slashList.length) return;
  slashIdx = (slashIdx + d + slashList.length) % slashList.length;
  paintSlashActive();
}
function slashChoose(){ slashMode === 'sym' ? chooseSlashSym() : chooseSlashSrc(); }

// ── панель «Исходник» (textarea #src) ───────────────────────────────────────
function slashCtx(){                                 // {from, query} или null
  if(src.selectionStart !== src.selectionEnd) return null;
  const pos = src.selectionStart, val = src.value;
  const ls = val.lastIndexOf('\n', pos - 1) + 1;
  const m = val.slice(ls, pos).match(/^(\s*)\/([^\s/]*)$/);   // от начала строки: пробелы + «/» + запрос
  return m ? { from: ls + m[1].length, query: m[2] } : null;
}
function positionSlash(from){
  const cs = getComputedStyle(src);
  const lh = parseFloat(cs.lineHeight) || 20;
  const lineIdx = src.value.slice(0, from).split('\n').length - 1;
  const rect = src.getBoundingClientRect();
  let x = rect.left + (parseFloat(cs.paddingLeft) || 0) - src.scrollLeft + 2;
  let y = rect.top + (parseFloat(cs.paddingTop) || 0) + (lineIdx + 1) * lh - src.scrollTop + 4;
  const mw = slashEl.offsetWidth || 288, mh = slashEl.offsetHeight || 260;
  x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  if(y + mh > window.innerHeight - 8)               // не влезает вниз — показываем над строкой
    y = rect.top + (parseFloat(cs.paddingTop) || 0) + lineIdx * lh - src.scrollTop - mh - 4;
  slashEl.style.left = x + 'px';
  slashEl.style.top = Math.max(8, y) + 'px';
}
function openSlash(query, from){
  slashMode = 'src'; slashFrom = from;
  filterSlash(query); ensureSlashEl(); slashEl.style.display = 'block';
  renderSlash(); positionSlash(from);
}
function updateSlash(){ const c = slashCtx(); c ? openSlash(c.query, c.from) : (slashMode === 'src' && closeSlash()); }
function runSlashSrc(it){                             // вставка в textarea (та же диспетчеризация, что runInsert)
  if(it.table)          openTableDlg();
  else if(it.hideBlock) wrapHiddenBlock();
  else if(it.prefix)    prefixLines(it.prefix, it.cls);
  else if(it.block)     insertBlock(it.block, it.sel, it.caret);
  else                  insertToken(it.ins, it.sel);
}
function chooseSlashSrc(){
  const it = slashList[slashIdx]; if(!it || slashFrom < 0) return;
  const pos = src.selectionStart;
  closeSlash();
  src.focus();
  src.setSelectionRange(slashFrom, pos);            // выделить «/запрос»
  if(!document.execCommand || !document.execCommand('delete')){   // удалить (с отменой)
    src.value = src.value.slice(0, slashFrom) + src.value.slice(pos);
    src.setSelectionRange(slashFrom, slashFrom);
  }
  runSlashSrc(it);
}

// ── панель «Симбиоз» (contenteditable #sym): построчная вставка в исходный текст ─
function slashCtxSym(){                              // {line, wsLen, offset, query} или null
  const c = symCaret(); if(!c) return null;
  const cur = (symReadText().split('\n')[c.line]) ?? '';
  const m = cur.slice(0, c.offset).match(/^(\s*)\/([^\s/]*)$/);
  return m ? { line: c.line, wsLen: m[1].length, offset: c.offset, query: m[2] } : null;
}
function positionSlashSym(){
  ensureSlashEl();
  const s = window.getSelection();
  let rect = s && s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
  if(!rect || (!rect.top && !rect.height)){         // каретка в начале строки даёт пустой rect — берём блок
    const c = symCaret(), block = c && sym.children[c.line];
    if(block) rect = block.getBoundingClientRect();
  }
  if(!rect) return;
  const mw = slashEl.offsetWidth || 288, mh = slashEl.offsetHeight || 260;
  const x = Math.max(8, Math.min(rect.left + 2, window.innerWidth - mw - 8));
  let y = rect.bottom + 4;
  if(y + mh > window.innerHeight - 8) y = rect.top - mh - 4;
  slashEl.style.left = x + 'px';
  slashEl.style.top = Math.max(8, y) + 'px';
}
function openSlashSym(query){
  slashMode = 'sym';
  filterSlash(query); ensureSlashEl(); slashEl.style.display = 'block';
  renderSlash(); positionSlashSym();
}
function updateSlashSym(){ const c = slashCtxSym(); c ? openSlashSym(c.query) : (slashMode === 'sym' && closeSlash()); }
// Выделить (a..b) или поставить каретку (a==b) в блоке симбиоза по символьным смещениям.
function symSetSel(line, a, b){
  const block = sym.children[line]; if(!block) return;
  const nodeAt = off => {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let rem = off, n;
    while((n = w.nextNode())){ const L = (n.nodeValue || '').length; if(rem <= L) return { n, o: rem }; rem -= L; }
    return null;
  };
  const s = window.getSelection(); if(!s) return;
  const A = nodeAt(a), B = nodeAt(b), r = document.createRange();
  if(A) r.setStart(A.n, A.o); else r.selectNodeContents(block);
  if(B) r.setEnd(B.n, B.o);   else r.collapse(false);
  s.removeAllRanges(); s.addRange(r);
}
// Спека вставки: тело + позиция каретки {cl:строка от вставки, off:смещение, sel:длина выделения}.
function slashInsertSpec(it, tableText){
  if(it.prefix)    return { body: it.prefix, cl:0, off: it.prefix.length, sel:0 };
  if(it.hideBlock) return { body: '/*\n\n*/', cl:1, off:0, sel:0 };     // каретка на пустой средней строке
  if(it.table)     return { body: (tableText || '').replace(/\n+$/, ''), cl:0, off:0, sel:0 };
  const body = (it.block != null ? it.block : it.ins || '').replace(/\n+$/, '');
  const mark = it.sel || it.caret;
  if(mark){ const k = body.lastIndexOf(mark); if(k >= 0) return { body, cl:0, off:k, sel: it.sel ? mark.length : 0 }; }
  return { body, cl:0, off: body.length, sel:0 };
}
function symApplyInsert(ctx, spec){
  const lines = symReadText().split('\n');
  const cur = lines[ctx.line] ?? '';
  const head = cur.slice(0, ctx.wsLen), tail = cur.slice(ctx.offset);   // отступ сохраняем, «/запрос» убираем
  const parts = (head + spec.body + tail).split('\n');
  lines.splice(ctx.line, 1, ...parts);
  const text = lines.join('\n');
  src.value = text; persist(); symPaint(text); paint();
  const cLine = ctx.line + spec.cl;
  const cOff = (spec.cl === 0 ? head.length : 0) + spec.off;
  sym.focus();                                       // фокус ДО установки каретки (иначе выделение сбрасывается)
  symSetSel(cLine, cOff, cOff + spec.sel);
}
function chooseSlashSym(){
  const it = slashList[slashIdx]; if(!it){ closeSlash(); return; }
  const ctx = slashCtxSym(); if(!ctx){ closeSlash(); return; }
  closeSlash();
  if(it.table){ symTableCtx = ctx; openTableDlg(); return; }   // размер спросим в диалоге (createTable)
  symApplyInsert(ctx, slashInsertSpec(it));
}

// ── Мобильная панель вставки над клавиатурой ────────────────────────────────
// Показывается на телефоне при фокусе редактора; горизонтальный скролл кнопок-
// паттернов. Вставка — в активную панель (Исходник → примитивы тулбара; Симбиоз →
// построчно). Позиция над клавиатурой держится через visualViewport.
function insertPattern(it){
  if(viewMode !== 'sym'){ src.focus(); runSlashSrc(it); return; }
  const c = symCaret() || { line: 0, offset: 0 };
  if(it.table){ symTableCtx = { line:c.line, wsLen:c.offset, offset:c.offset }; openTableDlg(); return; }
  const at = it.prefix ? 0 : c.offset;             // построчные (##, -, > …) — в начало строки
  symApplyInsert({ line:c.line, wsLen:at, offset:at }, slashInsertSpec(it));
}
function buildMToolbar(){
  const mt = $('#mtoolbar'); if(!mt) return;
  mt.innerHTML = '';
  for(const it of slashItems()){
    if(it.hideBlock) continue;                     // скрытый блок — не для быстрой панели
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mt-btn';
    b.textContent = it.label; b.title = it.desc;
    b.onmousedown = e => e.preventDefault();        // не терять фокус/каретку редактора
    b.onclick = () => insertPattern(it);
    mt.appendChild(b);
  }
}
function placeMToolbar(){                           // держим панель над экранной клавиатурой
  const mt = $('#mtoolbar'); if(!mt) return;
  const vv = window.visualViewport;
  mt.style.bottom = (vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0) + 'px';
}
function setEditing(on){
  const narrow = window.matchMedia('(max-width:640px)').matches;
  document.body.classList.toggle('editing', on && narrow);
  if(on && narrow) placeMToolbar();
}
// ВНИМАНИЕ: подписки на src/sym вынесены НИЖЕ — после `const sym = $('#sym')`,
// иначе обращение к sym здесь падало бы в TDZ и рушило загрузку всего main.js.

// --- events ---
src.addEventListener('input', ()=>{ expandDateAtCursor(); persist(); paint(); });
// slash-меню «/»: детект по вводу; клавиши навигации; репозиция/закрытие
src.addEventListener('input', updateSlash);
src.addEventListener('keydown', e => {
  if(!(slashOpen() && slashMode === 'src')) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); moveSlash(1); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); moveSlash(-1); }
  else if(e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); chooseSlashSrc(); }
  else if(e.key === 'Escape'){ e.preventDefault(); closeSlash(); }
});
src.addEventListener('blur', () => setTimeout(closeSlash, 120));
src.addEventListener('scroll', () => { if(slashOpen()) positionSlash(slashFrom); });
['click','keyup'].forEach(ev => src.addEventListener(ev, () => { if(slashOpen() && !slashCtx()) closeSlash(); }));
// Подсветка активных кнопок тулбара следует за курсором
['keyup','click','focus'].forEach(ev => src.addEventListener(ev, updateToolbarState));
document.addEventListener('selectionchange', () => { if(document.activeElement === src) updateToolbarState(); });
// Привычные хоткеи начертаний — работают с выделением так же, как кнопки
src.addEventListener('keydown', e => {
  if(!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const k = e.key.toLowerCase();
  if(k === 'b'){ e.preventDefault(); wrapSelection('**', t('exBold')); }
  else if(k === 'i'){ e.preventDefault(); wrapSelection('*', t('exItalic')); }
});
search.addEventListener('input', ()=>{ query = search.value; drawList(); });
$('#helpBtn').onclick = ()=>{ cheat.hidden = false; };
$('#cheatClose').onclick = ()=>{ cheat.hidden = true; };
cheat.onclick = (e)=>{ if(e.target === cheat) cheat.hidden = true; };
$('#tblClose').onclick = closeTableDlg;
$('#tblCreate').onclick = createTable;
tableDlg.onclick = (e)=>{ if(e.target === tableDlg) closeTableDlg(); };
tableDlg.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') createTable(); });
$('#settingsBtn').onclick = openLocaleDlg;
$('#locClose').onclick = closeLocaleDlg;
$('#locSave').onclick = saveLocale;
localeDlg.onclick = (e)=>{ if(e.target === localeDlg) closeLocaleDlg(); };
for(const b of localeDlg.querySelectorAll('[data-lang]'))
  b.onclick = ()=> pickLang(b.dataset.lang);
$('#folderBtn').onclick = chooseFolder;
$('#newBtn').onclick = newNote;
$('#delBtn').onclick = deleteCurrent;
$('#docBtn').onclick = ()=> applyDocMode(!out.classList.contains('doc-mode'));
$('#exportBtn').onclick = exportNote;
$('#fontBtn').onclick = openDocDlg;
$('#outlineBtn').onclick = e => { e.stopPropagation(); toggleOutline(); };
// оглавление — закрыть по клику вне попапа и по Esc
document.addEventListener('click', e => {
  if(outlineOpen() && !outlineEl.contains(e.target) && !e.target.closest('#outlineBtn')) closeOutline();
});
document.addEventListener('keydown', e => { if(e.key === 'Escape' && outlineOpen()) closeOutline(); });
// Командная палитра: Cmd/Ctrl+K из любого места
document.addEventListener('keydown', e => {
  if((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'){
    e.preventDefault(); togglePalette();
  }
});
$('#foldAllBtn').onclick = ()=>{
  const keys = allSectionKeys(renderTree);
  const anyCollapsed = keys.some(k => currentFolds.has(k));
  currentFolds = new Set(anyCollapsed ? [] : keys);
  saveFolds(); drawRender(); collectAnchors(); updateFoldAllBtn();
};
$('#docDlgClose').onclick = ()=>{ $('#docDlg').hidden = true; };
$('#docDlg').onclick = (e)=>{ if(e.target === $('#docDlg')) $('#docDlg').hidden = true; };
document.querySelectorAll('#fontSizes .seg-btn').forEach(b => b.onclick = ()=>{
  docSize = parseFloat(b.dataset.size);
  applyDocFont(); saveConfig();
});

// --- перетаскиваемый разделитель редактора/рендера ---
(function initSplitter(){
  const divider = $('#divider'), editor = $('#editorpane');
  const KEY = 'notatnyk.split';
  const isMobile = () => window.matchMedia('(max-width:640px)').matches;
  const apply = f => { editor.style.flex = `0 0 ${(f*100).toFixed(2)}%`; };
  // На узком экране редактор — на весь экран: снимаем инлайновый flex десктоп-
  // разделителя (иначе в колоночной раскладке он становится ограничением ВЫСОТЫ ~50%).
  const saved = parseFloat(localStorage.getItem(KEY));
  const mq = window.matchMedia('(max-width:640px)');
  const syncSplit = () => {
    if(mq.matches) editor.style.flex = '';
    else if(saved > 0.15 && saved < 0.85) apply(saved);
  };
  mq.addEventListener('change', syncSplit);
  syncSplit();

  let dragging = false;
  const onMove = e => {
    if(!dragging) return;
    const r = split.getBoundingClientRect();
    let f = (e.clientX - r.left) / r.width;
    f = Math.max(0.2, Math.min(0.8, f));
    apply(f);
    localStorage.setItem(KEY, f.toFixed(3));
  };
  divider.addEventListener('mousedown', e => {
    if(isMobile()) return;
    dragging = true; document.body.classList.add('col-resizing'); e.preventDefault();
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', () => {
    if(!dragging) return;
    dragging = false; document.body.classList.remove('col-resizing');
  });
  // двойной клик по разделителю — сброс к 50/50
  divider.addEventListener('dblclick', () => { editor.style.flex = ''; localStorage.removeItem(KEY); });
})();
// ── Симбиоз-редактор (β): contenteditable с подсветкой исходника (Э3, шаг B) ─
// Правит ту же заметку, что и textarea (источник истины — src.value). Показывает
// подсвеченный ИСХОДНИК (renderSourceLines), не вычисленный рендер, поэтому
// спецсимволы не ломают виджеты (их нет). Инвариант: textContent строки == строка.
const sym = $('#sym');
let symComposing = false;     // IME-композиция (Android/iOS/CJK) — не перерисовываем
let symTimer = null;

// «Сырой» текст из холста: один top-level <div> = одна строка; &nbsp; → пробел.
function symReadText(){
  if(!sym.children.length) return (sym.textContent || '').replace(/ /g, ' ');
  return [...sym.children].map(c => (c.textContent || '').replace(/ /g, ' ')).join('\n');
}
function symPaint(text){ sym.innerHTML = renderSourceLines(text); }

// Курсор: {line — индекс блока, offset — символов до каретки в блоке}.
function symCaret(){
  const s = window.getSelection();
  if(!s || !s.rangeCount) return null;
  const range = s.getRangeAt(0);
  if(!sym.contains(range.startContainer)) return null;
  let block = range.startContainer;
  while(block && block.parentNode !== sym) block = block.parentNode;
  if(!block) return null;
  const line = [...sym.children].indexOf(block);
  if(line < 0) return null;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  return { line, offset: pre.toString().length };
}
function symRestore(info){
  if(!info) return;
  const block = sym.children[info.line];
  if(!block) return;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = info.offset, node; const s = window.getSelection(); if(!s) return;
  while((node = walker.nextNode())){
    const len = (node.nodeValue || '').length;
    if(remaining <= len){
      const r = document.createRange(); r.setStart(node, remaining); r.collapse(true);
      s.removeAllRanges(); s.addRange(r); return;
    }
    remaining -= len;
  }
  const r = document.createRange(); r.selectNodeContents(block); r.collapse(false);
  s.removeAllRanges(); s.addRange(r);
}

// Синхронизация после правки: обновляем модель + рендер справа + Σ; во время
// IME-композиции холст НЕ перерисовываем (иначе теряются символы на Android).
function symSync(){
  const text = symReadText();
  src.value = text;
  persist();
  const caret = symComposing ? null : symCaret();
  paint();                                   // правый рендер + футер Σ — вживую
  if(!symComposing){ symPaint(text); symRestore(caret); }
  if(slashOpen() && slashMode === 'sym') positionSlashSym();   // холст перерисован — репозиция меню
}

// синхроскролл: симбиоз ведёт → рендер следует (гейт activePane, без обратной петли)
sym.addEventListener('mouseenter', ()=> activePane = 'sym');
sym.addEventListener('touchstart', ()=> activePane = 'sym', { passive:true });
sym.addEventListener('focus', ()=> activePane = 'sym');
sym.addEventListener('scroll', ()=>{ if(activePane === 'sym') scrollPaneToLine(out, topLineOf(sym)); });
sym.addEventListener('input', ()=>{ clearTimeout(symTimer); symTimer = setTimeout(symSync, 250); });
// slash-меню «/» в симбиозе: детект сразу по вводу; навигация клавишами; закрытие
sym.addEventListener('input', updateSlashSym);
sym.addEventListener('keydown', e => {
  if(!(slashOpen() && slashMode === 'sym')) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); moveSlash(1); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); moveSlash(-1); }
  else if(e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); chooseSlashSym(); }
  else if(e.key === 'Escape'){ e.preventDefault(); closeSlash(); }
});
sym.addEventListener('blur', ()=>{ clearTimeout(symTimer); symSync(); });
sym.addEventListener('blur', ()=> setTimeout(()=>{ if(slashMode === 'sym') closeSlash(); }, 120));
sym.addEventListener('compositionstart', ()=>{ symComposing = true; });
sym.addEventListener('compositionend', ()=>{ symComposing = false; clearTimeout(symTimer); symSync(); });
// Мобильная панель вставки: показ при фокусе редактора (src/sym), позиция над клавиатурой.
// Здесь — уже ПОСЛЕ `const sym`, поэтому обращение к sym безопасно (без TDZ).
[src, sym].forEach(el => {
  el.addEventListener('focus', () => setEditing(true));
  el.addEventListener('blur', () => setTimeout(() => {   // тап по кнопке панели фокус не снимает
    if(document.activeElement !== src && document.activeElement !== sym) setEditing(false);
  }, 150));
});
if(window.visualViewport){
  const onVV = () => { if(document.body.classList.contains('editing')) placeMToolbar(); };
  window.visualViewport.addEventListener('resize', onVV);
  window.visualViewport.addEventListener('scroll', onVV);
}
// Вставка — только текст (без чужого HTML)
sym.addEventListener('paste', e=>{
  e.preventDefault();
  const tt = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
  document.execCommand('insertText', false, tt);
});
// Клик по чек-боксу правит [ ]/[x] в тексте
sym.addEventListener('mousedown', e=>{
  const box = e.target.closest && e.target.closest('.box[data-toggle]');
  if(!box) return;
  e.preventDefault();
  const i = +box.dataset.toggle;
  const lines = symReadText().split('\n');
  if(lines[i] != null){
    lines[i] = lines[i].replace(/\[([ xX])\]/, (m,c)=> c.toLowerCase()==='x' ? '[ ]' : '[x]');
    src.value = lines.join('\n');
    persist(); symPaint(src.value); paint();
  }
});

// ── Переключатель вида: Источник ↔ Симбиоз ↔ Рендер ─────────────────────────
// Всё показ/скрытие панелей — через data-view на #split (CSS). Десктоп: источник
// и симбиоз показывают выбранный редактор СЛЕВА + рендер справа; «Рендер» — только
// рендер. Телефон (@media ≤640): показывается ТОЛЬКО одна панель, без разделения
// экрана (симбиоз по умолчанию), см. css/responsive.css.
let viewMode = 'source';                      // source | sym | view
// Только применить панель (без сохранения и без коммита симбиоза) — общий низ
// для setView и select() (при выборе заметки режим уже загружен, коммитить нечего).
function applyView(mode){
  viewMode = mode;
  split.dataset.view = mode;                   // CSS решает, что видно
  const seg = { source:'segSplit', sym:'segSym', view:'segView' };
  for(const m in seg) $('#'+seg[m]).classList.toggle('active', m === mode);
}
// Пользователь переключил панель: коммитим правки симбиоза, применяем, ЗАПОМИНАЕМ per-note.
function setView(mode){
  closeSlash();                                  // при смене панели slash-меню не тащим
  // уходя из симбиоза — забрать свежий текст (без ожидания дебаунса)
  if(viewMode === 'sym' && mode !== 'sym'){ clearTimeout(symTimer); src.value = symReadText(); persist(); }
  applyView(mode);
  saveView();                                    // per-note память режима просмотра
  if(mode === 'sym'){ symPaint(src.value); sym.focus(); }
  paint();
}
$('#segSplit').onclick = ()=> setView('source');
$('#segSym').onclick   = ()=> setView('sym');
$('#segView').onclick  = ()=> setView('view');
function toggleTheme(){
  const el = document.documentElement;
  el.setAttribute('data-theme', el.getAttribute('data-theme')==='dark'?'light':'dark');
}
$('#themeBtn').onclick = toggleTheme;

// ── Мобильный drawer: гамбургер открывает список заметок, затемнение закрывает ─
function setDrawer(open){
  sidebarEl.classList.toggle('open', open);
  const scrim = $('#scrim'); if(scrim) scrim.hidden = !open;
}
$('#menuBtn').onclick = ()=> setDrawer(!sidebarEl.classList.contains('open'));
$('#scrim').onclick = ()=> setDrawer(false);
document.addEventListener('keydown', e => { if(e.key === 'Escape' && sidebarEl.classList.contains('open')) setDrawer(false); });

// ── Frameless-титлбар ───────────────────────────────────────────────────────
// Перетаскивание окна — через data-tauri-drag-region (шапка сайдбара + тулбар).
// macOS: нативные «светофоры» (titleBarStyle: Overlay) — свои кнопки НЕ показываем.
// Windows: окно без рамки (decorations:false) — рисуем min/max/close сами.
(function initWindowChrome(){
  const ua = navigator.userAgent || '';
  // Мобильные — раньше desktop-mac: iOS UA содержит «Mac OS X», иначе iPhone принялся бы за мак.
  const plat = /Android/i.test(ua) ? 'android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'ios'
    : /Mac/i.test(ua) ? 'mac'
    : /Win/i.test(ua) ? 'win' : 'other';
  document.body.dataset.platform = plat;
  if(plat !== 'win') return;                    // свои кнопки окна — только на Windows (desktop)
  const W = window.__TAURI__ && window.__TAURI__.window;
  if(!W || !W.getCurrentWindow) return;
  const win = W.getCurrentWindow();
  const ctl = $('#winCtl'); if(ctl) ctl.hidden = false;
  const on = (id, fn) => { const el = $('#' + id); if(el) el.onclick = fn; };
  on('winMin',   () => win.minimize());
  on('winMax',   () => win.toggleMaximize());
  on('winClose', () => win.close());
})();

// --- seed sample ---
async function seed(){
  const body = `# Nebula Серия, 20 видов по 1000 шт.
[x] 5ml - 5 видов
1. COLA VANILLA наліпка флакон 5ml.pdf
2. ICE-CREAM наліпка флакон 5ml.pdf
3. FRUIT MIX наліпка флакон 5ml.pdf
4. KIWI & STRAWBERRIES наліпка флакон 5ml.pdf
5. LIMONE & MINT наліпка флакон 5ml.pdf
---
5 видов по 1000 шт, размер 65х40мм.
1000 шт = 24 А3+ Ritrama white + gloss25mk + cutting 42 pcs per sheet - 2490 грн
5 вида по 1000 шт (5ml) = 120 А3 + Ritrama white + gloss25mk + cutting 42 pcs per sheet =  12 450 грн
[x] 10ml - 5 видов
6. COLA VANILLA наліпка флакон 10ml.pdf
7. ICE-CREAM наліпка флакон 10ml.pdf
8. FRUIT MIX наліпка флакон 10ml.pdf
9. KIWI & STRAWBERRIES наліпка флакон 10ml.pdf
10. LIMONE & MINT наліпка флакон 10ml.pdf
---
5 видов по 1000 шт, размер 90х40мм
1000 шт = 29 А3+ Ritrama white + gloss25mk + cutting 42 pcs per sheet - 2 830 грн
5 вида по 1000 шт (5ml) = 145 А3 + Ritrama white + gloss25mk + cutting 42 pcs per sheet = 14 150 грн
[x] 15ml - 5 видов
11. COLA VANILLA наліпка флакон 15ml.pdf
12. ICE-CREAM наліпка флакон 15ml.pdf
13. FRUIT MIX наліпка флакон 15ml.pdf
14. KIWI & STRAWBERRIES наліпка флакон 15ml.pdf
15. LIMONE & MINT наліпка флакон 15ml.pdf
---
5 видов по 1000 шт, размер 65х40мм.
1000 шт = 24 А3+ Ritrama white + gloss25mk + cutting 42 pcs per sheet - 2490 грн
5 вида по 1000 шт (5ml) = 120 А3 + Ritrama white + gloss25mk + cutting 42 pcs per sheet =  12 450 грн
[x] 30ml - 5 видов
16. COLA VANILLA наліпка флакон 30ml.pdf
17. ICE-CREAM наліпка флакон 30ml.pdf
18. FRUIT MIX наліпка флакон 30ml.pdf
19. KIWI & STRAWBERRIES наліпка флакон 30ml.pdf
20. LIMONE & MINT наліпка флакон 30ml.pdf
---
5 видов по 1000 шт, размер 90х40мм
1000 шт = 29 А3+ Ritrama white + gloss25mk + cutting 42 pcs per sheet - 2 830 грн
5 вида по 1000 шт (5ml) = 145 А3 + Ritrama white + gloss25mk + cutting 42 pcs per sheet = 14 150 грн
===
Итого 53200 грн
===
! Все макеты-монтажи разбиты на 2 файла 240 + 290 А3 по печати!
== и да этот текст будет выделен ==`;
  const n = { id: crypto.randomUUID(), title:'Nebula Серия', body, updated: Date.now() };
  notes = [n];
  await save(n);
}

// --- boot ---
(async ()=>{
  try{
    await loadConfig();               // читает lang + ручные правки ключевых слов
    applyLang(lang, kwOverrides);     // язык интерфейса + движок + тулбар/шпаргалка
    try{ if(localStorage.getItem(DOCMODE_KEY) === '1') applyDocMode(true); }catch{}
    await loadAll();
    select(currentId);   // применяет per-note режим просмотра (или дефолт по ширине экрана)
  }catch(e){
    out.innerHTML = `<div class="r-callout">⚠️ ${t('initError')}: ${e}</div>`;
  }
})();
