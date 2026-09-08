// Визуальный контракт размерного эскиза. Модуль — суперсет BitrixUI
// (frontend/src/lib/dimensionSketch.ts): для cross:false без fold вывод обязан
// быть БАЙТ-В-БАЙТ равен снапшоту эталона (frontend/src/lib/__tests__/
// __snapshots__/dimensionSketch.test.ts.snap). Без внешних зависимостей —
// встроенный test-раннер Node. Запуск: `npm test` из корня проекта.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderDimensionSketch, DIMENSION_SKETCH_VERSION } from '../src/dimensionSketch.js';

// ── Байт-в-байт со снапшотом эталона (доказательство точности порта) ──────────
// Скопировано из dimensionSketch.test.ts.snap как есть (кейсы «landscape»,
// «circle»). Если эталон меняет геометрию — эти строки и снапшот там правятся
// синхронно, вместе с бампом DIMENSION_SKETCH_VERSION.
const SNAP = {
  landscape:
    '<svg class="r-dimbox" viewBox="0 0 240 164" role="img" aria-label="Прямокутник 440 на 310 міліметрів" xmlns="http://www.w3.org/2000/svg"><defs><marker id="dim-arrow-3ebclt" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs><rect x="59.3" y="32" width="133.4" height="94" rx="0" class="sketch-shape"/><path d="M59.3 18H192.7" class="sketch-dimension" marker-start="url(#dim-arrow-3ebclt)" marker-end="url(#dim-arrow-3ebclt)"/><path d="M59.3 23V13M192.7 23V13" class="sketch-helper"/><path d="M25 32V126" class="sketch-dimension" marker-start="url(#dim-arrow-3ebclt)" marker-end="url(#dim-arrow-3ebclt)"/><path d="M20 32H30M20 126H30" class="sketch-helper"/><text x="126" y="12" text-anchor="middle">440 мм</text><text x="12" y="79" text-anchor="middle" transform="rotate(-90 12 79)">310 мм</text></svg>',
  circle:
    '<svg class="r-dimbox r-dimbox-circle" viewBox="0 0 240 164" role="img" aria-label="Коло діаметром 50 міліметрів" xmlns="http://www.w3.org/2000/svg"><defs><marker id="dim-arrow-62iae0" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs><circle cx="126" cy="79" r="45" class="sketch-shape"/><path d="M81 18h90" class="sketch-dimension" marker-start="url(#dim-arrow-62iae0)" marker-end="url(#dim-arrow-62iae0)"/><path d="M81 23v-10M171 23v-10" class="sketch-helper"/><text x="126" y="12" text-anchor="middle">Ø 50 мм</text></svg>',
  circleBleed:
    '<svg class="r-dimbox r-dimbox-circle" viewBox="0 0 240 164" role="img" aria-label="Коло діаметром 50 міліметрів, виліт 3 міліметрів" xmlns="http://www.w3.org/2000/svg"><defs><marker id="dim-arrow-oxhdzf" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs><circle cx="126" cy="79" r="51" class="sketch-bleed"/><circle cx="126" cy="79" r="45" class="sketch-shape"/><path d="M81 18h90" class="sketch-dimension" marker-start="url(#dim-arrow-oxhdzf)" marker-end="url(#dim-arrow-oxhdzf)"/><path d="M81 23v-10M171 23v-10" class="sketch-helper"/><text x="126" y="12" text-anchor="middle">Ø 50 мм</text><text x="126" y="154" text-anchor="middle">виліт +3 мм</text></svg>',
  fold:
    '<svg class="r-dimbox" viewBox="0 0 240 164" role="img" aria-label="Прямокутник 420 на 297 міліметрів, лінія згину" xmlns="http://www.w3.org/2000/svg"><defs><marker id="dim-arrow-kw3l2o" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs><rect x="59.6" y="32" width="132.9" height="94" rx="0" class="sketch-shape"/><path d="M126.1 32V126" class="sketch-fold"/><path d="M59.6 18H192.5" class="sketch-dimension" marker-start="url(#dim-arrow-kw3l2o)" marker-end="url(#dim-arrow-kw3l2o)"/><path d="M59.6 23V13M192.5 23V13" class="sketch-helper"/><path d="M25 32V126" class="sketch-dimension" marker-start="url(#dim-arrow-kw3l2o)" marker-end="url(#dim-arrow-kw3l2o)"/><path d="M20 32H30M20 126H30" class="sketch-helper"/><text x="126.1" y="12" text-anchor="middle">420 мм</text><text x="12" y="79" text-anchor="middle" transform="rotate(-90 12 79)">297 мм</text></svg>',
  rounded:
    '<svg class="r-dimbox" viewBox="0 0 240 164" role="img" aria-label="Прямокутник 210 на 99 міліметрів, радіус 5 міліметрів" xmlns="http://www.w3.org/2000/svg"><defs><marker id="dim-arrow-wvueab" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs><rect x="49" y="42.7" width="154" height="72.6" rx="3.7" class="sketch-shape"/><path d="M49 18H203" class="sketch-dimension" marker-start="url(#dim-arrow-wvueab)" marker-end="url(#dim-arrow-wvueab)"/><path d="M49 23V13M203 23V13" class="sketch-helper"/><path d="M25 42.7V115.3" class="sketch-dimension" marker-start="url(#dim-arrow-wvueab)" marker-end="url(#dim-arrow-wvueab)"/><path d="M20 42.7H30M20 115.3H30" class="sketch-helper"/><text x="126" y="12" text-anchor="middle">210 мм</text><text x="12" y="79" text-anchor="middle" transform="rotate(-90 12 79)">99 мм</text><text x="203" y="129.3" text-anchor="end">радіус 5 мм</text></svg>',
  fractionalCm:
    '<svg class="r-dimbox" viewBox="0 0 240 164" role="img" aria-label="Прямокутник 12,5 на 12,5 сантиметрів, виліт 0,3 сантиметрів" xmlns="http://www.w3.org/2000/svg"><defs><marker id="dim-arrow-titsnd" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" class="sketch-arrow"/></marker></defs><rect x="75.7" y="28.7" width="100.6" height="100.6" rx="1" class="sketch-bleed"/><rect x="79" y="32" width="94" height="94" rx="0" class="sketch-shape"/><path d="M79 18H173" class="sketch-dimension" marker-start="url(#dim-arrow-titsnd)" marker-end="url(#dim-arrow-titsnd)"/><path d="M79 23V13M173 23V13" class="sketch-helper"/><path d="M25 32V126" class="sketch-dimension" marker-start="url(#dim-arrow-titsnd)" marker-end="url(#dim-arrow-titsnd)"/><path d="M20 32H30M20 126H30" class="sketch-helper"/><text x="126" y="12" text-anchor="middle">12,5 см</text><text x="12" y="79" text-anchor="middle" transform="rotate(-90 12 79)">12,5 см</text><text x="126" y="154" text-anchor="middle">виліт +0,3 см</text></svg>',
};

test('порт байт-в-байт со снапшотом BitrixUI (cross:false)', () => {
  assert.equal(
    renderDimensionSketch({ shape: 'rect', width: 440, height: 310, unit: 'мм' }),
    SNAP.landscape);
  assert.equal(
    renderDimensionSketch({ shape: 'circle', diameter: 50, unit: 'мм' }),
    SNAP.circle);
  assert.equal(
    renderDimensionSketch({ shape: 'circle', diameter: 50, unit: 'мм', bleed: 3 }),
    SNAP.circleBleed);
  assert.equal(
    renderDimensionSketch({ shape: 'rect', width: 420, height: 297, unit: 'мм', fold: true }),
    SNAP.fold);
  assert.equal(
    renderDimensionSketch({ shape: 'rect', width: 210, height: 99, unit: 'мм', cornerRadius: 5 }),
    SNAP.rounded);
  assert.equal(
    renderDimensionSketch({ shape: 'rect', width: 12.5, height: 12.5, unit: 'см', bleed: 0.3 }),
    SNAP.fractionalCm);
});

test('ни одного inline-цвета — только классы sketch-*', () => {
  const inputs = [
    { shape: 'rect', width: 90, height: 50, unit: 'мм', bleed: 2, cornerRadius: 3, fold: true, cross: true },
    { shape: 'circle', diameter: 40, unit: 'мм', bleed: 3, cross: true },
  ];
  for (const inp of inputs) {
    const svg = renderDimensionSketch(inp);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(svg), `есть hex-цвет: ${svg}`);
    assert.ok(!/\b(fill|stroke)="(?!none")[a-z]/i.test(svg), `есть именованный цвет: ${svg}`);
    assert.ok(svg.includes('class="sketch-shape"'));
    assert.ok(svg.includes('class="sketch-dimension"'));
  }
});

test('viewBox и корневой класс', () => {
  const rect = renderDimensionSketch({ shape: 'rect', width: 100, height: 100, unit: 'мм' });
  assert.ok(rect.startsWith('<svg class="r-dimbox" viewBox="0 0 240 164"'));
  const circ = renderDimensionSketch({ shape: 'circle', diameter: 30, unit: 'мм' });
  assert.ok(circ.startsWith('<svg class="r-dimbox r-dimbox-circle" viewBox="0 0 240 164"'));
});

test('вылет: кольцо sketch-bleed + подпись в SVG', () => {
  const svg = renderDimensionSketch({ shape: 'rect', width: 200, height: 100, unit: 'мм', bleed: 3 });
  assert.ok(svg.includes('class="sketch-bleed"'));
  assert.ok(svg.includes('>виліт +3 мм<'));
  assert.match(svg, /aria-label="[^"]*виліт 3 міліметрів/);
});

test('радиус: rx на форме + подпись', () => {
  const svg = renderDimensionSketch({ shape: 'rect', width: 200, height: 100, unit: 'мм', cornerRadius: 4 });
  assert.ok(!svg.includes('rx="0"'));
  assert.ok(svg.includes('>радіус 4 мм<'));
});

test('cross: одиночный X-крест без fold', () => {
  const svg = renderDimensionSketch({ shape: 'rect', width: 200, height: 100, unit: 'мм', cross: true });
  const m = svg.match(/<path d="([^"]+)" class="sketch-cross"\/>/);
  assert.ok(m, 'нет sketch-cross');
  // два отрезка (две диагонали) = два «M…L…»
  assert.equal((m[1].match(/M/g) || []).length, 2);
});

test('fold + cross, пейзаж: вертикальный сгиб + X-крест в каждой из 2 панелей', () => {
  const svg = renderDimensionSketch({ shape: 'rect', width: 300, height: 150, unit: 'мм', fold: true, cross: true });
  const crease = svg.match(/<path d="([^"]+)" class="sketch-fold"\/>/);
  assert.ok(crease && /V/.test(crease[1]) && !/H/.test(crease[1]), 'сгиб не вертикальный');
  const cross = svg.match(/<path d="([^"]+)" class="sketch-cross"\/>/);
  assert.equal((cross[1].match(/M/g) || []).length, 4, 'ожидается 4 диагонали (2 панели × 2)');
});

test('fold + cross, портрет: горизонтальный сгиб + X-крест в 2 панелях', () => {
  const svg = renderDimensionSketch({ shape: 'rect', width: 150, height: 300, unit: 'мм', fold: true, cross: true });
  const crease = svg.match(/<path d="([^"]+)" class="sketch-fold"\/>/);
  assert.ok(crease && /H/.test(crease[1]) && !/V/.test(crease[1]), 'сгиб не горизонтальный');
  const cross = svg.match(/<path d="([^"]+)" class="sketch-cross"\/>/);
  assert.equal((cross[1].match(/M/g) || []).length, 4);
});

test('fold без cross — крест не рисуется (совместимость с BitrixUI)', () => {
  const svg = renderDimensionSketch({ shape: 'rect', width: 300, height: 150, unit: 'мм', fold: true });
  assert.ok(svg.includes('class="sketch-fold"'));
  assert.ok(!svg.includes('class="sketch-cross"'));
});

test('circle + cross: центровой крест', () => {
  const svg = renderDimensionSketch({ shape: 'circle', diameter: 40, unit: 'мм', cross: true });
  assert.ok(svg.includes('class="sketch-cross"'));
});

test('i18n: частичный оверрайд подписей и aria', () => {
  const svg = renderDimensionSketch(
    { shape: 'rect', width: 90, height: 50, unit: 'мм', bleed: 2 },
    { spoken: () => 'миллиметров', rect: 'Прямоугольник', by: 'на', bleed: 'вылет', bleedPlus: 'вылет +' });
  assert.match(svg, /aria-label="Прямоугольник 90 на 50 миллиметров, вылет 2 миллиметров"/);
  assert.ok(svg.includes('>вылет +2 мм<'));
});

test('id маркера: детерминирован и не зависит от cross', () => {
  const a = renderDimensionSketch({ shape: 'rect', width: 90, height: 50, unit: 'мм' });
  const b = renderDimensionSketch({ shape: 'rect', width: 90, height: 50, unit: 'мм', cross: true });
  const c = renderDimensionSketch({ shape: 'rect', width: 91, height: 50, unit: 'мм' });
  const id = (s) => s.match(/id="(dim-arrow-[a-z0-9]+)"/)[1];
  assert.equal(id(a), id(b), 'cross не должен менять id маркера');
  assert.notEqual(id(a), id(c), 'разный размер — разный id');
});

test('вырожденный ввод не роняет функцию', () => {
  assert.ok(renderDimensionSketch({ shape: 'rect', width: 0, height: 0, unit: 'мм' }).startsWith('<svg'));
  assert.ok(renderDimensionSketch({ shape: 'circle', unit: 'мм' }).startsWith('<svg'));
});

test('версия контракта экспортируется', () => {
  assert.match(DIMENSION_SKETCH_VERSION, /^\d+\.\d+\.\d+$/);
});
