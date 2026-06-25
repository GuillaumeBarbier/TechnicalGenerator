/* ============================================================
   Extraction des 2 couleurs dominantes d'une image (serveur)
   JPEG (jpeg-js) et PNG (pngjs). WebP non supporté -> null.
   ============================================================ */
const toHex = c => '#' + [c.r, c.g, c.b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

function dominantColorsFromBuffer(buf, contentType = '', hint = '') {
  let px, W, H;
  const ct = (contentType || '').toLowerCase();
  const isJpg = /jpe?g/.test(ct) || /\.jpe?g(\?|#|$)/i.test(hint);
  const isPng = /png/.test(ct) || /\.png(\?|#|$)/i.test(hint);
  try {
    if (isJpg) {
      const d = require('jpeg-js').decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
      px = d.data; W = d.width; H = d.height;
    } else if (isPng) {
      const png = require('pngjs').PNG.sync.read(buf);
      px = png.data; W = png.width; H = png.height;
    } else return null;
  } catch { return null; }

  const step = Math.max(1, Math.floor((W * H) / 5000)); // ~5000 échantillons
  const buckets = {};
  for (let p = 0; p < W * H; p += step) {
    const i = p * 4, r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max - min;
    if (max > 235 && sat < 18) continue; // quasi-blanc
    if (max < 25) continue;              // quasi-noir
    if (sat < 22) continue;              // gris/neutre
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bk = buckets[key] || (buckets[key] = { count: 0, r: 0, g: 0, b: 0 });
    bk.count++; bk.r += r; bk.g += g; bk.b += b;
  }
  const arr = Object.values(buckets)
    .map(b => ({ count: b.count, r: Math.round(b.r / b.count), g: Math.round(b.g / b.count), b: Math.round(b.b / b.count) }))
    .sort((a, b) => b.count - a.count);
  if (!arr.length) return null;
  const c1 = arr[0];
  const c2 = arr.find((c, i) => i > 0 && dist(c, c1) > 70)
    || { r: Math.round(c1.r * 0.55), g: Math.round(c1.g * 0.55), b: Math.round(c1.b * 0.55) };
  return [toHex(c1), toHex(c2)];
}

async function dominantColorsFromUrl(url) {
  if (!url) return null;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (FicheTechniqueBot/1.0)' } });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  const buf = Buffer.from(await r.arrayBuffer());
  return dominantColorsFromBuffer(buf, ct, url);
}

module.exports = { dominantColorsFromBuffer, dominantColorsFromUrl };
