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
  internal:   'внутренние расчёты',   // подпись свёрнутого /* */ чипа «🙈 …»
  // Спец-имена переменных денежной петли (Э1.3): локализуемы, EN-алиасы
  // ('pay', 'deposit', 'valid until', 'email') работают всегда.
  payVar:     'оплата',          // [оплата] = <url> → кнопка «Оплатить» в экспорте
  depositVar: 'депозит',         // [депозит] = 30% | 5000 → «Принять и внести депозит»
  validVar:   'действительна до',// [действительна до] = 01.08 → штамп срока действия
  emailVar:   'email',           // [email] = адрес автора → mailto «Принять»
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
  // Цена «в Σ»: перед числом может стоять «=» ИЛИ «:» — оба дают тот же результат
  // (сумма идёт в Σ). Калькулятор формул (RE.calc) — только «=», не трогаем.
  // Порядок групп: сначала оператор [=:], потом «дробная точка». Иначе точка из
  // «т.д.: 3500» захватилась бы как дробная часть и цену бы отбросило (баг: «:»
  // без пробела перед ним не срабатывал). Само число может иметь дробную часть
  // («14322.56» / «14322,56») — она входит в сумму. Ведущая «дробная точка» (гр.3)
  // теперь срабатывает лишь для «сироты» «.56 грн» (без целой части) — её отбрасываем.
  RE.price     = new RegExp(`(\\\\)?([=:]\\s*)?([.,]?)(\\d[\\d\\s]*(?:[.,]\\d+)?)\\s*${cur}${uSfx}?${NL}`, 'gi');
  RE.calc      = new RegExp(`((?:\\[[^\\]]+\\]|[0-9])(?:\\[[^\\]]+\\]|[0-9.,()+\\-*/%^\\s])*?)\\s*=(\\s*${cur}${uSfx}?${NL})?`, 'gi');
  RE.totalLine = new RegExp(`^(${tot})${NL}\\s*(:?)\\s*(.*)$`, 'i');
  RE.declared  = new RegExp(`${tot}${NL}\\s*:?\\s*(\\d[\\d\\s]*(?:[.,]\\d+)?)`, 'gi');
  RE.posPrice  = new RegExp(`(?<!\\\\)[=:]\\s*[\\d][\\d\\s]*(?:[.,]\\d+)?\\s*${cur}(?!\\.?\\s*\\/\\s*${unit})`, 'gi');
  RE.posCalc   = new RegExp(`=\\s*${cur}(?!\\.?\\s*\\/\\s*${unit})${NL}`, 'gi');
  RE.varRef    = new RegExp(`([=:]\\s*)?\\[([^\\]]+)\\](\\s*${cur}${uSfx}?${NL})?`, 'gi');
  RE.posVar    = new RegExp(`[=:]\\s*\\[([^\\]]+)\\]\\s*${cur}(?!\\.?\\s*\\/\\s*${unit})${NL}`, 'gi');
}
buildPatterns();
// Применить новые значения ключевых слов (частичный патч) и пересобрать регулярки.
export function setLocale(patch){ Object.assign(LOCALE, patch || {}); buildPatterns(); }

// --- режим экспорта (Э1.2 «санитайз по построению») ---
// EXPORT=true: наружу уходят только РЕЗУЛЬТАТЫ. Формулы калькулятора не
// печатаются, объявления переменных не эмитятся (но вычисляются — Σ честная),
// служебные предупреждения не показываются. Скрытые строки '//' и блоки
// '/* */' не попадают в html в любом режиме — это уже гарантирует hidden-флаг.
// ВАЖНО (Э2): строковые переменные ([оплата]=url и т.п.) при их появлении тоже
// обязаны не эмитеться в EXPORT — маршрут через ту же ветку RE_VARDEF.
let EXPORT = false;

// --- переменные [имя] = формула, ссылка [имя] в формулах ---
let VARS = {};                                     // числовые переменные (заполняется в render())
let SVARS = {};                                    // строковые переменные (Э2.2): url оплаты, реквизиты, сроки
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
    const tok = s.slice(i, j);
    // «01.08.2026» — дата, а не число: две точки в токене → не выражение.
    // Иначе parseFloat молча взял бы 1.08, а хвост «.2026» потерялся.
    if((tok.match(/\./g) || []).length > 1) throw 0;
    const num = parseFloat(tok);
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

// ─────────────────────────────────────────────────────────────────────────────
// ГАБАРИТ-ЭСКИЗ [50x90мм] — пропорциональный прямоугольник с размерными
// стрелками, как технический набросок изделия (визитка, листовка, этикетка).
// Формат: [WxHunit] — числа (целые или дробные через «,»/«.»); разделитель
// x/X/х(кир)/Х(кир)/×; единица мм/mm/см/cm/дм/dm/м/m. Только в рендере и
// экспорте; inlineSource не трогает паттерн (инвариант И1). Вырезается ДО
// varRef и perUnitExpand — защита от ложной трактовки «57» как qty.
// ─────────────────────────────────────────────────────────────────────────────
const RE_DIMBOX = /\[(\d+(?:[.,]\d+)?)\s*[xXхХ×]\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm|дм|dm|м(?!м)|m(?!m))((?:[+\s][^\]]*)?)\]/g;

function buildDimSVG(wRaw, hRaw, unitRaw, mods) {
  const wn = parseFloat(String(wRaw).replace(',','.'));
  const hn = parseFloat(String(hRaw).replace(',','.'));
  if(!isFinite(wn)||!isFinite(hn)||wn<=0||hn<=0)
    return esc('['+wRaw+'x'+hRaw+unitRaw+']');
  const uMap={'mm':'мм','мм':'мм','cm':'см','см':'см','dm':'дм','дм':'дм','m':'м','м':'м'};
  const uLbl = uMap[unitRaw.toLowerCase()] || unitRaw;
  const wNum = Number.isInteger(wn) ? String(wn) : String(wRaw).replace('.',',');
  const hNum = Number.isInteger(hn) ? String(hn) : String(hRaw).replace('.',',');
  const wText = wNum+' '+uLbl, hText = hNum+' '+uLbl;

  const MW=160, MH=130, MIN_D=50;
  const sc = Math.min(MW/wn, MH/hn, 8);
  const rw = Math.round(Math.max(MIN_D, Math.min(MW, wn*sc)));
  const rh = Math.round(Math.max(MIN_D, Math.min(MH, hn*sc)));

  // Parse modifiers from source: +N = bleed, rN / r=N = corner radius
  const modsStr = String(mods||'');
  const bleedRaw  = (modsStr.match(/\+(\d+(?:[.,]\d+)?)/)||[])[1];
  const radiusRaw = (modsStr.match(/\br=?(\d+(?:[.,]\d+)?)/i)||[])[1];
  const db = bleedRaw  ? Math.max(2, Math.round(parseFloat(bleedRaw.replace(',','.'))*sc))  : 0;
  const dr = radiusRaw ? Math.min(Math.round(parseFloat(radiusRaw.replace(',','.'))*sc), Math.floor(Math.min(rw,rh)/2)) : 0;
  // Outer rect corner: slightly larger radius so both curves feel concentric
  const drOut = dr>0 ? Math.min(dr+db, Math.floor(Math.min(rw+2*db,rh+2*db)/2)) : 0;

  // Layout — inner rect inset by db; dim lines attach to inner rect edges.
  // When db=0 everything collapses to the plain case.
  const PL=8, PT=8, DG=8, PR=14, AL=6, AW=2.5;
  const rx=PL+db, ry=PT+db;             // inner rect origin
  const cx=rx+rw/2, cy=ry+rh/2;
  const dim_y = PT+rh+2*db+DG;          // width dim line — below outer rect
  const dlx   = PL+rw+2*db+DG;          // height dim line — right of outer rect
  const TW=PL+rw+2*db+DG+PR;
  const TH=PT+rh+2*db+DG+16+6;

  const wGap = Math.max(4, Math.min(rw/2-AL-6, (wText.length*6.8+6)/2));
  const hGap = Math.max(4, Math.min(rh/2-AL-6, (hText.length*6.8+6)/2));

  const st='var(--ink-soft)', di='var(--formula)', dim='var(--ink-soft)';
  const sans='-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,system-ui,sans-serif';
  const xt  = 'stroke="'+di+'" stroke-width="0.7" stroke-dasharray="4,3"';
  const el  = 'stroke="'+dim+'" stroke-width="0.6"';
  const dl  = 'stroke="'+dim+'" stroke-width="0.8"';
  const aw  = 'stroke="'+dim+'" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"';
  // Bleed rect: same dash pattern as X-cross, slightly lighter
  const bst = 'stroke="'+di+'" fill="none" stroke-width="0.75" stroke-dasharray="5,3"';

  const awL=(x,y)=>'M '+(x+AL)+','+(y-AW)+' L '+x+','+y+' L '+(x+AL)+','+(y+AW);
  const awR=(x,y)=>'M '+(x-AL)+','+(y-AW)+' L '+x+','+y+' L '+(x-AL)+','+(y+AW);
  const awU=(x,y)=>'M '+(x-AW)+','+(y+AL)+' L '+x+','+y+' L '+(x+AW)+','+(y+AL);
  const awD=(x,y)=>'M '+(x-AW)+','+(y-AL)+' L '+x+','+y+' L '+(x+AW)+','+(y-AL);

  let o = '<svg class="r-dimbox" viewBox="0 0 '+TW+' '+TH+'" width="'+TW+'" height="'+TH+'" '
        + 'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+esc(wText)+' × '+esc(hText)+'">';

  // Bleed outer rect (drawn first — behind inner rect)
  if(db>0)
    o += '<rect x="'+PL+'" y="'+PT+'" width="'+(rw+2*db)+'" height="'+(rh+2*db)+'" '
       + bst+' rx="'+drOut+'" ry="'+drOut+'"/>';

  // Inner rect (trim/product size)
  o += '<rect x="'+rx+'" y="'+ry+'" width="'+rw+'" height="'+rh+'" stroke="'+st
     + '" fill="var(--paper)" stroke-width="1.5" rx="'+dr+'" ry="'+dr+'"/>';

  // Diagonal X cross
  o += '<line x1="'+rx+'" y1="'+ry+'" x2="'+(rx+rw)+'" y2="'+(ry+rh)+'" '+xt+'/>';
  o += '<line x1="'+(rx+rw)+'" y1="'+ry+'" x2="'+rx+'" y2="'+(ry+rh)+'" '+xt+'/>';

  // Width dim line: extension lines from inner rect bottom corners downward
  o += '<line x1="'+rx+'" y1="'+(ry+rh)+'" x2="'+rx+'" y2="'+dim_y+'" '+el+'/>';
  o += '<line x1="'+(rx+rw)+'" y1="'+(ry+rh)+'" x2="'+(rx+rw)+'" y2="'+dim_y+'" '+el+'/>';
  o += '<line x1="'+rx+'" y1="'+dim_y+'" x2="'+(cx-wGap)+'" y2="'+dim_y+'" '+dl+'/>';
  o += '<line x1="'+(cx+wGap)+'" y1="'+dim_y+'" x2="'+(rx+rw)+'" y2="'+dim_y+'" '+dl+'/>';
  o += '<path d="'+awL(rx,dim_y)+'" '+aw+'/><path d="'+awR(rx+rw,dim_y)+'" '+aw+'/>';
  o += '<text x="'+cx+'" y="'+dim_y+'" text-anchor="middle" dominant-baseline="central" '
     + 'font-size="9.5" fill="'+dim+'" font-family="'+sans+'">'+esc(wText)+'</text>';

  // Height dim line: extension lines from inner rect right corners rightward
  o += '<line x1="'+(rx+rw)+'" y1="'+ry+'" x2="'+dlx+'" y2="'+ry+'" '+el+'/>';
  o += '<line x1="'+(rx+rw)+'" y1="'+(ry+rh)+'" x2="'+dlx+'" y2="'+(ry+rh)+'" '+el+'/>';
  o += '<line x1="'+dlx+'" y1="'+ry+'" x2="'+dlx+'" y2="'+(cy-hGap)+'" '+dl+'/>';
  o += '<line x1="'+dlx+'" y1="'+(cy+hGap)+'" x2="'+dlx+'" y2="'+(ry+rh)+'" '+dl+'/>';
  o += '<path d="'+awU(dlx,ry)+'" '+aw+'/><path d="'+awD(dlx,ry+rh)+'" '+aw+'/>';
  o += '<text x="'+dlx+'" y="'+cy+'" text-anchor="middle" dominant-baseline="central" '
     + 'font-size="9.5" fill="'+dim+'" font-family="'+sans+'" '
     + 'transform="rotate(-90 '+dlx+' '+cy+')">'+esc(hText)+'</text>';

  return o+'</svg>';
}




// Круговой эскиз [d50мм]: окружность с крестом центровых линий и размерной
// стрелкой диаметра (ø). Разделитель: буква d/D (diameter). Те же правила безопасности,
// что и buildDimSVG: вырезается до varRef/perUnitExpand.
const RE_DIMCIRCLE = /\[[dD](\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm|дм|dm|м(?!м)|m(?!m))\]/g;

function buildDimCircleSVG(dRaw, unitRaw) {
  const dn = parseFloat(String(dRaw).replace(',','.'));
  if(!isFinite(dn)||dn<=0) return esc('[d'+dRaw+unitRaw+']');
  const uMap={'mm':'мм','мм':'мм','cm':'см','см':'см','dm':'дм','дм':'дм','m':'м','м':'м'};
  const uLbl = uMap[unitRaw.toLowerCase()] || unitRaw;
  const dNum = Number.isInteger(dn) ? String(dn) : String(dRaw).replace('.',',');
  const dText = 'ø '+dNum+' '+uLbl;

  const MAX_R=64, MIN_R=24;
  const sc = Math.min(MAX_R*2/dn, 8);
  const r = Math.round(Math.max(MIN_R, Math.min(MAX_R, dn/2*sc)));

  const EXT=6, PL=8, PT=8, DG=8, AL=6, AW=2.5;
  const sans='-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,system-ui,sans-serif';

  const dTextW = Math.ceil(dText.length*7)+6;
  const cw = Math.max(2*(r+EXT), dTextW);
  const cx = PL+cw/2, cy = PT+r+EXT;
  const dly = cy+r+DG;          // dim line BELOW circle bottom
  const TW = PL+cw+PL;
  const TH = dly+16+6;           // +16 label, +6 bottom margin

  const st='var(--ink-soft)', di='var(--formula)', dim='var(--ink-soft)';
  const cl='stroke="'+di+'" stroke-width="0.65" stroke-dasharray="6,3"';
  const el='stroke="'+dim+'" stroke-width="0.6"';
  const dl='stroke="'+dim+'" stroke-width="0.8"';
  const aw='stroke="'+dim+'" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"';

  const dGap = Math.max(4, Math.min(r-AL-6, (dText.length*6.8+6)/2));

  const awL=(x,y)=>'M '+(x+AL)+','+(y-AW)+' L '+x+','+y+' L '+(x+AL)+','+(y+AW);
  const awR=(x,y)=>'M '+(x-AL)+','+(y-AW)+' L '+x+','+y+' L '+(x-AL)+','+(y+AW);

  return '<svg class="r-dimbox r-dimbox-circle" viewBox="0 0 '+TW+' '+TH+'" width="'+TW+'" height="'+TH+'" '
       + 'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+esc(dText)+'">'
       + '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" stroke="'+st+'" fill="var(--paper)" stroke-width="1.5"/>'
       + '<line x1="'+(cx-r-EXT)+'" y1="'+cy+'" x2="'+(cx+r+EXT)+'" y2="'+cy+'" '+cl+'/>'
       + '<line x1="'+cx+'" y1="'+(cy-r-EXT)+'" x2="'+cx+'" y2="'+(cy+r+EXT)+'" '+cl+'/>'
       // Extension lines from equator (cx±r, cy) DOWN to dly
       + '<line x1="'+(cx-r)+'" y1="'+cy+'" x2="'+(cx-r)+'" y2="'+(dly-2)+'" '+el+'/>'
       + '<line x1="'+(cx+r)+'" y1="'+cy+'" x2="'+(cx+r)+'" y2="'+(dly-2)+'" '+el+'/>'
       + '<line x1="'+(cx-r)+'" y1="'+dly+'" x2="'+(cx-dGap)+'" y2="'+dly+'" '+dl+'/>'
       + '<line x1="'+(cx+dGap)+'" y1="'+dly+'" x2="'+(cx+r)+'" y2="'+dly+'" '+dl+'/>'
       + '<path d="'+awL(cx-r,dly)+'" '+aw+'/>'
       + '<path d="'+awR(cx+r,dly)+'" '+aw+'/>'
       + '<text x="'+cx+'" y="'+dly+'" text-anchor="middle" dominant-baseline="central" '
       + 'font-size="9.5" fill="'+dim+'" font-family="'+sans+'">'+esc(dText)+'</text>'
       + '</svg>';
}



export function inline(text){
  let s = esc(text), sum = 0;

  // Инлайн-код `…`: вырезаем ПЕРВЫМ и возвращаем ПОСЛЕДНИМ. Содержимое дословно —
  // его не трогают ни деньги/формулы, ни **/*/==/~~ и авто-ссылки (как backtick-код
  // в стандартном Markdown). На месте — плейсхолдер вида «индекс» (частная зона
  // Юникода: не встречается в тексте и не ловится ни одной регуляркой ниже).
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (m, c) => `${codes.push(c) - 1}`);

  // Цена = число, стоящее прямо перед "грн". Определяем, есть ли перед этим
  // числом знак "=" (возможно с пробелами) — тогда цена идёт в Σ.
  // Иначе (тире, дефис, просто текст) — прочая цена, не в Σ.
  const C = LOCALE.currency;
  s = s.replace(RE.price,(m,esc,eq,dot,n,unit)=>{
    // "." или "," ВПЛОТНУЮ к числу (без оператора между) — это дробная часть
    // ("2.55 грн" — множитель), а не отдельная цена. Не трогаем.
    if(dot === '.' || dot === ',') return m;
    // Число может быть дробным («14322.56» / «14322,56») — пробелы это разряды,
    // запятая/точка внутри — десятичный разделитель.
    const v = parseFloat(n.replace(/\s/g,'').replace(',','.')) || 0;
    // Экранирование «\=» / «\:» — правило Σ НЕ срабатывает: оператор показываем
    // как обычный текст, цена идёт как прочая (вне Σ), сам слэш в рендер не идёт.
    if(esc && eq){
      return `${eq}<span class="price-other">${fmtNum(v)} ${C}${unit || ''}</span>`;
    }
    // "грн/шт", "грн./шт." — цена за штуку: показываем, но НЕ суммируем в Σ.
    if(unit) return `<span class="price-other">${fmtNum(v)} ${C}${unit}</span>`;
    // eq (группа 2) непусто, только если перед числом реально был "=" или ":".
    // Показываем ровно тот символ, что ввёл автор (":" остаётся ":", "=" — "=").
    if(eq){
      sum += Math.round((v + Number.EPSILON) * 100) / 100;
      const op = eq.trim() || '=';
      return `<span class="calc-eq">${op}</span> <span class="price-sum">${fmtNum(v)} ${C}</span>`;
    }
    return `<span class="price-other">${fmtNum(v)} ${C}</span>`;
  });

  // Калькулятор: «<выражение>=» → «выражение = результат».
  // Идёт ПОСЛЕ цен, чтобы обычные «= N грн» уже были обработаны и не считались
  // дважды. Требуется оператор или скобки (одиночное «123=» не трогаем). Формула
  // в исходнике не меняется. Если сразу за «=» стоит «грн» — результат становится
  // ценой в Σ (синий чип) и попадает в сумму, как обычные цены с «=».
  s = s.replace(RE.calc, (m, e, grn, unit, offset, whole) => {
    // требуется реальная операция (оператор/скобки или вычитание между числами/ссылками)
    if(!/[+*/%^()]/.test(e) && !/[\d\]]\s*-\s*[\d\[]/.test(e)) return m;
    const { numeric, unknown } = resolveRefs(e);
    if(unknown) return m;                            // неизвестная [ссылка] — не трогаем
    const r = calc(numeric);
    if(r === null) return m;
    const formula = `<span class="calc-formula">${refsToHtml(e.trim())}</span>`;
    const eq = ` <span class="calc-eq">=</span> `;
    // EXPORT: перед формулой в тексте часто уже стоит «=» («печать = 18400/…»).
    // Формулу мы вырезаем — чтобы не получить «= =», свой знак не ставим, если
    // предыдущий непробельный символ и так «=».
    const eqBefore = EXPORT && /=\s*$/.test(whole.slice(0, offset));
    const eqExp = eqBefore ? '' : '<span class="calc-eq">=</span> ';
    if(grn){
      // "грн/шт" — цена за штуку: показываем результат, но НЕ суммируем в Σ
      if(unit) return (EXPORT ? '' : formula + eq)
                     + `<span class="price-other">${fmtNum(r)} ${C}${unit}</span>`;
      sum += Math.round((r + Number.EPSILON) * 100) / 100;
      // EXPORT: формула вырезана по построению — клиент видит «= 17 250 грн»
      if(EXPORT) return `${eqExp}<span class="price-sum">${fmtNum(r)} ${C}</span>`;
      return `${formula}${eq}<span class="price-sum">${fmtNum(r)} ${C}</span>`;
    }
    if(EXPORT) return `<span class="calc-res">${fmtNum(r)}</span>`;
    return `${formula}${eq}<span class="calc-res">${fmtNum(r)}</span>`;
  });

  // Габарит [WxHunit]: вырезаем ДО varRef/perUnitExpand — иначе «57» из «[57x175мм]»
  // было бы принято как qty и делило бы ближайшее «Итого» на 57.
  const dimBoxes = [];
  RE_DIMBOX.lastIndex = 0;
  s = s.replace(RE_DIMBOX, (m, w, h, u, mods) => `${dimBoxes.push({kind:'rect', w, h, u, mods: mods||''}) - 1}`);
  RE_DIMCIRCLE.lastIndex = 0;
  s = s.replace(RE_DIMCIRCLE, (m, d, u) => `${dimBoxes.push({kind:'circle', d, u}) - 1}`);

  // Одиночная [ссылка] на переменную вне формулы — подставляем её значение.
  // «= [имя] грн» — как обычная цена с «=»: идёт в Σ; «[имя] грн» — прочая цена.
  // Строковая переменная подставляется текстом (url дальше авто-линкуется).
  // Неизвестные имена (шаблоны [4000 шт], [date] и т.п.) не трогаем.
  s = s.replace(RE.varRef, (m, eq, nm, grn, unit) => {
    const v = VARS[nm.trim()];
    if(v == null){
      const sv = SVARS[nm.trim()];
      if(sv == null) return m;
      return `${eq || ''}<span class="var-ref">${esc(sv)}</span>${grn || ''}`;
    }
    if(grn){
      if(unit) return `<span class="price-other">${fmtNum(v)} ${C}${unit}</span>`;
      if(eq){
        sum += Math.round((v + Number.EPSILON) * 100) / 100;
        const op = eq.trim() || '=';
        return `<span class="calc-eq">${op}</span> <span class="price-sum">${fmtNum(v)} ${C}</span>`;
      }
      return `<span class="price-other">${fmtNum(v)} ${C}</span>`;
    }
    return `${eq || ''}<span class="var-ref">${fmtVar(v)}</span>`;
  });

  // Умные подстановки (типографика best-practice) — только рендер/экспорт. В
  // «Исходнике» и симбиозе символы остаются как есть (инвариант И1), поэтому здесь,
  // а не в inlineSource(). Стоят ПОСЛЕ денег/переменных (не мешают Σ и лукапу
  // [имён]) и ДО авто-ссылок (не портят href). «<»/«>» уже экранированы в &lt;/&gt;,
  // так что стрелки ловят только текст автора, а не теги <span> от денег.
  s = s.replace(/&lt;-+&gt;/g, '↔')                       // <-> ↔
       .replace(/-+&gt;/g, '→')                           // ->  →  (как «→» в расчётах)
       .replace(/&lt;-+/g, '←')                           // <-  ←
       .replace(/(\d)(\s*)[xх](\s*)(?=\d)/g, '$1$2×$3')   // 10x15 / 10х15 → 10×15 (размеры)
       .replace(/\.\.\./g, '…')                           // ...  …
       .replace(/\([cCсС]\)/g, '©')                       // (c) ©
       .replace(/\([rR]\)/g, '®')                         // (r) ®
       .replace(/\([tT][mM]\)/g, '™')                     // (tm) ™
       // Допуск ±5 / ±0,5 мм: «+-»/«+/-» ТОЛЬКО как префикс значения (в начале, после
       // пробела или «(»). Перед цифрой/формулой («10+-5», «</span>+-5») не трогаем —
       // там это арифметика, калькулятор уже её посчитал выше.
       .replace(/(^|[\s(])\+\/?-(?=\s*[\d.,])/g, '$1±')
       // Единицы площади/объёма: «2»/«3» после строчной метрич. единицы → степень
       // (м2→м², см3→см³, m2→m²). Единица отделена не-буквами с обеих сторон, поэтому
       // «team2», «H2O», «BMW М3» (заглавная) и т.п. не трогаются.
       .replace(/(^|[^A-Za-zА-Яа-яЁёІіЇїЄєҐґ])(см|мм|км|дм|м|cm|mm|km|dm|m)([23])(?![\dA-Za-zА-Яа-яЁёІіЇїЄєҐґ])/g,
                (m0, pre, u, n) => pre + u + (n === '2' ? '²' : '³'));

  s = s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/==\s*([^=]+?)\s*==/g,'<mark>$1</mark>');
  s = s.replace(/~~([^~]+)~~/g,'<del>$1</del>');
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,'$1<em>$2</em>');
  // Двойные (жирные) стрелки — двухлинейные глифы, «жирный» аналог → ← ↔. Идут
  // ПОСЛЕ денег (calc/цена уже забрали свои «=») и ПОСЛЕ «==»-выделения (иначе съели
  // бы закрывающие «==»), но ДО авто-ссылок (не портим href). Теги <mark>/<strong>
  // используют настоящие «<»/«>», а мы ловим экранированные &lt;/&gt; — значит только
  // авторский текст, не разметку. «<= 500 грн» остаётся ценой в Σ (деньги важнее).
  s = s.replace(/&lt;=+&gt;/g,'⇔').replace(/=+&gt;/g,'⇒').replace(/&lt;=+/g,'⇐');
  s = s.replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>');

  // Возврат эскизов-габаритов: SVG-набросок с размерными стрелками.
  s = s.replace(/(\d+)/g, (m, i) => {
    const box = dimBoxes[+i];
    return box.kind === 'circle'
      ? buildDimCircleSVG(box.d, box.u)
      : buildDimSVG(box.w, box.h, box.u, box.mods || '');
  });

  // Возврат инлайн-кода: моноширинный чип в рамке (стили — .rendered code).
  s = s.replace(/(\d+)/g, (m, i) => `<code>${codes[+i]}</code>`);

  return { html: s, sum };
}

// Текст заголовка без инлайн-разметки — для свёрнутой шапки секции и ключа фолда.
function stripInline(s){
  return s.replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/==\s*([^=]+?)\s*==/g,'$1')
    .replace(/~~([^~]+)~~/g,'$1')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g,'$1$2')
    .replace(/`([^`]+)`/g,'$1')
    .trim();
}

// Полный рендер текста -> {html, blocks, stats}
// opts.mode === 'export' — санитайз-режим для документов наружу (см. EXPORT выше).
// blocks[] — по одному на верхнеуровневый узел, с метаданными (sum/done/checks/rows/
// declared/level/title) для компактного вида: groupBlocks() строит дерево секций и
// сворачивает их БЕЗ повторного парсинга (порт из рабочего референса BitrixUI).

// Эскиз ВНУТРИ текста (не единственный элемент) — абзац нужно изолировать через BFC,
// чтобы float не вытекал в соседние блоки. Standalone-эскиз (весь абзац — только SVG)
// не изолируем: его float пробивается в следующий абзац, давая газетное обтекание.
function hasDimboxWithText(html){
  if(!html.includes('r-dimbox')) return false;
  const rest = html.replace(/<svg[\s\S]*?<\/svg>/g,'').replace(/<[^>]+>/g,'').trim();
  return rest.length > 0;
}

export function render(text, opts){
  const lines = text.split('\n');
  EXPORT = !!(opts && opts.mode === 'export');
  VARS = {};                                   // переменные [имя] — заново на каждый рендер
  SVARS = {};                                  // строковые — тоже
  const blocks = [];                           // [{html, line, kind, level, sum, …}]
  let total = 0, checksTotal = 0, checksDone = 0, positions = 0;
  let sectionSum = 0;                          // сумма =-цен текущей секции (до ближайшего «Итого»)
  const add = v => { total += v; sectionSum += v; };
  const sections = [];                         // [{declared, sum}] — по одному на строку «Итого»
  let lastTotal = null;                        // сумма ближайшего сверху «Итого» — для шаблона [кільк. од.]
  // Шаблон [4000 шт] / [4,2 м.п.] → (сумма/кол-во грн/ед). База — ближайшее «Итого».
  // Кол-во может быть дробным (точка или запятая): [4.2 м.п.], [1 000,5 кг].
  const perUnitExpand = (h, base) => h.replace(
    /\[\s*(\d[\d\s]*(?:[.,]\d+)?)\s*([^\]\d\s][^\]]*?)\s*\]/g,
    (mm, q, unit) => {
      const qty = parseFloat(q.replace(/\s/g,'').replace(',', '.'));
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
  const emit = (h, kind, meta) => {
    if(hidden) return;
    const html = h.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, `<$1 data-line="${curLine}"`);
    blocks.push({ html, line: curLine, kind: kind || '', level: 0, sum: 0, done: 0,
      checks: 0, rows: 0, declared: null, title: '', titleHtml: '', count: 0, ...(meta || {}) });
  };

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
    if(hiddenBlock && /^\*\/$/.test(raw)){
      hiddenBlock = false; hidden = false;
      // В рабочем виде показываем сворачиваемый чип «🙈 внутренние расчёты (N)» —
      // автор видит, что себестоимость на месте и считается. В EXPORT — молчок.
      if(!EXPORT){
        const body = lines.slice(blockStart + 1, lineIdx).map(x => x.trim()).filter(Boolean);
        curLine = blockStart;
        // тело раскрытого чипа считаем через inline() — формулы/переменные
        // вычисляются (VARS уже заполнены выше по тексту). Сумму inline() НЕ
        // добавляем в Σ повторно — она уже учтена в цикле выше (hidden-строки).
        emit('<details class="r-hidden"><summary class="r-hidden-head">'
           + '<span class="r-hidden-eye" aria-hidden="true">🙈</span>'
           + `<span class="r-hidden-label">${esc(LOCALE.internal || 'внутренние расчёты')}</span>`
           + `<span class="r-hidden-n">(${body.length})</span></summary>`
           + `<div class="r-hidden-body">${body.map(l => inline(l).html).join('<br>')}</div></details>`,
          'hidden', { count: body.length });
      }
      continue;
    }
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
        let tb = '<table class="r-table">', tsum = 0;
        rows.forEach((rowLine, ri) => {
          const cells = rowLine.slice(1, -1).split('|').map(c => c.trim());
          tb += ri === 0 ? '<tr class="r-tr-head">' : '<tr>';
          for(const c of cells){ const r = inline(c); add(r.sum); tsum += r.sum; tb += `<td>${r.html}</td>`; }
          tb += '</tr>';
        });
        emit(tb + '</table>', 'table', { rows: Math.max(0, rows.length - 1), sum: tsum });
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
      emit(card + '</blockquote>', 'quote');
      lineIdx = j - 1;
      continue;
    }

    if(/^={3,}$/.test(t)){ emit('<hr class="r-hr2">', 'rule'); continue; }
    if(/^-{3,}$/.test(t)){ emit('<hr class="r-hr">', 'rule'); continue; }

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
        // EXPORT: объявление — внутренняя кухня, наружу не идёт (значения уже в VARS)
        if(!EXPORT){
          const isFormula = /[-+*/%^()]/.test(m[2]) || m[2].includes('[');
          emit(`<div class="r-var"><span class="var-name">[${esc(name)}]</span>`
                + (isFormula
                    ? ` <span class="calc-eq">=</span> <span class="var-formula">${refsToHtml(rhs)}</span>`
                      + ` <span class="calc-eq">→</span> <span class="var-val">${fmtVar(val)}</span>`
                    : ` <span class="calc-eq">=</span> <span class="var-val">${fmtVar(val)}</span>`)
                + `</div>`, 'var');
        }
        continue;
      }
      // Строковая переменная (Э2.2): RHS — не число и не формула. Хранит что
      // угодно, что помогает деньгам: url оплаты, IBAN, срок, условия.
      // «[имя] = ?» не трогаем — это будущие ?-вводные шаблонов (Э2.3).
      const sval = m[2].trim();
      if(name && sval !== '' && !/^\?/.test(sval)){
        SVARS[name] = sval;
        // EXPORT: объявление — внутренняя кухня (url уйдёт кнопкой, не строкой)
        if(!EXPORT){
          emit(`<div class="r-var"><span class="var-name">[${esc(name)}]</span>`
                + ` <span class="calc-eq">=</span> <span class="var-str">${esc(sval)}</span></div>`, 'var');
        }
        continue;
      }
      // не валидное объявление — падаем в обычную обработку ниже
    }
    if(m = t.match(/^(#{1,3})\s+(.*)$/)){
      const r = inline(m[2]); add(r.sum);
      emit(`<div class="r-h${m[1].length}">${r.html}</div>`, `h${m[1].length}`,
        { level: m[1].length, title: stripInline(m[2]), titleHtml: r.html, sum: r.sum }); continue;
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
            + `</div>`, 'check', { done: done ? 1 : 0, checks: 1, sum: r.sum });
      continue;
    }
    if(m = t.match(/^(!!?)\s+(.*)$/)){
      const r = inline(m[2]); add(r.sum);
      const strong = m[1] === '!!';
      emit(`<div class="r-callout${strong?' strong':''}">`
            + `<span class="r-callout-ico">${strong?ICO.danger:ICO.warn}</span>`
            + `<span>${r.html}</span></div>`, 'callout', { sum: r.sum }); continue;
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
      emit(`<div class="r-total">${parts.join(' ')}</div>`, 'total', { declared: declaredHere });
      sections.push({ declared: declaredHere, sum: sec });
      lastTotal = effTotal;                     // для [кільк.] на следующих строках
      sectionSum = 0;                           // начинаем новую секцию
      continue;
    }
    if(m = t.match(/^(\d+)\.\s+(.*)$/)){
      const r = inline(m[2]); add(r.sum);
      const nc = hasDimboxWithText(r.html) ? 'r-num r-num-hd' : 'r-num';
      emit(`<div class="${nc}">${m[1]}. ${r.html}</div>`, 'num', { sum: r.sum }); continue;
    }
    if(m = t.match(/^[-*]\s+(.*)$/)){
      const r = inline(m[1]); add(r.sum);
      const lc = hasDimboxWithText(r.html) ? 'r-li r-li-hd' : 'r-li';
      emit(`<div class="${lc}">${r.html}</div>`, 'li', { sum: r.sum }); continue;
    }
    const r = inline(t); add(r.sum);
    const ph = perUnitExpand(r.html, lastTotal);
    // обычный текст — без маркера списка; [кільк.] раскрывается по ближайшему «Итого»
    const pc = hasDimboxWithText(ph) ? 'r-p r-p-hd' : 'r-p';
    emit(`<div class="${pc}">${ph}</div>`, 'text', { sum: r.sum });
  }

  // «/*» без пары спрятал бы весь хвост заметки молча — говорим об этом вслух.
  // В EXPORT молчим: предупреждение — для автора, а не для клиента.
  if(hiddenBlock && !EXPORT){
    hidden = false; curLine = blockStart;
    const msg = String(LOCALE.unclosed || '').replace('{n}', blockStart + 1);
    emit(`<div class="r-callout strong"><span class="r-callout-ico">${ICO.danger}</span><span>${esc(msg)}</span></div>`, 'callout');
  }
  const html = blocks.map(b => b.html).join('');

  // объявленные "Итого" (может быть несколько секций) — суммируем все
  let declared = null, declaredSum = 0, hasDeclared = false;
  RE.declared.lastIndex = 0;
  for(const mm of text.matchAll(RE.declared)){
    declaredSum += parseFloat(mm[1].replace(/\s/g,'').replace(',','.'))||0;
    hasDeclared = true;
  }
  if(hasDeclared) declared = declaredSum;

  // Считаем позиции по тексту БЕЗ строк «Итого» — теперь, когда «:» тоже цена в Σ,
  // строка «Итого: N грн» иначе засчиталась бы как отдельная позиция (её сумма
  // учитывается отдельно, как сверка секции, а не как позиция).
  const countText = lines.filter(l => !RE.totalLine.test(l.trim())).join('\n');
  positions = (countText.match(RE.posPrice)||[]).length // цены =/: N грн (кроме /шт)
            + (countText.match(RE.posCalc)||[]).length;  // калькулятор = грн (кроме /шт)
  RE.posVar.lastIndex = 0;
  for(const mm of countText.matchAll(RE.posVar))         // =/: [переменная] грн (кроме /шт)
    if(VARS[mm[1].trim()] != null) positions++;

  // Метаданные денежной петли (Э1.3): спец-переменные → кнопки «Принять/Оплатить»
  // в экспорте. Имена локализуемы (LOCALE.*Var) + постоянные EN-алиасы.
  const normName = s => String(s).trim().toLowerCase();
  const lookupVar = (...names) => {
    const set = names.filter(Boolean).map(normName);
    for(const k in SVARS) if(set.includes(normName(k))) return SVARS[k];
    for(const k in VARS)  if(set.includes(normName(k))) return VARS[k];
    return null;
  };
  const payUrl     = lookupVar(LOCALE.payVar, 'pay', 'payment', 'оплата');
  const depositRaw = lookupVar(LOCALE.depositVar, 'deposit', 'депозит');
  const validUntil = lookupVar(LOCALE.validVar, 'valid until', 'действительна до');
  const email      = lookupVar(LOCALE.emailVar, 'email', 'e-mail');
  const pay = {
    url:        typeof payUrl === 'string' ? payUrl : null,
    // депозит: число ≤ 1 — доля от итога («30%» → 0.3), > 1 — фикс-сумма
    deposit:    typeof depositRaw === 'number' && depositRaw > 0 ? depositRaw : null,
    validUntil: typeof validUntil === 'string' ? validUntil : null,
    email:      typeof email === 'string' ? email : null,
  };

  return {
    html,
    blocks,
    stats: { total, checksTotal, checksDone, positions, declared, sections, pay },
    checkLineMap,
    fmt
  };
}

export { fmt };

// ─────────────────────────────────────────────────────────────────────────────
// СВОРАЧИВАНИЕ СЕКЦИЙ (компактный вид, порт из BitrixUI/specEngine). Заголовок
// #/##/### владеет всем до следующего заголовка того же/высшего уровня; свод (roll)
// по потомкам даёт «деньги/чек-боксы/параметры» для свёрнутой шапки без повторного
// парсинга. Состояние свёрнутости — вне текста (localStorage в main.js), формат
// .md о нём не знает. Строку-подпись шапки строит main.js (локализация).
// ─────────────────────────────────────────────────────────────────────────────
function addRoll(r, b){
  r.sum += b.sum; r.done += b.done; r.checks += b.checks; r.rows += b.rows; r.blocks += 1;
  if(b.kind === 'total' && b.declared != null) r.declared = (r.declared ?? 0) + b.declared;
}
// blocks[] -> дерево узлов: {block} | {section:{key,header,level,children,roll}}.
// Ключ секции — текст заголовка (при повторах — суффикс #N): стабилен к правкам выше.
export function groupBlocks(blocks){
  const root = [];
  const stack = [];
  const seen = new Map();
  for(const b of blocks){
    const lvl = b.level;
    if(lvl > 0){
      while(stack.length && stack[stack.length - 1].level >= lvl) stack.pop();
      for(const anc of stack) addRoll(anc.roll, b);
      const base = b.title || `h${lvl}`;
      const n = seen.get(base) ?? 0; seen.set(base, n + 1);
      const key = n ? `${base}#${n}` : base;
      const sec = { key, header: b, level: lvl, children: [],
        roll: { sum: 0, done: 0, checks: 0, rows: 0, blocks: 0, declared: null } };
      (stack.length ? stack[stack.length - 1].children : root).push({ section: sec });
      stack.push(sec);
    } else {
      for(const anc of stack) addRoll(anc.roll, b);
      (stack.length ? stack[stack.length - 1].children : root).push({ block: b });
    }
  }
  return root;
}
// Ключи всех секций (для «свернуть всё»).
export function allSectionKeys(nodes, out = []){
  for(const n of nodes)
    if(n.section){ out.push(n.section.key); allSectionKeys(n.section.children, out); }
  return out;
}
// Ключи «длинных» секций — эвристика первого открытия на телефоне: вложенная
// (##/###) секция > 10 блоков или таблица > 4 рядов сворачивается по умолчанию.
// Секции 1-го уровня не трогаем — иначе спрячется весь документ.
export function longSectionKeys(nodes, out = []){
  for(const n of nodes)
    if(n.section){
      if(n.section.level >= 2 && (n.section.roll.blocks > 10 || n.section.roll.rows > 4))
        out.push(n.section.key);
      longSectionKeys(n.section.children, out);
    }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// СИМБИОЗ-РЕДАКТОР: построчный рендер ИСХОДНИКА с подсветкой (порт из BitrixUI).
// Одна строка источника = один <div data-line>. Разметка видна серым (.ed-syn),
// текст сразу оформляется (жирный/курсив/цены), НО остаётся сырым.
//
// ИНВАРИАНТ И1: textContent строки == исходная строка. Поэтому:
//  • SVG-иконки/виджеты — contenteditable=false и без текста (не влияют на textContent);
//  • числа НЕ переформатируем, вычисления НЕ подставляем (это только в render());
//  • маркеры (#, **, //, [x]) остаются реальными символами, лишь красятся серым.
// Благодаря И1 правки читаются назад простым обходом textContent, а курсор
// восстанавливается по {строка, смещение}. Вычисленные результаты и Σ — в
// режиме просмотра render() и в футере; здесь их нет (симбиоз = разметка+формат).
// ЗАМЕЧАНИЕ: строки трактуются trim-нутыми (ведущие/хвостовые пробелы строки
// нормализуются при правке в симбиозе) — как и в render(); точный пробел — в «Исходнике».
const edSyn = s => `<span class="ed-syn">${esc(s)}</span>`;

// Инлайн для редактора: маркеры сохраняем (серым), внутренний текст оформляем,
// всё дословно (textContent == исходная строка).
function inlineSource(text){
  let s = esc(text);
  // инлайн-код `…`: содержимое вырезаем (плейсхолдер), маркеры-кавычки покажем серым,
  // тело — как <code>. textContent строки при этом остаётся исходным (инвариант И1).
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (m, c) => `${codes.push(c) - 1}`);
  // цена: весь фрагмент дословно в чип; counted (синий), если «=»/«:» и без «\».
  s = s.replace(RE.price, (m, edEsc, eq, dot) => {
    if(dot === '.' || dot === ',') return m;          // дробная часть — не цена
    const counted = !!eq && !edEsc;
    return `<span class="ed-money${counted ? ' counted' : ''}">${m}</span>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, `${edSyn('**')}<strong>$1</strong>${edSyn('**')}`);
  s = s.replace(/==([^=]+)==/g,     `${edSyn('==')}<mark>$1</mark>${edSyn('==')}`);
  s = s.replace(/~~([^~]+)~~/g,     `${edSyn('~~')}<del>$1</del>${edSyn('~~')}`);
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, `$1${edSyn('*')}<em>$2</em>${edSyn('*')}`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<span class="ed-link">$1</span>');
  s = s.replace(/(\d+)/g, (m, i) =>
    edSyn('`') + `<code>${codes[+i]}</code>` + edSyn('`'));
  return s;
}

// Один <div> на строку источника (включая пустые) — для contenteditable-редактора.
export function renderSourceLines(text){
  const lines = text.split('\n');
  let out = '';
  let hiddenBlock = false;
  for(let i = 0; i < lines.length; i++){
    const t = lines[i].trim();
    const dl = `data-line="${i}"`;
    if(t === ''){ out += `<div ${dl}><br></div>`; continue; }

    // скрытый блок /* … */ — показываем сырьём, приглушённо
    if(!hiddenBlock && /^\/\*/.test(t)){ hiddenBlock = true; out += `<div ${dl} class="ed-line ed-hidden">${edSyn(t)}</div>`; continue; }
    if(hiddenBlock){
      const close = /^\*\/$/.test(t);
      out += `<div ${dl} class="ed-line ed-hidden">${edSyn(t)}</div>`;
      if(close) hiddenBlock = false;
      continue;
    }
    let m;
    if(m = t.match(/^(\/\/\s?)(.*)$/)){ out += `<div ${dl} class="ed-line ed-hidden">${edSyn(m[1])}${inlineSource(m[2])}</div>`; continue; }

    if(/^={3,}$/.test(t)){ out += `<div ${dl} class="ed-line ed-rule heavy">${edSyn(t)}</div>`; continue; }
    if(/^-{3,}$/.test(t)){ out += `<div ${dl} class="ed-line ed-rule">${edSyn(t)}</div>`; continue; }

    if(m = t.match(RE_VARDEF)){
      out += `<div ${dl} class="ed-line r-var">${edSyn('[' + m[1] + ']')} ${edSyn('= ')}<span class="var-formula">${esc(m[2])}</span></div>`;
      continue;
    }
    if(m = t.match(/^(#{1,3})(\s+)(.*)$/)){
      out += `<div ${dl} class="ed-line r-h${m[1].length}">${edSyn(m[1] + m[2])}${inlineSource(m[3])}</div>`;
      continue;
    }
    if(m = t.match(/^\[([ xX])\](\s*)(.*)$/)){
      const done = m[1].toLowerCase() === 'x';
      out += `<div ${dl} class="ed-line r-check${done ? ' done' : ''}">`
        + `<span class="box" data-toggle="${i}" contenteditable="false">${done ? ICO.check : ''}</span>`
        + `${edSyn('[' + m[1] + ']' + m[2])}<span class="txt">${inlineSource(m[3])}</span></div>`;
      continue;
    }
    if(m = t.match(/^(!!?)(\s+)(.*)$/)){
      const strong = m[1] === '!!';
      out += `<div ${dl} class="ed-line r-callout${strong ? ' strong' : ''}">`
        + `<span class="r-callout-ico" contenteditable="false">${strong ? ICO.danger : ICO.warn}</span>`
        + `${edSyn(m[1] + m[2])}<span>${inlineSource(m[3])}</span></div>`;
      continue;
    }
    if(m = t.match(RE.totalLine)){
      out += `<div ${dl} class="ed-line r-total"><b>${esc(m[1])}${m[2] || ''}</b> ${inlineSource(m[3])}</div>`;
      continue;
    }
    if(m = t.match(/^(\d+\.)(\s+)(.*)$/)){
      out += `<div ${dl} class="ed-line r-num">${esc(m[1] + m[2])}${inlineSource(m[3])}</div>`;
      continue;
    }
    if(m = t.match(/^([-*])(\s+)(.*)$/)){
      out += `<div ${dl} class="ed-line r-li">${edSyn(m[1] + m[2])}${inlineSource(m[3])}</div>`;
      continue;
    }
    if(/^\|.*\|$/.test(t)){ out += `<div ${dl} class="ed-line ed-table">${esc(t)}</div>`; continue; }
    if(m = t.match(/^(>\s?)(.*)$/)){ out += `<div ${dl} class="ed-line ed-quote">${edSyn(m[1])}${inlineSource(m[2])}</div>`; continue; }

    out += `<div ${dl} class="ed-line r-p">${inlineSource(t)}</div>`;
  }
  return out;
}
