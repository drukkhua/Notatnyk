// Shared footer arithmetic. Declared-only sections count once; real item prices
// (including zero) remain the source for reconciliation when present.
export function summarizeTotals(stats){
  const comparison = Math.round(stats.comparisonTotal * 100) / 100;
  const declared = stats.declared;
  const difference = declared == null ? 0 : Math.round((comparison - declared) * 100) / 100;
  return { comparison, declared, difference, usesDeclared: comparison!==Math.round(stats.total*100)/100, matches: difference === 0 };
}
