// Чистые тесты калькулятора величин — прогоняет quantity-calc-fixtures.json напрямую
// через parseQuantityExpression(), без HTML/render(). Тот же набор fixtures прогоняется
// в BitrixUI (Vitest) — расхождение портов ловится тут, а не в проде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseQuantityExpression } from '../src/quantity-calc.js';

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, 'quantity-calc-fixtures.json'), 'utf-8'));

const EPS = 1e-9;

for (const c of cases) {
  test(c.name, () => {
    const vars = c.vars || {};
    const resolveVariable = (name) => (Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : null);
    const result = parseQuantityExpression(c.source, resolveVariable);
    const e = c.expect;

    if (e.null) {
      assert.equal(result, null, `expected null, got ${JSON.stringify(result)}`);
      return;
    }
    assert.notEqual(result, null, 'expected a result, got null');
    assert.equal(result.ok, e.ok, `ok mismatch: ${JSON.stringify(result)}`);
    if (e.ok) {
      assert.equal(result.value.kind, e.kind);
      if (e.kind === 'quantity') {
        assert.ok(Math.abs(result.value.value - e.value) < EPS,
          `value: ${result.value.value} !~ ${e.value}`);
        assert.equal(result.value.unitRaw, e.unitRaw);
      } else if (e.kind === 'scalar' || e.kind === 'percent') {
        assert.ok(Math.abs(result.value.value - e.value) < EPS,
          `value: ${result.value.value} !~ ${e.value}`);
      }
    } else {
      assert.equal(result.code, e.code, `code mismatch: got ${result.code}`);
    }
  });
}
