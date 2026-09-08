// Размерный эскиз [WxHед] / [dNед] — пропорциональный набросок изделия с
// размерными стрелками (визитка, листовка, этикетка). Чистая функция без DOM и
// без зависимостей — одинаковая на всех платформах и в экспорте.
//
// Это СУПЕРСЕТ модуля BitrixUI (frontend/src/lib/dimensionSketch.ts):
//   • та же геометрия v2: viewBox 240×164, стрелки через <marker>, вся покраска
//     только CSS-классами sketch-* (ни одного inline-цвета — иначе тёмная тема и
//     экспорт ломаются), подписи вылета/радиуса рисуются в самом SVG, в
//     aria-label — «словесная» единица («миллиметров»);
//   • + опция `cross` (по умолчанию false) — диагональный X-крест по листу,
//     фирменная черта Notatnyk (коммит ac04c23). BitrixUI оставляет false, его
//     снапшоты при backport меняются только ключом версии;
//   • + при `fold` вместе с `cross` — свой X-крест в каждой фальц-панели
//     (коммит bc4d826), а не один на весь лист;
//   • + ориентация линии сгиба зависит от пропорций: портрет (h > w) —
//     горизонтальный сгиб, пейзаж/квадрат — вертикальный (как в Notatnyk).
//
// Версия — общий визуальный контракт с BitrixUI. Менять синхронно в обоих
// проектах и регенерировать снапшоты.
export const DIMENSION_SKETCH_VERSION = '2.1.0';

/**
 * @typedef {Object} DimensionSketchInput
 * @property {'rect'|'circle'} shape
 * @property {number} [width]        ширина (для rect)
 * @property {number} [height]       высота (для rect)
 * @property {number} [diameter]     диаметр (для circle)
 * @property {string} unit           единица как её ввёл автор ('мм','mm','см',…)
 * @property {number} [bleed]        зона вылета, ед. (пунктирная внешняя рамка)
 * @property {number} [cornerRadius] скругление углов, ед. (только rect)
 * @property {boolean} [fold]        линия сгиба (биговка)
 * @property {boolean} [cross]       диагональный X-крест по листу (Notatnyk)
 */

/**
 * @typedef {Object} DimensionSketchI18n
 * @property {(unitRaw: string) => string} [spoken] единица прописью для aria-label
 * @property {string} [rect]   «Прямоугольник»
 * @property {string} [by]     «на» (между шириной и высотой)
 * @property {string} [circle] «Круг диаметром»
 * @property {string} [bleed]  «вылет» (в aria-label)
 * @property {string} [radius] «радиус» (в aria-label)
 * @property {string} [fold]   «линия сгиба» (в aria-label)
 * @property {string} [diameterMark] знак диаметра в подписи SVG ('Ø')
 * @property {string} [bleedPlus]    префикс подписи вылета в SVG («вылет +»)
 * @property {string} [radiusWord]   префикс подписи радиуса в SVG («радиус »)
 */

const spokenUk = (unitRaw) => {
  const u = String(unitRaw).toLowerCase();
  if (['мм', 'mm'].includes(u)) return 'міліметрів';
  if (['см', 'cм', 'cm', 'sm'].includes(u)) return 'сантиметрів';
  if (['дм', 'dm'].includes(u)) return 'дециметрів';
  if (['м', 'm'].includes(u)) return 'метрів';
  return String(unitRaw);
};
const spokenRu = (unitRaw) => {
  const u = String(unitRaw).toLowerCase();
  if (['мм', 'mm'].includes(u)) return 'миллиметров';
  if (['см', 'cм', 'cm', 'sm'].includes(u)) return 'сантиметров';
  if (['дм', 'dm'].includes(u)) return 'дециметров';
  if (['м', 'm'].includes(u)) return 'метров';
  return String(unitRaw);
};
const spokenEn = (unitRaw) => {
  const u = String(unitRaw).toLowerCase();
  if (['мм', 'mm'].includes(u)) return 'millimeters';
  if (['см', 'cм', 'cm', 'sm'].includes(u)) return 'centimeters';
  if (['дм', 'dm'].includes(u)) return 'decimeters';
  if (['м', 'm'].includes(u)) return 'meters';
  return String(unitRaw);
};

// Дефолт — украинский, БАЙТ-В-БАЙТ со снапшотом BitrixUI (frontend/src/lib/
// __tests__/__snapshots__/dimensionSketch.test.ts.snap) для cross:false без fold.
/** @type {Required<DimensionSketchI18n>} */
const DEFAULT_I18N = {
  spoken: spokenUk,
  rect: 'Прямокутник',
  by: 'на',
  circle: 'Коло діаметром',
  bleed: 'виліт',
  radius: 'радіус',
  fold: 'лінія згину',
  diameterMark: 'Ø',
  bleedPlus: 'виліт +',
  radiusWord: 'радіус ',
};

// Готовые языковые пресеты (i18n-параметр для renderDimensionSketch). Приложение
// Notatnyk выбирает по LOCALE.lang (см. parser.js). `diameterMark` = 'Ø' для всех.
export const DIM_SKETCH_I18N = {
  uk: DEFAULT_I18N,
  ru: {
    spoken: spokenRu,
    rect: 'Прямоугольник', by: 'на', circle: 'Круг диаметром',
    bleed: 'вылет', radius: 'радиус', fold: 'линия сгиба',
    diameterMark: 'Ø', bleedPlus: 'вылет +', radiusWord: 'радиус ',
  },
  en: {
    spoken: spokenEn,
    rect: 'Rectangle', by: 'by', circle: 'Circle, diameter',
    bleed: 'bleed', radius: 'radius', fold: 'fold line',
    diameterMark: 'Ø', bleedPlus: 'bleed +', radiusWord: 'radius ',
  },
};

// Округление до 0.1 — как в v2 (совпадение снапшотов).
const n = (v) => Math.round(v * 10) / 10;
// Число для подписи: точка → запятая (десятичная как в тексте автора).
const label = (v) => String(v).replace('.', ',');
// Экранирование значения атрибута (aria-label собирается из текста автора).
const attr = (v) => String(v).replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[c]));

// id <marker> — детерминированный хеш входа. `cross` В КЛЮЧ НЕ ВХОДИТ намеренно:
// стрелка от него не зависит, а так снапшоты BitrixUI (cross:false) при backport
// остаются с теми же id.
function markerId(input) {
  const key = [
    input.shape, input.width, input.height, input.diameter,
    input.unit, input.bleed, input.cornerRadius, input.fold ? 1 : 0,
  ].join('-');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return `dim-arrow-${Math.abs(hash).toString(36)}`;
}

function defs(id) {
  return `<defs><marker id="${id}" markerWidth="6" markerHeight="6" refX="6" refY="3" `
    + `orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs>`;
}

/**
 * @param {DimensionSketchInput} input
 * @param {DimensionSketchI18n} [i18n] частичный оверрайд подписей/aria
 * @returns {string} строка SVG (класс r-dimbox / r-dimbox r-dimbox-circle)
 */
export function renderDimensionSketch(input, i18n) {
  const t = { ...DEFAULT_I18N, ...(i18n || {}) };
  const unit = attr(input.unit);
  const spoken = t.spoken(input.unit);
  const bleed = Math.max(0, input.bleed ?? 0);
  const radius = Math.max(0, input.cornerRadius ?? 0);
  const arrow = markerId(input);

  if (input.shape === 'circle') {
    const diameter = Math.max(0.01, input.diameter ?? 0);
    const cx = 126, cy = 79, r = 45;
    const bleedOffset = bleed ? Math.min(8, 3 + bleed) : 0;
    const aria = `${t.circle} ${label(diameter)} ${spoken}`
      + (bleed ? `, ${t.bleed} ${label(bleed)} ${spoken}` : '');
    return `<svg class="r-dimbox r-dimbox-circle" viewBox="0 0 240 164" role="img" `
      + `aria-label="${attr(aria)}" xmlns="http://www.w3.org/2000/svg">${defs(arrow)}`
      + (bleed ? `<circle cx="${cx}" cy="${cy}" r="${r + bleedOffset}" class="sketch-bleed"/>` : '')
      + `<circle cx="${cx}" cy="${cy}" r="${r}" class="sketch-shape"/>`
      // Центровой крест — только с cross (черта Notatnyk); чуть выходит за окружность.
      + (input.cross
          ? `<path d="M${cx - r - 6} ${cy}h${2 * r + 12}M${cx} ${cy - r - 6}v${2 * r + 12}" class="sketch-cross"/>`
          : '')
      + `<path d="M${cx - r} 18h${r * 2}" class="sketch-dimension" `
      + `marker-start="url(#${arrow})" marker-end="url(#${arrow})"/>`
      + `<path d="M${cx - r} 23v-10M${cx + r} 23v-10" class="sketch-helper"/>`
      + `<text x="${cx}" y="12" text-anchor="middle">${t.diameterMark} ${label(diameter)} ${unit}</text>`
      + (bleed ? `<text x="${cx}" y="154" text-anchor="middle">${t.bleedPlus}${label(bleed)} ${unit}</text>` : '')
      + `</svg>`;
  }

  const width = Math.max(0.01, input.width ?? 0);
  const height = Math.max(0.01, input.height ?? 0);
  const scale = Math.min(154 / width, 94 / height);
  const boxWidth = Math.max(18, n(width * scale));
  const boxHeight = Math.max(18, n(height * scale));
  const x = n(126 - boxWidth / 2), y = n(79 - boxHeight / 2);
  const x2 = n(x + boxWidth), y2 = n(y + boxHeight);
  const cx = n(x + boxWidth / 2), cy = n(y + boxHeight / 2);
  const bleedOffset = bleed ? Math.min(8, 3 + bleed) : 0;
  const rx = radius ? Math.min(n(radius * scale), Math.min(boxWidth, boxHeight) / 3) : 0;

  // Портрет складывается по горизонтали, пейзаж/квадрат — по вертикали.
  const foldH = input.fold && height > width;
  const aria = `${t.rect} ${label(width)} ${t.by} ${label(height)} ${spoken}`
    + (bleed ? `, ${t.bleed} ${label(bleed)} ${spoken}` : '')
    + (radius ? `, ${t.radius} ${label(radius)} ${spoken}` : '')
    + (input.fold ? `, ${t.fold}` : '');

  let crossPath = '';
  if (input.cross) {
    if (!input.fold) {
      crossPath = `M${x} ${y}L${x2} ${y2}M${x2} ${y}L${x} ${y2}`;
    } else if (foldH) {
      // две панели по горизонтали: верхняя [y..cy], нижняя [cy..y2]
      crossPath = `M${x} ${y}L${x2} ${cy}M${x2} ${y}L${x} ${cy}`
        + `M${x} ${cy}L${x2} ${y2}M${x2} ${cy}L${x} ${y2}`;
    } else {
      // две панели по вертикали: левая [x..cx], правая [cx..x2]
      crossPath = `M${x} ${y}L${cx} ${y2}M${cx} ${y}L${x} ${y2}`
        + `M${cx} ${y}L${x2} ${y2}M${x2} ${y}L${cx} ${y2}`;
    }
  }
  const creasePath = !input.fold ? ''
    : foldH ? `M${x} ${cy}H${x2}` : `M${cx} ${y}V${y2}`;

  return `<svg class="r-dimbox" viewBox="0 0 240 164" role="img" aria-label="${attr(aria)}" `
    + `xmlns="http://www.w3.org/2000/svg">${defs(arrow)}`
    + (bleed
        ? `<rect x="${n(x - bleedOffset)}" y="${n(y - bleedOffset)}" `
          + `width="${n(boxWidth + bleedOffset * 2)}" height="${n(boxHeight + bleedOffset * 2)}" `
          + `rx="${n(rx + 1)}" class="sketch-bleed"/>`
        : '')
    + `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${rx}" class="sketch-shape"/>`
    + (crossPath ? `<path d="${crossPath}" class="sketch-cross"/>` : '')
    + (creasePath ? `<path d="${creasePath}" class="sketch-fold"/>` : '')
    + `<path d="M${x} 18H${x2}" class="sketch-dimension" `
    + `marker-start="url(#${arrow})" marker-end="url(#${arrow})"/>`
    + `<path d="M${x} 23V13M${x2} 23V13" class="sketch-helper"/>`
    + `<path d="M25 ${y}V${y2}" class="sketch-dimension" `
    + `marker-start="url(#${arrow})" marker-end="url(#${arrow})"/>`
    + `<path d="M20 ${y}H30M20 ${y2}H30" class="sketch-helper"/>`
    + `<text x="${n((x + x2) / 2)}" y="12" text-anchor="middle">${label(width)} ${unit}</text>`
    + `<text x="12" y="79" text-anchor="middle" transform="rotate(-90 12 79)">${label(height)} ${unit}</text>`
    + (bleed ? `<text x="126" y="154" text-anchor="middle">${t.bleedPlus}${label(bleed)} ${unit}</text>` : '')
    + (radius ? `<text x="${x2}" y="${n(y2 + 14)}" text-anchor="end">${t.radiusWord}${label(radius)} ${unit}</text>` : '')
    + `</svg>`;
}
