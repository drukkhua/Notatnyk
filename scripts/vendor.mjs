import { copyFile, readFile, mkdir } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('src/vendor/',root),{recursive:true});
await copyFile(new URL('node_modules/dompurify/dist/purify.es.mjs',root),new URL('src/vendor/dompurify.js',root));
await copyFile(new URL('node_modules/dompurify/LICENSE',root),new URL('src/vendor/DOMPurify-LICENSE',root));
const pkg=JSON.parse(await readFile(new URL('node_modules/dompurify/package.json',root),'utf8'));
console.log(`Local DOMPurify ${pkg.version} refreshed`);
