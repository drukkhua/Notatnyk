// Read-only comparison. Uses the supplied BitrixUI installation's esbuild;
// temporary bundle lives outside either working tree.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { render } from '../src/parser.js';
const root = process.argv[2];
if(!root) throw new Error('Usage: node scripts/compare-bitrix-spec.mjs /path/to/BitrixUI');
const req = createRequire(join(resolve(root), 'frontend/package.json'));
const { build } = req('esbuild');
const dir = await mkdtemp(join(tmpdir(), 'notatnyk-spec-'));
const output = join(dir, 'spec.mjs');
try{
  await build({ entryPoints:[join(resolve(root), 'frontend/src/lib/specEngine.ts')], bundle:true, platform:'node', format:'esm', outfile:output, logLevel:'silent' });
  const bitrix = await import(pathToFileURL(output));
  const own = JSON.parse(await readFile(new URL('../test/spec-fixtures.json', import.meta.url), 'utf8')).cases;
  const other = JSON.parse(await readFile(join(resolve(root), 'frontend/src/lib/__tests__/spec-fixtures.json'), 'utf8')).cases;
  const compact = r => ({ ...Object.fromEntries(['total','comparisonTotal','declared','checksTotal','checksDone','positions'].map(k=>[k,r.stats[k]])), sections:r.stats.sections.map(({declared,sum})=>({declared,sum})), diagnostics:r.diagnostics.map(({code,line})=>({code,line})) });
  let same=0, known=0, unexpected=0;
  for(const c of [...own,...other]){
    const a=compact(render(c.source,{mode:c.mode==='export'?'export':undefined}));
    const b=compact(bitrix.render(c.source,{export:c.mode==='export'}));
    if(JSON.stringify(a)===JSON.stringify(b)){same++;continue;}
    if(c.name.startsWith('grand-total-')){known++;console.log(`Known BitrixUI gap: ${c.name}; Notatnyk ${a.total}, BitrixUI ${b.total}`);}
    else{unexpected++;console.error(`Unexpected difference: ${c.name}\n${JSON.stringify({notatnyk:a,bitrix:b},null,2)}`);}
  }
  console.log(`${same} matching inputs, ${known} documented grand-total gaps, ${unexpected} unexpected differences`);
  process.exitCode=unexpected?1:0;
}finally{await rm(dir,{recursive:true,force:true});}
