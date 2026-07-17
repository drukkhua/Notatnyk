// Движок синтаксиса Notatnyk. Чистая логика, одинаковая на всех платформах.

function esc(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

// Иконки — инлайн-SVG из набора Lucide (MIT, lucide.dev). Без зависимостей:
// вшиты только нужные пути (~0.3 КБ каждая), красятся через currentColor.
const icon = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICO = {
  warn:   icon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>'
             + '<path d="M12 9v4"/><path d="M12 17h.01"/>'),                       // triangle-alert
  danger: icon('<path d="M12 16h.01"/><path d="M12 8v4"/>'
             + '<path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624'
             + 'a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586'
             + 'l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688'
             + 'A2 2 0 0 1 8.688 2z"/>'),                                          // octagon-alert
  quote:  icon('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2'
             + ' 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'
             + '<path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2'
             + ' 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'), // quote
  check:  icon('<path d="M20 6 9 17l-5-5"/>'),                                      // check
};

function fmt(n){ return n.toLocaleString('ru-RU'); }

// Формат результата калькулятора: округление до 2 знаков, запятая, без лишних нулей.
function fmtNum(n){
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return r.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// ─────────────────────────────────────────────────────────────────────────────
// ЯЗЫКОВОЙ КОНФИГ (ключевые слова движка). Меняется в «Налаштування» приложения
// и сохраняется в config.json. Здесь — значения по умолчанию в читабельном виде.
// ─────────────────────────────────────────────────────────────────────────────
export const LOCALE = {
  currency:   'грн',      // валюта (пишется после суммы): «= 12 450 грн»
  total:      'Итого',    // ключевое слово подытога/секции: «Итого: N грн»
  done:       'ГОТОВО',   // штамп у выполненного чекбокса [x]
  unit:       'шт',       // единица «за штуку»: «грн/шт»
  yearSuffix: 'г',        // суффикс года в дате [date]: «16.07.2026г»
  positions:  'позиций',  // слово в футере: «Σ позиций (N)»
  section:    'секции',   // слово в подытоге секции: «Σ секции N»
  client:     'клиент',   // роль в цитате клиента: «> @Имя»
  unclosed:   'Блок /* открыт в строке {n} и не закрыт — всё ниже скрыто',
};

const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NL = '(?![а-яёіїєґA-Za-z])';   // «дальше не буква» — граница слова (кириллица/латиница)
let RE = {};
// Пересобирает регулярки под текущий LOCALE. Вызывается при старте и смене языка.
function buildPatterns(){
  const cur  = escRe(LOCALE.currency || 'грн');
  const unit = escRe(LOCALE.unit || 'шт');
  const tot  = escRe(LOCALE.total || 'Итого');
  const uSfx = `(\\.?\\s*\\/\\s*${unit}\\.?)`;                 // «/шт», «./шт.»
  RE.price     = new RegExp(`([.,]?)(=\\s*)?(\\d[\\d\\s]*)\\s*${cur}${uSfx}?${NL}`, 'gi');
  RE.calc      = new RegExp(`((?:\\[[^\\]]+\\]|[0-9])(?:\\[[^\\]]+\\]|[0-9.,()+\\-*/%^\\s])*?)\\s*=(\\s*${cur}${uSfx}?${NL})?`, 'gi');
  RE.totalLine = new RegExp(`^(${tot})${NL}\\s*(:?)\\s*(.*)$`, 'i');
  RE.declared  = new RegExp(`${tot}${NL}\\s*:?\\s*(\\d[\\d\\s]*)`, 'gi');
  RE.posPrice  = new RegExp(`=\\s*[\\d][\\d\\s]*\\s*${cur}(?!\\.?\\s*\\/\\s*${unit})`, 'gi');
  RE.posCalc   = new RegExp(`=\\s*${cur}(?!\\.?\\s*\\/\\s*${unit})${NL}`, 'gi');
  RE.varRef    = new RegExp(`(=\\s*)?\\[([^\\]]+)\\](\\s*${cur}${uSfx}?${NL})?`, 'gi');
  RE.posVar    = new RegExp(`=\\s*\\[([^\\]]+)\\]\\s*${cur}(?!\\.?\\s*\\/\\s*${unit})${NL}`, 'gi');
}
buildPatterns();
// Применить новые значения ключевых слов (частичный патч) и пересобрать регулярки.
export function setLocale(patch){ Object.assign(LOCALE, patch || {}); buildPatterns(); }

// --- переменные [имя] = формула, ссылка [имя] в формулах ---
let VARS = {};                                     // текущие переменные (заполняется в render())
const RE_VARDEF = /^\[([^\]=\n]+)\]\s*=\s*(.+)$/;  // объявление: [имя] = выражение
function fmtVar(n){                                 // число переменной: запятая, без разрядов
  if(n == null || !isFinite(n)) return '?';
  return (Math.round((n + Number.EPSILON) * 1e6) / 1e6).toString().replace('.', ',');
}
// [ссылки] → численные значения для вычисления. unknown=true, если имя не найдено.
function resolveRefs(expr){
  let unknown = false;
  const numeric = expr.replace(/\[([^\]]+)\]/g, (mm, nm) => {
    const k = nm.trim();
    if(VARS[k] == null){ unknown = true; return mm; }
    return `(${VARS[k]})`;
  });
  return { numeric, unknown };
}
// Формула для показа: [ссылки] → значение жирно-синим; * защитить от инлайн-стилей.
function refsToHtml(expr){
  return expr.replace(/\[([^\]]+)\]/g, (mm, nm) => {
    const v = VARS[nm.trim()];
    return v != null ? `<span class="var-ref">${fmtVar(v)}</span>` : mm;
  }).replace(/\*/g,'&#42;');
}

// --- Калькулятор выражений: <выражение>= → результат ---
// Безопасный рекурсивный парсер (без eval). Поддержка + - * / % ^ и скобок ( ).
// % — процент от суммы: a±b% = a ± a·b/100 ; a*b% = a·b/100 ; b% = b/100.
// Возвращает число либо null (некорректное выражение).
export function calc(input){
  const s = input.replace(/\s+/g,'').replace(/,/g,'.');
  if(!s) return null;
  let i = 0;
  const peek = () => s[i];

  function atom(){                       // число или (выражение), опц. суффикс %
    if(peek() === '('){
      i++; const inner = expr();
      if(peek() !== ')') throw 0;
      i++; return pct(inner.v);
    }
    let j = i;
    while(j < s.length && /[0-9.]/.test(s[j])) j++;
    if(j === i) throw 0;
    const num = parseFloat(s.slice(i, j));
    if(!isFinite(num)) throw 0;
    i = j; return pct(num);
  }
  function pct(v){                        // суффикс %
    if(peek() === '%'){ i++; return { v, pct:true }; }
    return { v, pct:false };
  }
  function power(){                       // ^ (право-ассоциативно)
    const base = atom();
    if(peek() === '^'){ i++; const e = unary(); return { v: Math.pow(base.v, e.v), pct:false }; }
    return base;
  }
  function unary(){                       // унарный + / -
    let sign = 1;
    while(peek()==='+' || peek()==='-'){ if(peek()==='-') sign = -sign; i++; }
    const n = power(); return { v: sign*n.v, pct:n.pct };
  }
  function term(){                        // * /
    const first = unary();
    if(peek()!=='*' && peek()!=='/') return first;   // одиночный % проходит наверх
    let v = first.pct ? first.v/100 : first.v;
    while(peek()==='*' || peek()==='/'){
      const op = s[i++]; const r = unary();
      const rv = r.pct ? r.v/100 : r.v;
      v = op==='*' ? v*rv : v/rv;
    }
    return { v, pct:false };
  }
  function expr(){                        // + -
    const first = term();
    let v = first.pct ? first.v/100 : first.v;       // одиночный процент → /100
    while(peek()==='+' || peek()==='-'){
      const op = s[i++]; const r = term();
      const rv = r.pct ? v*r.v/100 : r.v;            // процент от накопленного
      v = op==='+' ? v+rv : v-rv;
    }
    return { v, pct:false };
  }

  try{
    const { v } = expr();
    if(i !== s.length) return null;                  // остался неразобранный «хвост»
    if(!isFinite(v)) return null;
    return v;
  }catch{ return null; }
}

// Инлайн-разметка. Возвращает {html, sum} где sum — цены с "=".
export function inline(text){
  let s = esc(text), sum = 0;

  // Цена = число, стоящее прямо перед "грн". Определяем, есть ли перед этим
  // числом знак "=" (возможно с пробелами) — тогда цена идёт в Σ.
  // Иначе (тире, дефис, просто текст) — прочая цена, не в Σ.
  const C = LOCALE.currency;
  s = s.replace(RE.price,(m,dot,eq,n,unit)=>{
    // если прямо перед числом стоит "." или "," — это дробная часть числа
    // (напр. "2.55 грн" — множитель), а не отдельная цена. Не трогаем.
    if(dot === '.' || dot === ',') return m;
    const v = parseInt(n.replace(/\s/g,''),10)||0;
    // "грн/шт", "грн./шт." — цена за штуку: показываем, но НЕ суммируем в Σ.
    if(unit) return `<span class="price-other">${fmt(v)} ${C}${unit}</span>`;
    // eq (группа 2) непусто, только если перед числом реально был "=".
    // Пробел «жуётся» лишь после "=", поэтому пробел перед обычной ценой сохраняется.
    if(eq){
      sum += v;
      return `<span class="calc-eq">=</span> <span class="price-sum">${fmt(v)} ${C}</span>`;
    }
    return `<span class="price-other">${fmt(v)} ${C}</span>`;
  });

  // Калькулятор: «<выражение>=» → «выражение = результат».
  // Идёт ПОСЛЕ цен, чтобы обычные «= N грн» уже были обработаны и не считались
  // дважды. Требуется оператор или скобки (одиночное «123=» не трогаем). Формула
  // в исходнике не меняется. Если сразу за «=» стоит «грн» — результат становится
  // ценой в Σ (синий чип) и попадает в сумму, как обычные цены с «=».
  s = s.replace(RE.calc, (m, e, grn, unit) => {
    // требуется реальная операция (оператор/скобки или вычитание между числами/ссылками)
    if(!/[+*/%^()]/.test(e) && !/[\d\]]\s*-\s*[\d\[]/.test(e)) return m;
    const { numeric, unknown } = resolveRefs(e);
    if(unknown) return m;                            // неизвестная [ссылка] — не трогаем
    const r = calc(numeric);
    if(r === null) return m;
    const formula = `<span class="calc-formula">${refsToHtml(e.trim())}</span>`;
    const eq = ` <span class="calc-eq">=</span> `;
    if(grn){
      // "грн/шт" — цена за штуку: показываем результат, но НЕ суммируем в Σ
      if(unit) return `${formula}${eq}<span class="price-other">${fmtNum(r)} ${C}${unit}</span>`;
      sum += Math.round((r + Number.EPSILON) * 100) / 100;
      return `${formula}${eq}<span class="price-sum">${fmtNum(r)} ${C}</span>`;
    }
    return `${formula}${eq}<span class="calc-res">${fmtNum(r)}</span>`;
  });

  // Одиночная [ссылка] на переменную вне формулы — подставляем её значение.
  // «= [имя] грн» — как обычная цена с «=»: идёт в Σ; «[имя] грн» — прочая цена.
  // Неизвестные имена (шаблоны [4000 шт], [date] и т.п.) не трогаем.
  s = s.replace(RE.varRef, (m, eq, nm, grn, unit) => {
    const v = VARS[nm.trim()];
    if(v == null) return m;
    if(grn){
      if(unit) return `<span class="price-other">${fmtNum(v)} ${C}${unit}</span>`;
      if(eq){
        sum += Math.round((v + Number.EPSILON) * 100) / 100;
        return `<span class="calc-eq">=</span> <span class="price-sum">${fmtNum(v)} ${C}</span>`;
      }
      return `<span class="price-other">${fmtNum(v)} ${C}</span>`;
    }
    return `${eq || ''}<span class="var-ref">${fmtVar(v)}</span>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/==\s*([^=]+?)\s*==/g,'<mark>$1</mark>');
  s = s.replace(/~~([^~]+)~~/g,'<del>$1</del>');
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,'$1<em>$2</em>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>');

  return { html: s, sum };
}

// Полный рендер текста -> {html, stats}
export function render(text){
  const lines = text.split('\n');
  VARS = {};                                   // переменные [имя] — заново на каждый рендер
  let html = '', total = 0, checksTotal = 0, checksDone = 0, positions = 0;
  let sectionSum = 0;                          // сумма =-цен текущей секции (до ближайшего «Итого»)
  const add = v => { total += v; sectionSum += v; };
  const sections = [];                         // [{declared, sum}] — по одному на строку «Итого»
  let lastTotal = null;                        // сумма ближайшего сверху «Итого» — для шаблона [кільк. од.]
  // Шаблон [4000 шт] / [4000 компл] → (сумма/кол-во грн/ед). База — ближайшее «Итого».
  const perUnitExpand = (h, base) => h.replace(
    /\[\s*(\d[\d\s]*)\s*([^\]\d\s][^\]]*?)\s*\]/g,
    (mm, q, unit) => {
      const qty = parseInt(q.replace(/\s/g,''), 10);
      if(!qty || base == null) return mm;
      return `<span class="per-unit">(${fmtNum(base / qty)} ${LOCALE.currency}/${unit.trim()})</span>`;
    });
  let checkLineMap = [];   // индекс чекбокса в рендере -> номер строки в тексте
  // Скрытие: «// строка» и блок «/* … */». Скрытое разбирается как обычно —
  // цены идут в Σ, переменные объявляются, — но не попадает в html.
  let hiddenBlock = false; // мы внутри /* … */
  let blockStart = 0;      // строка с «/*» — для предупреждения о незакрытом блоке
  let hidden = false;      // текущая строка скрыта
  // data-line: номер строки источника на каждом блоке — якоря для синхронного
  // скролла редактор ↔ рендер (см. main.js).
  let curLine = 0;
  const emit = h => { if(!hidden) html += h.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, `<$1 data-line="${curLine}"`); };

  // строка таблицы: начинается и кончается «|» и содержит хотя бы 2 «|»
  const isTableRow = t => t.startsWith('|') && t.endsWith('|') && (t.match(/\|/g)||[]).length >= 2;
  // строка-разделитель markdown-таблицы: |---|:--:|  — не рисуем как ряд
  const isTableSep = t => /^\|[\s:|-]+\|$/.test(t) && t.includes('-');

  for(let lineIdx = 0; lineIdx < lines.length; lineIdx++){
    const raw = lines[lineIdx].trim();
    if(raw === '') continue;
    curLine = lineIdx;

    // границы блока: «/*» открывает (хвост строки — метка, можно писать зачем прячем)
    if(!hiddenBlock && /^\/\*/.test(raw)){ hiddenBlock = true; blockStart = lineIdx; continue; }
    if(hiddenBlock && /^\*\/$/.test(raw)){ hiddenBlock = false; continue; }
    const hiddenLine = /^\/\//.test(raw);
    hidden = hiddenBlock || hiddenLine;
    // дальше строка разбирается без маркера «//» — как обычная
    const t = hiddenLine ? raw.replace(/^\/+\s*/, '') : raw;

    // Таблица: собираем подряд идущие строки-ряды. Первый непустой ряд — заголовок.
    // Сканер ниже читает строки как есть, поэтому «// | A |» сюда не пускаем.
    if(isTableRow(t) && !hiddenLine){
      const rows = [];
      let j = lineIdx;
      while(j < lines.length){
        const tj = lines[j].trim();
        if(!isTableRow(tj)) break;
        if(!isTableSep(tj)) rows.push(tj);
        j++;
      }
      if(rows.length){
        let tb = '<table class="r-table">';
        rows.forEach((rowLine, ri) => {
          const cells = rowLine.slice(1, -1).split('|').map(c => c.trim());
          tb += ri === 0 ? '<tr class="r-tr-head">' : '<tr>';
          for(const c of cells){ const r = inline(c); add(r.sum); tb += `<td>${r.html}</td>`; }
          tb += '</tr>';
        });
        emit(tb + '</table>');
      }
      lineIdx = j - 1;
      continue;
    }

    // Цитата клиента: подряд идущие строки «> …» (стандартный markdown-blockquote).
    // Строка «> @Имя» внутри блока — атрибуция клиента: рендерится чипом с аватаром
    // и ролью. Текст цитаты форматируется (inline), но в Σ НЕ идёт — это слова
    // клиента/бриф, а не позиция сметы. Так в отрендеренном расчёте клиенту сразу
    // видно, что цитата адресована именно ему.
    if(/^>\s?/.test(t) && !hiddenLine){
      const qlines = []; let client = null; let j = lineIdx;
      while(j < lines.length){
        const tj = lines[j].trim();
        if(!/^>\s?/.test(tj)) break;
        const body = tj.replace(/^>\s?/, '');
        const cm = body.match(/^@\s*(.+)$/);
        if(cm) client = cm[1].trim();            // «> @Имя» — клиент
        else if(body !== '') qlines.push(inline(body).html);  // формат есть, в Σ не идёт
        j++;
      }
      let card = `<blockquote class="r-quote"><span class="r-quote-ico">${ICO.quote}</span>`;
      if(client){
        const initial = esc(client.charAt(0).toUpperCase());
        card += '<div class="r-quote-client">'
              + `<span class="r-quote-ava">${initial}</span>`
              + `<span class="r-quote-name">${esc(client)}</span>`
              + `<span class="r-quote-role">${esc(LOCALE.client)}</span>`
              + '</div>';
      }
      card += `<div class="r-quote-body">${qlines.join('<br>')}</div>`;
      emit(card + '</blockquote>');
      lineIdx = j - 1;
      continue;
    }

    if(/^={3,}$/.test(t)){ emit('<hr class="r-hr2">'); continue; }
    if(/^-{3,}$/.test(t)){ emit('<hr class="r-hr">'); continue; }

    let m;
    // Объявление переменной: [имя] = выражение (без валюты и без хвостовой «=»).
    // Проверяется до чекбокса, поэтому «[x] = 5» — это переменная x, а «[x] задача» — чекбокс.
    if(m = t.match(RE_VARDEF)){
      const name = m[1].trim();
      const rhs = esc(m[2].trim());
      const { numeric, unknown } = resolveRefs(rhs);
      const val = unknown ? null : calc(numeric);
      if(name && val !== null && isFinite(val)){
        VARS[name] = val;
        const isFormula = /[-+*/%^()]/.test(m[2]) || m[2].includes('[');
        emit(`<div class="r-var"><span class="var-name">[${esc(name)}]</span>`
              + (isFormula
                  ? ` <span class="calc-eq">=</span> <span class="var-formula">${refsToHtml(rhs)}</span>`
                    + ` <span class="calc-eq">→</span> <span class="var-val">${fmtVar(val)}</span>`
                  : ` <span class="calc-eq">=</span> <span class="var-val">${fmtVar(val)}</span>`)
              + `</div>`);
        continue;
      }
      // не валидное объявление — падаем в обычную обработку ниже
    }
    if(m = t.match(/^(#{1,3})\s+(.*)$/)){
      const r = inline(m[2]); add(r.sum);
      emit(`<div class="r-h${m[1].length}">${r.html}</div>`); continue;
    }
    if(m = t.match(/^\[([ xX])\]\s*(.*)$/)){
      const done = m[1].toLowerCase() === 'x';
      checksTotal++; if(done) checksDone++;
      const r = inline(m[2]); add(r.sum);
      const idx = checkLineMap.length; checkLineMap.push(lineIdx);
      emit(`<div class="r-check${done?' done':''}" data-check="${idx}">`
            + `<span class="box">${done?ICO.check:''}</span>`
            + `<span class="txt">${r.html}</span>`
            + (done?`<span class="stamp">(${LOCALE.done})</span>`:'')
            + `</div>`);
      continue;
    }
    if(m = t.match(/^(!!?)\s+(.*)$/)){
      const r = inline(m[2]); add(r.sum);
      const strong = m[1] === '!!';
      emit(`<div class="r-callout${strong?' strong':''}">`
            + `<span class="r-callout-ico">${strong?ICO.danger:ICO.warn}</span>`
            + `<span>${r.html}</span></div>`); continue;
    }
    if(m = t.match(RE.totalLine)){
      const rest = m[3];
      const r = inline(rest);                  // текст суммы (обычно без «=», в total не идёт)
      const dm = rest.match(/\d[\d\s]*/);
      const declaredHere = dm ? (parseInt(dm[0].replace(/\s/g,''),10)||0) : null;
      const sec = Math.round(sectionSum * 100) / 100;
      let fb;
      if(declaredHere != null){
        const diff = Math.round((sec - declaredHere) * 100) / 100;
        fb = diff === 0
          ? '<span class="r-total-ok">✓</span>'
          : `<span class="r-total-bad">✕ Σ ${LOCALE.section} ${fmtNum(sec)} (${diff>0?'+':''}${fmtNum(diff)})</span>`;
      }else{
        fb = `<span class="r-total-ok">Σ ${LOCALE.section}: ${fmtNum(sec)} ${LOCALE.currency}</span>`;
      }
      const effTotal = declaredHere != null ? declaredHere : sec;
      const restHtml = perUnitExpand(r.html, effTotal);   // [кільк.] прямо в строке «Итого»
      const parts = [`<b>${m[1]}${m[2]||''}</b>`];
      if(restHtml.trim()) parts.push(restHtml);
      parts.push(fb);
      emit(`<div class="r-total">${parts.join(' ')}</div>`);
      sections.push({ declared: declaredHere, sum: sec });
      lastTotal = effTotal;                     // для [кільк.] на следующих строках
      sectionSum = 0;                           // начинаем новую секцию
      continue;
    }
    if(m = t.match(/^(\d+)\.\s+(.*)$/)){
      const r = inline(m[2]); add(r.sum);
      emit(`<div class="r-num">${m[1]}. ${r.html}</div>`); continue;
    }
    if(m = t.match(/^[-*]\s+(.*)$/)){
      const r = inline(m[1]); add(r.sum);
      emit(`<div class="r-li">${r.html}</div>`); continue;
    }
    const r = inline(t); add(r.sum);
    // обычный текст — без маркера списка; [кільк.] раскрывается по ближайшему «Итого»
    emit(`<div class="r-p">${perUnitExpand(r.html, lastTotal)}</div>`);
  }

  // «/*» без пары спрятал бы весь хвост заметки молча — говорим об этом вслух
  if(hiddenBlock){
    const msg = String(LOCALE.unclosed || '').replace('{n}', blockStart + 1);
    html += `<div class="r-callout strong"><span class="r-callout-ico">${ICO.danger}</span><span>${esc(msg)}</span></div>`;
  }

  // объявленные "Итого" (может быть несколько секций) — суммируем все
  let declared = null, declaredSum = 0, hasDeclared = false;
  RE.declared.lastIndex = 0;
  for(const mm of text.matchAll(RE.declared)){
    declaredSum += parseInt(mm[1].replace(/\s/g,''),10)||0;
    hasDeclared = true;
  }
  if(hasDeclared) declared = declaredSum;

  positions = (text.match(RE.posPrice)||[]).length     // цены = N грн (кроме /шт)
            + (text.match(RE.posCalc)||[]).length;      // калькулятор = грн (кроме /шт)
  RE.posVar.lastIndex = 0;
  for(const mm of text.matchAll(RE.posVar))             // = [переменная] грн (кроме /шт)
    if(VARS[mm[1].trim()] != null) positions++;

  return {
    html,
    stats: { total, checksTotal, checksDone, positions, declared, sections },
    checkLineMap,
    fmt
  };
}

export { fmt };
