#!/usr/bin/env node
// Build a .pptx (and optional SVG previews) from a saved run or deck JSON.
//   node tools/build.mjs run.json out.pptx [--svg outdir]
// Needs: npm install pptxgenjs   (only for this script; the website needs no install)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CSM = require('../js/render.js');
const [, , inFile, outFile, flag, svgDir] = process.argv;
if (!inFile || !outFile) { console.error('usage: node tools/build.mjs run.json out.pptx [--svg dir]'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const deck = raw.deck || raw;
const errs = CSM.validate(deck);
if (errs.length) { console.error('Deck has problems:\n- ' + errs.join('\n- ')); process.exit(1); }
const PptxGenJS = require(require.resolve('pptxgenjs', { paths: [process.cwd(), path.dirname(inFile)] }));
await CSM.toPptx(PptxGenJS.default || PptxGenJS, deck).writeFile({ fileName: outFile });
if (flag === '--svg' && svgDir) {
  fs.mkdirSync(svgDir, { recursive: true });
  CSM.layoutDeck(deck).forEach((s, i) => fs.writeFileSync(path.join(svgDir, `slide-${String(i + 1).padStart(2, '0')}.svg`), CSM.toSVG(s)));
}
console.log('wrote', outFile);
