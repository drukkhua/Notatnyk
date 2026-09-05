// Contract-тесты движка ТЗ: один и тот же набор fixtures (spec-fixtures.json)
// прогоняется здесь и в BitrixUI/frontend/src/lib/__tests__/specEngine.contract.test.ts —
// расхождение портов ловится тут, а не в проде (см. docs/print-spec-parser-render-audit.md,
// раздел 5). Без внешних зависимостей — встроенный test-раннер Node (>=18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { render } from '../src/parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, 'spec-fixtures.json'), 'utf-8'));

const EPS = 0.005;
const near = (a, b) => Math.abs(a - b) < EPS;

for (const c of cases) {
  test(c.name, () => {
    const { html, stats, diagnostics } = render(c.source, { mode: c.mode === 'export' ? 'export' : undefined });
    const e = c.expect;

    if (e.total != null) assert.ok(near(stats.total, e.total), `total: ${stats.total} !~ ${e.total}`);
    if (e.declared != null) assert.ok(near(stats.declared, e.declared), `declared: ${stats.declared} !~ ${e.declared}`);
    if (e.checksTotal != null) assert.equal(stats.checksTotal, e.checksTotal);
    if (e.checksDone != null) assert.equal(stats.checksDone, e.checksDone);
    if (e.positions != null) assert.equal(stats.positions, e.positions);

    if (e.sections) {
      assert.equal(stats.sections.length, e.sections.length, 'sections length');
      e.sections.forEach((s, i) => {
        const got = stats.sections[i];
        if (s.declared == null) assert.equal(got.declared, null);
        else assert.ok(near(got.declared, s.declared), `sections[${i}].declared: ${got.declared} !~ ${s.declared}`);
        assert.ok(near(got.sum, s.sum), `sections[${i}].sum: ${got.sum} !~ ${s.sum}`);
      });
    }

    for (const frag of e.htmlIncludes || [])
      assert.ok(html.includes(frag), `expected html to include: ${frag}\n--- html ---\n${html}`);
    for (const frag of e.htmlExcludes || [])
      assert.ok(!html.includes(frag), `expected html to NOT include: ${frag}\n--- html ---\n${html}`);

    for (const want of e.diagnosticsInclude || []) {
      const found = diagnostics.some((d) => d.code === want.code && (want.line == null || d.line === want.line));
      assert.ok(found, `expected diagnostics to include ${JSON.stringify(want)}\n--- diagnostics ---\n${JSON.stringify(diagnostics)}`);
    }
  });
}
