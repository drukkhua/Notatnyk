import { render, setLocale, LOCALE } from './parser.js';
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
    }
  }catch{ loc = defaultLoc(); }
}
async function saveConfig(){
  const folder = loc.custom ? loc.dir : null;
  await writeTextFile(CONFIG, JSON.stringify({ folder, lang, locale: kwOverrides }), base);
}

// --- state ---
let notes = [];        // [{id, title, body, updated}]
let currentId = null;
let saveTimer = null;
let query = '';        // строка поиска

// --- els ---
const $ = s => document.querySelector(s);
const noteList = $('#noteList');
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
  buildToolbar(); buildCheat();
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
    li.onclick = ()=> select(n.id);
    noteList.appendChild(li);
  }
}
function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

function current(){ return notes.find(n=>n.id===currentId); }

function select(id){
  currentId = id;
  const n = current();
  src.value = n ? n.body : '';
  drawList();
  paint();
}

function paint(){
  const text = src.value;
  const { html, stats, checkLineMap } = render(text);
  out.innerHTML = html;

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

  // клики по чекбоксам
  out.querySelectorAll('.r-check').forEach(node=>{
    node.onclick = ()=>{
      const idx = +node.dataset.check;
      const lineNo = checkLineMap[idx];
      const lines = src.value.split('\n');
      lines[lineNo] = lines[lineNo].replace(/\[([ xX])\]/,(m,ch)=>
        ch.toLowerCase()==='x' ? '[ ]' : '[x]');
      src.value = lines.join('\n');
      persist(); paint();
    };
  });
}

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

// --- подсказки синтаксиса (тулбар + шпаргалка) ---
// Список строится под текущий язык и ключевые слова. head — заголовок группы
// (только в шпаргалке). btn+ins — кнопка вставки. table:true — открывает диалог
// размера таблицы. Запись без btn — только в шпаргалке.
function buildSyntax(){
  const cur = LOCALE.currency, unit = LOCALE.unit, tot = LOCALE.total;
  const exDate = dateStr(false), exDateTime = dateStr(true);
  return [
    { head: t('grpStruct') },
    { btn:'#',       ins:'# ',      w:'# / ## / ###', g:t('sHead') },
    { btn:'☐',       ins:'[ ] ',    w:'[ ] / [x]',    g:t('sCheck', { done: LOCALE.done }) },
    { btn:'1.',      ins:'1. ',     w:'1.',           g:t('sNum') },
    { btn:'•',       ins:'- ',      w:'- / *',        g:t('sList') },
    { btn:'!',       ins:'! ',      w:'! / !!',       g:t('sCallout') },
    { btn:'❝',       ins:'> \n> @', w:`> … / > @${LOCALE.client}`, g:t('sQuote') },
    { btn:'—',       ins:'---\n',   w:'---',          g:t('sHrThin') },
    { btn:'≡',       ins:'===\n',   w:'===',          g:t('sHrBold') },
    { btn:'▦',       table:true,    w:'| A | B |',    g:t('sTable') },
    { btn:'//',      ins:'// ',     w:'// …',         g:t('sHide') },
    { btn:'/* */',   ins:'/*\n\n*/\n', w:'/* … */',    g:t('sHideBlock') },

    { head: t('grpInline') },
    { btn:'**b**',   ins:`**${t('exBold')}**`,   w:'**…**',   g:t('sBold') },
    { btn:'*i*',     ins:`*${t('exItalic')}*`,   w:'*…*',     g:t('sItalic') },
    { btn:'~~s~~',   ins:`~~${t('exStrike')}~~`, w:'~~…~~',   g:t('sStrike') },
    { btn:'==H==',   ins:`==${t('exMark')}==`,   w:'== … ==', g:t('sMark') },
    {                w:'https://…', g:t('sLink') },
    { btn:'[date]',      ins:'[date]',      w:`[date] → ${exDate}`, g:t('sDate', { date: exDate }) },
    { btn:'[date:time]', ins:'[date:time]', w:'[date:time]',        g:t('sDateTime', { datetime: exDateTime }) },

    { head: t('grpMoney') },
    { btn:`[${t('exVar')}]=`, ins:`[${t('exVar')}] = `, w:`[${t('exVar')}] = 1125`,  g:t('sVar') },
    {                       w:`… [${t('exVar')}] …`,                                g:t('sVarRef') },
    { btn:`= ${cur}`,       ins:`= 0 ${cur}`,       w:`= 12 450 ${cur}`,          g:t('sPrice') },
    {                       w:`2490 ${cur} / - 2490 ${cur}`,                      g:t('sPriceOther') },
    { btn:`${cur}/${unit}`, ins:` ${cur}/${unit}`,  w:`${cur}/${unit}`,           g:t('sPerUnit') },
    { btn:'123=',           ins:'2*3=',             w:'55*3+(2.5+3.5)*2=',        g:t('sCalc') },
    {                       w:`18400/1200*1125= ${cur}`,                          g:t('sCalcPrice') },
    { btn:tot,              ins:`${tot}  ${cur}`,   w:`${tot}: N ${cur}`,         g:t('sTotal') },
    { btn:`[${unit}]`,      ins:`[4000 ${unit}]`,   w:`[4000 ${unit}]`,           g:t('sQtyUnit', { total: tot }) },
  ];
}

function buildToolbar(){
  toolbar.innerHTML = '';
  for(const it of buildSyntax()){
    if(!it.btn) continue;                         // группы и справочные записи — без кнопки
    const b = document.createElement('button');
    b.className = 'tb-btn'; b.textContent = it.btn; b.title = it.g;
    b.onclick = it.table ? openTableDlg : () => insertAtCursor(it.ins);
    toolbar.appendChild(b);
  }
}
function buildCheat(){
  cheatTable.innerHTML = buildSyntax().map(it =>
    it.head
      ? `<tr class="cheat-group"><td colspan="2">${escapeHtml(it.head)}</td></tr>`
      : `<tr><td class="k">${escapeHtml(it.w)}</td><td class="v">${escapeHtml(it.g)}</td></tr>`
  ).join('');
}
function insertAtCursor(text){
  src.focus();
  // execCommand('insertText') кладёт правку в стек отмены <textarea>, поэтому
  // Cmd/Ctrl+Z корректно откатывает вставку. Событие input сделает persist+paint.
  if(document.execCommand && document.execCommand('insertText', false, text)) return;
  // фолбэк (если execCommand недоступен): прямая правка, но без истории отмены
  const a = src.selectionStart, b = src.selectionEnd;
  src.value = src.value.slice(0, a) + text + src.value.slice(b);
  const pos = a + text.length;
  src.setSelectionRange(pos, pos);
  persist(); paint();
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
function closeTableDlg(){ tableDlg.hidden = true; src.focus(); }
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
  closeTableDlg();
  insertAtCursor(text);
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

// --- events ---
src.addEventListener('input', ()=>{ expandDateAtCursor(); persist(); paint(); });
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

// --- перетаскиваемый разделитель редактора/рендера ---
(function initSplitter(){
  const divider = $('#divider'), editor = $('#editorpane');
  const KEY = 'notatnyk.split';
  const isMobile = () => window.matchMedia('(max-width:640px)').matches;
  const apply = f => { editor.style.flex = `0 0 ${(f*100).toFixed(2)}%`; };
  // восстановить сохранённую ширину (только на широком экране)
  const saved = parseFloat(localStorage.getItem(KEY));
  if(!isMobile() && saved > 0.15 && saved < 0.85) apply(saved);

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
$('#segSplit').onclick = ()=>{ split.classList.remove('viewonly');
  $('#segSplit').classList.add('active'); $('#segView').classList.remove('active'); };
$('#segView').onclick = ()=>{ split.classList.add('viewonly');
  $('#segView').classList.add('active'); $('#segSplit').classList.remove('active'); };
$('#themeBtn').onclick = ()=>{
  const el = document.documentElement;
  el.setAttribute('data-theme', el.getAttribute('data-theme')==='dark'?'light':'dark');
};

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
    await loadAll();
    select(currentId);
  }catch(e){
    out.innerHTML = `<div class="r-callout">⚠️ ${t('initError')}: ${e}</div>`;
  }
})();
