import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/parser.js';
import { summarizeTotals } from '../src/summary.js';
for(const [name, text, comparison, difference] of [
  ['declared-only', 'А4, 500 шт\nРазом: 3072 грн', 3072, 0],
  ['mixed sections', '= 100 грн\nРазом: 100 грн\nБуклети\nІтого: 200 грн', 300, 0],
  ['zero price is meaningful', '= 0 грн\nИтого: 200 грн', 0, -200],
  ['one kopeck mismatch', '= 100 грн\nИтого: 100,01 грн', 100, -0.01],
  ['grand total counts once', '= 100 грн\nИтого: 100 грн\n= 200 грн\nИтого: 200 грн\nОбщее итого: 300 грн', 300, 0],
  ['quantity is not money', 'Ітого: 1000 шт', 0, 0],
]) test(name, () => {
  const state = summarizeTotals(render(text).stats);
  assert.equal(state.comparison, comparison);
  assert.equal(state.difference, difference);
  assert.equal(state.matches, difference === 0);
});
