// GitHub Actions u repozitoriju kino-imdb: složi IMDb indeks ISTIM kodom kao Kino na PC-u (server/imdb.mjs, kopira ga
// scripts/imdb-repo/sync.mjs) i šifrira ga (imdb-crypt.js, tajna IMDB_KEY) → out/imdb.bin + out/meta.json.
// Bez ključa ne objavljuje ništa (nikad nešifrirano). TV ih čita izravno (web/tv/imdb-gh.js).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import nodeCrypto from 'node:crypto';
import { seal, validKey } from './imdb-crypt.js';

const KEY = process.env.IMDB_KEY ?? '';
if (!validKey(KEY)) { console.error('Nema tajne IMDB_KEY — ne objavljujem (nikad nešifrirano).'); process.exit(1); }
process.env.DATA_DIR ||= path.resolve('data');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const imdb = await import('./server/imdb.mjs');
await imdb.refresh(() => false, Date.now());
const info = imdb.info();
if (!info.count) { console.error('IMDb indeks je prazan'); process.exit(1); }
const gz = zlib.gzipSync(fs.readFileSync(path.join(process.env.DATA_DIR, 'imdb-index.json')), { level: 9 });
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/imdb.bin', seal(gz, KEY, nodeCrypto.randomBytes(16), nodeCrypto.createHmac));
fs.writeFileSync('out/meta.json', JSON.stringify({ basicsAt: info.basicsAt, ratingsAt: info.ratingsAt, count: info.count }));
console.log(`IMDb indeks: ${info.count} naslova, ${(fs.statSync('out/imdb.bin').size / 1e6).toFixed(1)} MB (šifrirano)`);
