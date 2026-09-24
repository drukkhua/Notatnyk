import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/parser.js';

const source = [
  '= 950 грн', '= 1700 грн', '= 950 грн', '= 950 грн', 'Итого: 4550 грн',
  '= 1500 грн', '= 1500 грн', '= 1500 грн', 'Итого: 4500 грн',
  '= 1100 грн', 'Итого: 1100 грн', 'Итого общее: 10 150 гр',
].join('\n');

test('общий итог сверяет суммы секций и не создаёт четвёртую секцию', () => {
  const result = render(source);
  assert.equal(result.stats.total, 10150);
  assert.equal(result.stats.declared, 10150);
  assert.deepEqual(result.stats.sections.map(s => s.sum), [4550, 4500, 1100]);
  assert.deepEqual(result.stats.sections.map(s => s.declared), [4550, 4500, 1100]);
  assert.deepEqual(result.stats.grandTotal, { declared: 10150, sum: 10150, line: 11 });
  assert.equal(result.blocks.at(-1).kind, 'grand-total');
  assert.ok(result.blocks.at(-1).html.includes('r-total-ok'));
  assert.deepEqual(result.diagnostics, []);
});

test('сокращённый общий итог показывает расхождение с суммой секций', () => {
  const result = render('= 100 грн\nИтого: 100 грн\n= 200 грн\nИтого: 200 грн\nИтого общ.: 290 грн');
  assert.equal(result.stats.sections.length, 2);
  assert.equal(result.stats.grandTotal.sum, 300);
  assert.equal(result.stats.declared, 290);
  assert.ok(result.blocks.at(-1).html.includes('(+10)'));
  assert.ok(result.diagnostics.some(d => d.code === 'grand_total_mismatch'));
});

test('общий итог без подытогов сверяет позиции', () => {
  const result = render('= 100 грн\nОбщий итог: 100 грн');
  assert.equal(result.stats.sections.length, 0);
  assert.equal(result.stats.grandTotal.sum, 100);
  assert.equal(result.stats.declared, 100);
  assert.equal(result.stats.positions, 1);
});

test('кнопка «Общее итого» вставляет распознаваемую форму', () => {
  const result = render('= 100 грн\nИтого: 100 грн\n= 200 грн\nИтого: 200 грн\nОбщее итого: 300 грн');
  assert.equal(result.stats.sections.length, 2);
  assert.deepEqual(result.stats.grandTotal, { declared: 300, sum: 300, line: 4 });
  assert.equal(result.blocks.at(-1).kind, 'grand-total');
  assert.deepEqual(result.diagnostics, []);
});

for (const label of ['Разом загалом', 'Разом заг.']) {
  test(`украинский общий итог: ${label}`, () => {
    const result = render(`= 100 грн\nРазом: 100 грн\n${label}: 100 грн`);
    assert.equal(result.stats.sections.length, 1);
    assert.deepEqual(result.stats.grandTotal, { declared: 100, sum: 100, line: 2 });
    assert.equal(result.blocks.at(-1).kind, 'grand-total');
    assert.deepEqual(result.diagnostics, []);
  });
}
