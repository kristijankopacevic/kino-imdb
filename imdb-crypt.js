// Šifra IMDb indeksa: repozitorij kino-imdb je javan (GitHub ga sam slaže svaki dan), ali indeks se bez ključa ne može pročitati.
// Ključ ima samo PC (i TV, koji ga jednom dobije od uparenog PC-a). Isti kod koristi GitHub Actions (node:crypto) i TV (shim).
// Oblik: "KIMDB1" | nonce (16 B) | gzip XOR HMAC-SHA256(ključ, nonce ‖ brojač bloka). Provjera: scripts/tvimdbgh.test.mjs
export const MAGIC = 'KIMDB1';
const hex = s => Uint8Array.from(String(s).match(/../g) ?? [], b => parseInt(b, 16));
export const validKey = k => /^[0-9a-f]{64}$/.test(String(k ?? ''));

function xor(data, keyHex, nonce, createHmac) {
  const key = hex(keyHex), out = new Uint8Array(data.length), blk = new Uint8Array(20), dv = new DataView(blk.buffer);
  blk.set(nonce);
  for (let i = 0, c = 0; i < data.length; i += 32, c++) {
    dv.setUint32(16, c);
    const ks = createHmac('sha256', key).update(blk).digest();
    const n = Math.min(32, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
  }
  return out;
}

export function seal(gz, keyHex, nonce, createHmac) {
  if (!validKey(keyHex)) throw new Error('neispravan ključ');
  const head = new TextEncoder().encode(MAGIC), out = new Uint8Array(head.length + 16 + gz.length);
  out.set(head); out.set(nonce, head.length); out.set(xor(gz, keyHex, nonce, createHmac), head.length + 16);
  return out;
}

export function unseal(bin, keyHex, createHmac) {
  const b = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  if (!validKey(keyHex)) throw new Error('neispravan ključ');
  if (new TextDecoder().decode(b.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('nije šifrirani IMDb indeks');
  const nonce = b.subarray(MAGIC.length, MAGIC.length + 16);
  return xor(b.subarray(MAGIC.length + 16), keyHex, nonce, createHmac);
}
