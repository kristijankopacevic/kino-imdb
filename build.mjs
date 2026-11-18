// GitHub Actions u privatnom repozitoriju kino-imdb: složi IMDb indeks ISTIM kodom kao Kino na PC-u (server/imdb.mjs,
// kopira ga scripts/imdb-repo/sync.mjs) → out/imdb.json.gz + out/meta.json. TV ih čita izravno (web/tv/imdb-gh.js).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

process.env.DATA_DIR ||= path.resolve('data');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const imdb = await import('./server/imdb.mjs');
await imdb.refresh(() => false, Date.now());
const info = imdb.info();
if (!info.count) { console.error('IMDb indeks je prazan'); process.exit(1); }
const text = fs.readFileSync(path.join(process.env.DATA_DIR, 'imdb-index.json'));
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/imdb.json.gz', zlib.gzipSync(text, { level: 9 }));
fs.writeFileSync('out/meta.json', JSON.stringify({ basicsAt: info.basicsAt, ratingsAt: info.ratingsAt, count: info.count }));
console.log(`IMDb indeks: ${info.count} naslova, ${(fs.statSync('out/imdb.json.gz').size / 1e6).toFixed(1)} MB`);
