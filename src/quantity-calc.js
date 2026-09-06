// Калькулятор величин с произвольными единицами измерения — «50 шт + 50 шт =»,
// «3720 грн - 10% =», «100 м2 - 25 м2 =». Отдельный от calc() (см. parser.js) движок:
// calc() остаётся безразмерным (числа/проценты), этот модуль умеет проносить единицу
// измерения через + - * / и % и проверяет их совместимость. См.
// docs/quantity-aware-calculator-plan.md — контракт и грамматика описаны там.
//
// parseQuantityExpression() запускается РАНЬШЕ calc()/RE.price в inline() и забирает
// только те «…=» выражения, где хотя бы один операнд несёт единицу измерения (число или
// [переменная], написанные через пробел с текстом единицы: «50 шт», «100 A3+», «10 грн/шт»).
// Если единицы нигде нет — возвращает null, и строка уходит в старый calc() без изменений.
// Так же null возвращается, если операторы в выражении с единицей написаны слитно
// («50 шт+50 шт=») — по грамматике (см. план, §4) такое не распознаётся как typed-выражение.

const NUMBER_RE = /^\d+(?:[  ]\d{3})*(?:[.,]\d+)?/;
const PRIMARY_START_RE = /\d+(?:[  ]\d{3})*(?:[.,]\d+)?|\[[^\]\n]+\]/g;
const MAX_UNIT_LEN = 64;

export class QuantityCalcError extends Error {
  constructor(code, info) { super(code); this.code = code; this.info = info || null; }
}

function parseNumberToken(tok) {
  return parseFloat(tok.replace(/[  ]/g, '').replace(',', '.'));
}

// unitKey — только для сравнений («м2» ≠ «м²», алиасов нет, см. план §4).
export function normalizeUnitKey(unitRaw) {
  return String(unitRaw)
    .normalize('NFKC')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function makeParser(str, resolveVariable) {
  let i = 0;
  let sawUnit = false;
  let usedOperator = false;

  function skipSpaces() { while (i < str.length && /[ \t ]/.test(str[i])) i++; }

  function matchNumber() {
    const m = NUMBER_RE.exec(str.slice(i));
    return (m && m.index === 0) ? m[0] : null;
  }

  // Единица сразу после числа/переменной: одно «слово» без пробелов (см. план §4 —
  // на практике все примеры однословные: «шт», «м2», «A3+», «грн/шт»). Пробел перед
  // единицей уже проверен и пропущен вызывающим. Не читаем единицу, если дальше явно
  // начинается « + »/« - »/« * »/« / » (это разделитель перед оператором) или ')'/конец.
  function tryReadUnit() {
    if (i >= str.length) return null;
    if (/^[+\-*/]\s/.test(str.slice(i))) return null;
    if (str[i] === ')') return null;
    const m = /^[^\s]+/.exec(str.slice(i));
    if (!m) return null;
    const raw = m[0];
    if (raw.length === 0 || raw.length > MAX_UNIT_LEN) return null;
    i += raw.length;
    return raw;
  }

  function tryConsumeOperator(chars) {
    const save = i;
    skipSpaces();
    if (i === save || i >= str.length || chars.indexOf(str[i]) === -1) { i = save; return null; }
    const op = str[i];
    i++;
    const beforeTrailing = i;
    skipSpaces();
    if (i === beforeTrailing) { i = save; return null; } // оператор без пробела после — не наша операция
    return op;
  }

  function combineAdd(L, R, op) {
    if (L.kind === 'percent') L = { kind: 'scalar', value: L.value / 100 };
    if (R.kind === 'percent') {
      const delta = L.value * (R.value / 100);
      return { ...L, value: op === '+' ? L.value + delta : L.value - delta };
    }
    if (L.kind === 'scalar' && R.kind === 'scalar')
      return { kind: 'scalar', value: op === '+' ? L.value + R.value : L.value - R.value };
    if (L.kind === 'quantity' && R.kind === 'quantity') {
      if (L.unitKey !== R.unitKey)
        throw new QuantityCalcError('quantity_unit_mismatch', { a: L.unitRaw, b: R.unitRaw });
      return { kind: 'quantity', value: op === '+' ? L.value + R.value : L.value - R.value,
        unitRaw: L.unitRaw, unitKey: L.unitKey };
    }
    // величина ± число без единицы (в любом порядке)
    throw new QuantityCalcError('quantity_invalid_operation', { reason: 'add_scalar_to_quantity' });
  }

  function combineMul(L, R, op) {
    if (L.kind === 'percent') L = { kind: 'scalar', value: L.value / 100 };
    if (R.kind === 'percent') {
      const factor = R.value / 100;
      if (op === '/' && factor === 0) throw new QuantityCalcError('quantity_division_by_zero');
      return { ...L, value: op === '*' ? L.value * factor : L.value / factor };
    }
    if (op === '*') {
      if (L.kind === 'scalar' && R.kind === 'scalar') return { kind: 'scalar', value: L.value * R.value };
      if (L.kind === 'quantity' && R.kind === 'scalar')
        return { kind: 'quantity', value: L.value * R.value, unitRaw: L.unitRaw, unitKey: L.unitKey };
      if (L.kind === 'scalar' && R.kind === 'quantity')
        return { kind: 'quantity', value: L.value * R.value, unitRaw: R.unitRaw, unitKey: R.unitKey };
      throw new QuantityCalcError('quantity_invalid_operation', { reason: 'mul_quantities' });
    }
    // op === '/'
    if (L.kind === 'scalar' && R.kind === 'scalar') {
      if (R.value === 0) throw new QuantityCalcError('quantity_division_by_zero');
      return { kind: 'scalar', value: L.value / R.value };
    }
    if (L.kind === 'quantity' && R.kind === 'scalar') {
      if (R.value === 0) throw new QuantityCalcError('quantity_division_by_zero');
      return { kind: 'quantity', value: L.value / R.value, unitRaw: L.unitRaw, unitKey: L.unitKey };
    }
    throw new QuantityCalcError('quantity_invalid_operation', { reason: 'div_quantities' });
  }

  function primary() {
    skipSpaces();
    if (str[i] === '(') {
      i++;
      const inner = sum();
      skipSpaces();
      if (str[i] !== ')') throw new QuantityCalcError('quantity_syntax_error');
      i++;
      if (str[i] === '%') { i++; return { kind: 'percent', value: inner.value }; }
      return inner;
    }
    if (str[i] === '[') {
      const m = /^\[([^\]\n]+)\]/.exec(str.slice(i));
      if (!m) throw new QuantityCalcError('quantity_syntax_error');
      i += m[0].length;
      const name = m[1].trim();
      if (str[i] === '%') {
        i++;
        const v = resolveVariable(name);
        if (v == null) throw new QuantityCalcError('quantity_unknown_variable', { name });
        return { kind: 'percent', value: v };
      }
      const before = i;
      skipSpaces();
      const unit = (i > before) ? tryReadUnit() : null;
      if (unit) {
        sawUnit = true;
        const v = resolveVariable(name);
        if (v == null) throw new QuantityCalcError('quantity_unknown_variable', { name });
        return { kind: 'quantity', value: v, unitRaw: unit, unitKey: normalizeUnitKey(unit) };
      }
      i = before;
      const v = resolveVariable(name);
      if (v == null) throw new QuantityCalcError('quantity_unknown_variable');
      return { kind: 'scalar', value: v };
    }
    const numTok = matchNumber();
    if (!numTok) throw new QuantityCalcError('quantity_syntax_error');
    i += numTok.length;
    const value = parseNumberToken(numTok);
    if (str[i] === '%') { i++; return { kind: 'percent', value }; }
    const before = i;
    skipSpaces();
    const unit = (i > before) ? tryReadUnit() : null;
    if (unit) {
      sawUnit = true;
      return { kind: 'quantity', value, unitRaw: unit, unitKey: normalizeUnitKey(unit) };
    }
    i = before;
    return { kind: 'scalar', value };
  }

  function product() {
    let left = primary();
    for (;;) {
      const op = tryConsumeOperator('*/');
      if (!op) break;
      usedOperator = true;
      const right = primary();
      left = combineMul(left, right, op);
    }
    return left;
  }

  function sum() {
    let left = product();
    for (;;) {
      const op = tryConsumeOperator('+-');
      if (!op) break;
      usedOperator = true;
      const right = product();
      left = combineAdd(left, right, op);
    }
    return left;
  }

  return {
    get sawUnit() { return sawUnit; },
    run() {
      const value = sum();
      skipSpaces();
      if (i !== str.length) return null;   // не разобрали весь кандидат — не наше выражение
      if (!usedOperator) return null;      // без операции (как и в calc()) — не трогаем
      return value;
    },
  };
}

// parseQuantityExpression(source, resolveVariable) → null | QuantityCalcResult
//   null                    — кандидата нет вовсе (нет «=», или выражение целиком
//                             безразмерное/некорректно расставлены пробелы) — строка
//                             уходит в старый calc() без изменений и без диагностики.
//   { ok:true,  ... }       — распознано и вычислено.
//   { ok:false, code, ... } — распознано (единица встретилась), но вычислить нельзя —
//                             это диагностика для автора (см. план §10).
// resolveVariable(name) должен вернуть number для известной числовой переменной,
// иначе null/undefined.
export function parseQuantityExpression(source, resolveVariable) {
  const eqIdx = source.lastIndexOf('=');
  if (eqIdx === -1) return null;
  const candidate = source.slice(0, eqIdx);
  if (!/\d/.test(candidate)) return null;

  const starts = [];
  PRIMARY_START_RE.lastIndex = 0;
  let sm;
  while ((sm = PRIMARY_START_RE.exec(candidate))) starts.push(sm.index);

  for (const start of starts) {
    const str = candidate.slice(start);
    const parser = makeParser(str, resolveVariable);
    let result;
    try {
      result = parser.run();
    } catch (e) {
      if (e instanceof QuantityCalcError) {
        if (parser.sawUnit) return { ok: false, code: e.code, info: e.info || null, start, end: eqIdx + 1 };
        continue; // безразмерная ветка не разобралась — пробуем начало правее
      }
      throw e;
    }
    if (result === null) continue;         // не полный разбор или нет оператора — пробуем дальше
    if (!parser.sawUnit) return null;       // чистый scalar/percent — отдаём calc()
    return { ok: true, source: source.slice(start, eqIdx + 1), value: result, start, end: eqIdx + 1 };
  }
  return null;
}

// Форматирование результата (план §5): валюта — ровно 2 знака; остальные единицы —
// максимум 6 знаков без хвостовых нулей; внутренние вычисления — полная точность Number.
export function formatQuantityNumber(value, isCurrency) {
  if (isCurrency) {
    const r = Math.round((value + Number.EPSILON) * 100) / 100;
    return r.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const r = Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  return r.toLocaleString('ru-RU', { maximumFractionDigits: 6 });
}
