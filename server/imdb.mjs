// IMDb ocjene i filtriranje iz IMDb-ovih službenih skupova podataka (datasets.imdbws.com, osobna nekomercijalna upotreba).
// Cinemetin katalog "imdbRating" nije poredan po ocjeni (~50 novijih popularnih), pa filtri "★ 8.5+" i "Najbolje
// ocijenjeno" trebaju pravi izvor. Čuvamo samo filmove/serije s ≥ 1000 glasova (~70 tis. redaka) u DATA_DIR/imdb-index.json.
// Ocjene (8,7 MB) se osvježavaju tjedno, popis naslova (230 MB) mjesečno — u pozadini, nikad dok traje gledanje.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { DATA_DIR } from '../scripts/secrets.mjs';

const BASE = 'https://datasets.imdbws.com/';
const FILE = path.join(DATA_DIR, 'imdb-index.json');
const MIN_VOTES = 1000, C = 7.0; // C ≈ prosječna IMDb ocjena (za ponderiranu "Top" ocjenu)
const DAY = 864e5;

export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export function parseRating(line) {
  const [id, r, v] = line.split('\t');
  if (!/^tt\d+$/.test(id) || !(+v >= MIN_VOTES)) return null;
  return [id, +r, +v];
}
const TYPES = { movie: 'movie', tvMovie: 'movie', tvSeries: 'series', tvMiniSeries: 'series' };
export function parseBasics(line) {
  const f = line.split('\t');
  const type = TYPES[f[1]];
  if (!type || !/^tt\d+$/.test(f[0]) || f[4] === '1') return null;
  return { id: f[0], type, title: f[2], year: parseInt(f[5]) || null, genres: f[8] && f[8] !== '\\N' ? f[8].split(',') : [], runtime: parseInt(f[7]) || null };
}

export function buildIndex(ratings, basics) {
  const rows = [];
  for (const b of basics) {
    const r = ratings.get(b.id);
    if (r) rows.push({ ...b, rating: r[0], votes: r[1], key: fold(b.title) });
  }
  return rows;
}

// IMDb Top formula: v/(v+m)·R + m/(v+m)·C
export const weighted = (R, v, m, c = C) => v / (v + m) * R + m / (v + m) * c;

// sort: 'top' (IMDb Top) | 'rating' | 'votes' | 'year'. minVotes zadano: 25 000 filmovi / 10 000 serije (prag IMDb Top liste).
export function query(rows, { type = 'movie', genres = [], yearFrom, yearTo, minRating, minVotes, minRuntime, maxRuntime, sort = 'top', skip = 0, limit = 50 } = {}) {
  const mv = minVotes ?? (type === 'series' ? 10000 : 25000), m = type === 'series' ? 10000 : 25000;
  const out = rows.filter(r => r.type === type && r.votes >= mv && (!minRating || r.rating >= minRating)
    && (!yearFrom || r.year >= yearFrom) && (!yearTo || (r.year && r.year <= yearTo)) && genres.every(g => r.genres.includes(g))
    && (!minRuntime || (r.runtime && r.runtime >= minRuntime)) && (!maxRuntime || (r.runtime && r.runtime <= maxRuntime)));
  const by = {
    top: (a, b) => weighted(b.rating, b.votes, m) - weighted(a.rating, a.votes, m),
    rating: (a, b) => b.rating - a.rating || b.votes - a.votes,
    votes: (a, b) => b.votes - a.votes,
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || b.votes - a.votes,
  }[sort] ?? ((a, b) => weighted(b.rating, b.votes, m) - weighted(a.rating, a.votes, m));
  return out.sort(by).slice(+skip || 0, (+skip || 0) + limit);
}

// Pretraga po naslovu: bez dijakritike, sve riječi moraju biti u naslovu, najpoznatije prvo.
export function searchIndex(rows, q, limit = 20) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.join('').length < 2) return [];
  return rows.filter(r => words.every(w => (r.key ??= fold(r.title)).includes(w))).sort((a, b) => b.votes - a.votes).slice(0, limit);
}

// --- učitavanje i osvježavanje (I/O) ---
let state = { rows: [], byId: new Map(), basicsAt: 0, ratingsAt: 0 };
const setRows = (rows, basicsAt, ratingsAt) => { state = { rows, byId: new Map(rows.map(r => [r.id, r])), basicsAt, ratingsAt }; };
// Spremljeni oblik (save()) → indeks. Kino na Samsung TV-u ga dobiva s PC-a (server/tvgate.mjs /imdb) i učita ovime.
export function loadIndex(j) {
  setRows(j.rows.map(([id, type, title, year, g, rating, votes, runtime]) => ({ id, type, title, year, genres: g ? g.split(',') : [], rating, votes, runtime: runtime ?? null })), j.basicsAt, j.ratingsAt); // key (za pretragu) tek kad zatreba — 70 tis. naslova je skupo na TV-u
}
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  loadIndex(j);
} catch {}

export const ready = () => state.rows.length > 0;
if (state.rows.length && !state.rows.some(r => r.runtime)) state.basicsAt = 0; // stari indeks bez trajanja → ponovo složi naslove
export const all = () => state.rows;
export const rating = id => state.byId.get(id) ?? null;

async function* lines(file) {
  const r = await fetch(BASE + file, { signal: AbortSignal.timeout(30 * 60e3) });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  yield* readline.createInterface({ input: Readable.fromWeb(r.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}
function save() {
  const rows = state.rows.map(r => [r.id, r.type, r.title, r.year, r.genres.join(','), r.rating, r.votes, r.runtime ?? null]);
  fs.writeFileSync(FILE + '.tmp', JSON.stringify({ basicsAt: state.basicsAt, ratingsAt: state.ratingsAt, rows }));
  fs.renameSync(FILE + '.tmp', FILE);
}

let running = null;
// busy(): true dok netko gleda — tada ne preuzimamo ništa (ne otimamo brzinu filmu).
export function refresh(busy = () => false, now = Date.now()) {
  const needBasics = now - state.basicsAt > 30 * DAY, needRatings = now - state.ratingsAt > 7 * DAY;
  if (running || (!needBasics && !needRatings) || busy()) return running;
  running = (async () => {
    const ratings = new Map();
    for await (const l of lines('title.ratings.tsv.gz')) { const p = parseRating(l); if (p) ratings.set(p[0], [p[1], p[2]]); }
    if (needBasics) {
      const basics = [];
      for await (const l of lines('title.basics.tsv.gz')) { if (!ratings.has(l.slice(0, l.indexOf('\t')))) continue; const b = parseBasics(l); if (b) basics.push(b); }
      setRows(buildIndex(ratings, basics), now, now);
    } else {
      setRows(state.rows.map(r => { const x = ratings.get(r.id); return x ? { ...r, rating: x[0], votes: x[1] } : r; }), state.basicsAt, now);
    }
    save();
    console.log(`IMDb indeks: ${state.rows.length} naslova`);
  })().catch(e => console.error('IMDb indeks:', e.message)).finally(() => { running = null; });
  return running;
}

// Za ⚙ Stanje sustava.
export const info = () => ({ count: state.rows.length, basicsAt: state.basicsAt || null, ratingsAt: state.ratingsAt || null });
