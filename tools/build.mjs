#!/usr/bin/env node
// Build a .pptx (and optional SVG previews) from a saved run or deck JSON.
//   node tools/build.mjs run.json out.pptx [--svg outdir] [--prep notes.html]
// Needs: npm install pptxgenjs   (only for this script; the website needs no install)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CSM = require('../js/render.js');
const [, , inFile, outFile, ...rest] = process.argv;
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const svgDir = opt('--svg'), prepFile = opt('--prep');
if (!inFile || !outFile) { console.error('usage: node tools/build.mjs run.json out.pptx [--svg dir] [--prep notes.html]'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const deck = raw.deck || raw;
const errs = CSM.validate(deck);
if (errs.length) { console.error('Deck has problems:\n- ' + errs.join('\n- ')); process.exit(1); }
const PptxGenJS = require(require.resolve('pptxgenjs', { paths: [process.cwd(), path.dirname(inFile)] }));
await CSM.toPptx(PptxGenJS.default || PptxGenJS, deck).writeFile({ fileName: outFile });
if (svgDir) {
  fs.mkdirSync(svgDir, { recursive: true });
  CSM.layoutDeck(deck).forEach((s, i) => fs.writeFileSync(path.join(svgDir, `slide-${String(i + 1).padStart(2, '0')}.svg`), CSM.toSVG(s)));
}
if (prepFile && raw.prep_markdown) {
  const { marked } = require('../vendor/marked.min.js');
  fs.writeFileSync(prepFile, '<html><head><meta charset="utf-8"><style>body{font-family:Arial;font-size:11pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;vertical-align:top;text-align:left}th{background:#f0f0f0}</style></head><body>' + marked.parse(raw.prep_markdown) + '</body></html>');
  console.log('wrote', prepFile);
}
console.log('wrote', outFile);
