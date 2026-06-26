/* ============================================================
   Générateur de fiches techniques — logique front
   ============================================================ */

/* ---------- Mini moteur de template (mustache-like) ----------
   Supporte :  {{var}}  {{a.b}}  {{#each list}}…{{/each}}
               {{#if cond}}…{{else}}…{{/if}}                      */
function tokenize(str) {
  const re = /\{\{(\{)?\s*([#\/]?)\s*([^}]*?)\s*\}?\}\}/g;
  const tokens = [];
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: str.slice(last, m.index) });
    const raw = !!m[1], sigil = m[2], body = m[3].trim();
    if (sigil === '#') {
      const [kw, ...rest] = body.split(/\s+/);
      tokens.push({ t: 'open', kw, arg: rest.join(' ') });
    } else if (sigil === '/') {
      tokens.push({ t: 'close', kw: body });
    } else if (body === 'else') {
      tokens.push({ t: 'else' });
    } else {
      tokens.push({ t: 'var', v: body, raw });
    }
    last = re.lastIndex;
  }
  if (last < str.length) tokens.push({ t: 'text', v: str.slice(last) });
  return tokens;
}

function parse(tokens) {
  let i = 0;
  function walk(stop) {
    const nodes = [];
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === 'close' && (!stop || tk.kw === stop)) { i++; break; }
      if (tk.t === 'else') { i++; nodes.push({ t: 'else' }); continue; }
      if (tk.t === 'open') {
        i++;
        const body = walk(tk.kw);
        nodes.push({ t: 'block', kw: tk.kw, arg: tk.arg, body });
      } else {
        nodes.push(tk); i++;
      }
    }
    return nodes;
  }
  return walk(null);
}

function resolve(path, ctx, root) {
  if (path === '.' || path === 'this') return ctx;
  let cur = (path[0] === '@') ? root : ctx;
  for (const part of path.split('.')) {
    if (part === 'this' || part === '') continue;
    if (cur == null) return undefined;
    cur = cur[part];
  }
  if (cur === undefined && ctx !== root) {
    cur = root;
    for (const part of path.split('.')) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
  }
  return cur;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderNodes(nodes, ctx, root) {
  let out = '';
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') out += n.raw
      ? String(resolve(n.v, ctx, root) ?? '')
      : esc(resolve(n.v, ctx, root) ?? '').replace(/\n/g, '<br>');
    else if (n.t === 'block') {
      // separate body into true / else part
      let truePart = n.body, elsePart = [];
      const ei = n.body.findIndex(x => x.t === 'else');
      if (ei >= 0) { truePart = n.body.slice(0, ei); elsePart = n.body.slice(ei + 1); }
      const val = resolve(n.arg, ctx, root);
      if (n.kw === 'each') {
        if (Array.isArray(val) && val.length) {
          val.forEach(item => { out += renderNodes(truePart, item, root); });
        } else out += renderNodes(elsePart, ctx, root);
      } else if (n.kw === 'if') {
        out += (val ? renderNodes(truePart, ctx, root) : renderNodes(elsePart, ctx, root));
      }
    }
  }
  return out;
}

function render(tpl, data) {
  return renderNodes(parse(tokenize(tpl)), data, data);
}

/* ---------- Templates ---------- */
const TEMPLATES = {
  sup:     { name: 'SUP — pack (icônes)',     file: '/templates/sup.html',     sample: '/data/sample-sup.json' },
  generic: { name: 'Générique — photos + QR', file: '/templates/generic.html', sample: '/data/sample-generic.json' },
};

const SCHEMA = { text: [{ key: 'badge', label: 'Badge (ex: SÉLECTION 2026)' }] };

let tplId = 'generic';
let state = null;
let templateHtml = '';
let CATEGORIES = [];
let BRANDS = [];

function getBrand(id) {
  return BRANDS.find(b => b.id === id) || BRANDS.find(b => b.id === 'aquadesign') || BRANDS[0] || null;
}

// Injecte le logo (et le CSS de marque) dans l'état selon la marque choisie.
function applyBrand(id) {
  const b = getBrand(id);
  if (!b || !state) return;
  state.brand = b.id;
  state.logo = b.logo;
  state.brandCss = b.brandCss || '';
}

function getCategory(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES.find(c => c.id === 'sup') || CATEGORIES[0] || null;
}

// Applique les intitulés figés d'une catégorie : on conserve la 1re cellule
// specsTop (référence) et on impose les labels/ordre des specs comparables.
function applyCategoryLabels(catId) {
  const cat = getCategory(catId);
  if (!cat || !state) return;
  state.category = cat.id;
  if (Array.isArray(state.specsTop)) {
    cat.specsTop.forEach((s, i) => {
      const dst = state.specsTop[i + 1]; // [0] = référence, conservée
      if (dst) dst.label = s.label;
    });
  }
  if (Array.isArray(state.specsDimensions)) {
    cat.specsDimensions.forEach((s, i) => {
      const dst = state.specsDimensions[i];
      if (dst) dst.label = s.label;
    });
  }
}

async function loadTemplate(id) {
  if (TEMPLATES[id]) tplId = id;
  templateHtml = await fetch(TEMPLATES[tplId].file).then(r => r.text());
  state = await fetch(TEMPLATES[tplId].sample).then(r => r.json());
  if (!state.category) state.category = 'sup';
  if (!state.brand) state.brand = 'aquadesign';
  if (BRANDS.length) applyBrand(state.brand);            // injecte le logo
  const sel = document.getElementById('cat-select');
  if (sel && CATEGORIES.length) sel.value = state.category;
  const bsel = document.getElementById('brand-select');
  if (bsel && BRANDS.length) bsel.value = state.brand;
  buildForm();
  refresh();
}

const boot = () => loadTemplate(tplId);

/* ---------- Construction du formulaire ---------- */
function field(label, value, oninput, opts = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'fld';
  const span = document.createElement('span');
  span.textContent = label;
  const input = opts.area ? document.createElement('textarea') : document.createElement('input');
  if (opts.area) input.rows = opts.rows || 5;
  input.value = value ?? '';
  input.addEventListener('input', e => { oninput(e.target.value); scheduleRefresh(); });
  wrap.append(span, input);
  return wrap;
}

function normHex(v) {
  if (!v) return null; v = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map(c => c + c).join('');
  return null;
}

// Sélecteur de couleur : picker + saisie hexadécimale synchronisés
function colorField(label, value, onset) {
  const wrap = document.createElement('label');
  wrap.className = 'fld';
  const span = document.createElement('span'); span.textContent = label;
  const row = document.createElement('div'); row.className = 'colorrow';
  const col = document.createElement('input');
  col.type = 'color'; col.value = normHex(value) || '#000000';
  const txt = document.createElement('input');
  txt.type = 'text'; txt.value = value || ''; txt.placeholder = '#RRGGBB'; txt.className = 'hexin';
  col.addEventListener('input', e => { onset(e.target.value); txt.value = e.target.value; scheduleRefresh(); });
  txt.addEventListener('input', e => {
    const v = e.target.value.trim(); onset(v);
    const n = normHex(v); if (n) col.value = n;
    scheduleRefresh();
  });
  row.append(col, txt); wrap.append(span, row);
  return wrap;
}

const READMORE_MAX = 505;

// Champ description avec limite 505 caractères + compteur
function descriptionField() {
  const wrap = document.createElement('label');
  wrap.className = 'fld';
  const span = document.createElement('span'); span.textContent = 'Texte (max ' + READMORE_MAX + ' caractères)';
  const ta = document.createElement('textarea');
  ta.rows = 8; ta.maxLength = READMORE_MAX; ta.value = state.readMore || '';
  const counter = document.createElement('div');
  counter.className = 'counter';
  const update = () => { counter.textContent = (state.readMore || '').length + ' / ' + READMORE_MAX; };
  ta.addEventListener('input', e => {
    state.readMore = e.target.value.slice(0, READMORE_MAX);
    update(); scheduleRefresh();
  });
  wrap.append(span, ta, counter); update();
  return wrap;
}

// Bloc "Titre + Valeur" éditables pour une cellule (+ toggle d'affichage optionnel)
function twoFields(labelVal, onLabel, valVal, onValue, valueOpts = {}, toggle = null) {
  const on = toggle ? toggle.get() !== false : true;
  const box = document.createElement('div');
  box.className = 'pairgrp' + (on ? '' : ' disabled');
  if (toggle) {
    const t = document.createElement('label'); t.className = 'fld chk-fld';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
    cb.addEventListener('change', e => { toggle.set(e.target.checked); buildForm(); refresh(); });
    const s = document.createElement('span'); s.textContent = 'Afficher cette spec';
    t.append(cb, s); box.appendChild(t);
  }
  box.appendChild(field('Titre', labelVal, onLabel));
  box.appendChild(field('Valeur', valVal, onValue, valueOpts));
  return box;
}

function buildForm() {
  const f = document.getElementById('form');
  f.innerHTML = '';

  const sec = (title) => {
    const h = document.createElement('h3'); h.textContent = title; f.appendChild(h);
  };

  sec('Identité');
  SCHEMA.text.forEach(t => f.appendChild(field(t.label, state[t.key], v => state[t.key] = v)));

  sec('Caractéristiques principales');
  state.specsTop.forEach((s, i) =>
    f.appendChild(twoFields(
      s.label, v => state.specsTop[i].label = v,
      s.value, v => state.specsTop[i].value = v,
      { area: true, rows: 2 },
      { get: () => state.specsTop[i].enabled, set: v => state.specsTop[i].enabled = v })));

  sec('Dimensions');
  state.specsDimensions.forEach((s, i) =>
    f.appendChild(twoFields(
      s.label, v => state.specsDimensions[i].label = v,
      s.value, v => state.specsDimensions[i].value = v,
      {},
      { get: () => state.specsDimensions[i].enabled, set: v => state.specsDimensions[i].enabled = v })));

  sec(tplId === 'generic' ? 'Visuel produit principal' : 'Visuel produit');
  f.appendChild(field('URL ou base64 de l’image', state.image, v => state.image = v));
  f.appendChild(imageUploadField('image', 'Importer l’image (.png/.jpg)', { detectWhiteBg: tplId === 'sup' }));

  if (tplId === 'sup') {
    const bgWrap = document.createElement('label'); bgWrap.className = 'fld chk-fld';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!state.whiteBg;
    cb.addEventListener('change', e => { state.whiteBg = e.target.checked; refresh(); });
    const cbt = document.createElement('span'); cbt.textContent = 'Visuel sur fond blanc (JPG) — dégradé sous le footer';
    bgWrap.append(cb, cbt); f.appendChild(bgWrap);
  }

  if (tplId === 'generic') {
    sec('Photos d’ambiance');
    f.appendChild(field('URL/base64 photo 1', state.image2, v => state.image2 = v));
    f.appendChild(imageUploadField('image2', 'Importer la photo 1 (.png/.jpg)'));
    f.appendChild(field('URL/base64 photo 2', state.image3, v => state.image3 = v));
    f.appendChild(imageUploadField('image3', 'Importer la photo 2 (.png/.jpg)'));

    sec('QR code');
    const w = document.createElement('label'); w.className = 'fld chk-fld';
    const cbq = document.createElement('input'); cbq.type = 'checkbox'; cbq.checked = state.showQr !== false;
    cbq.addEventListener('change', e => { state.showQr = e.target.checked; refresh(); });
    const sq = document.createElement('span'); sq.textContent = 'Afficher le QR code';
    w.append(cbq, sq); f.appendChild(w);
    f.appendChild(field('URL de la page produit (QR)', state.productUrl, v => { state.productUrl = v; scheduleQr(); }));
  }

  if (tplId === 'sup') {
    sec('Pack inclus');
    f.appendChild(field('Intitulé du pack (label vertical)', state.packTitle, v => state.packTitle = v));
    state.pack.forEach((p, i) => {
      const on = p.enabled !== false;
      const box = document.createElement('div'); box.className = 'pairgrp' + (on ? '' : ' disabled');
      const tog = document.createElement('label'); tog.className = 'fld chk-fld';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
      cb.addEventListener('change', e => { state.pack[i].enabled = e.target.checked; buildForm(); refresh(); });
      const tt = document.createElement('span'); tt.textContent = 'Afficher cet élément';
      tog.append(cb, tt); box.appendChild(tog);
      box.appendChild(field('Élément ' + (i + 1), p.label, v => state.pack[i].label = v));
      box.appendChild(field('Sous-texte', p.sub || '', v => state.pack[i].sub = v));
      box.appendChild(packImageField(i, p));
      f.appendChild(box);
    });
  }

  sec('Couleurs du dégradé');
  f.appendChild(colorField('Couleur gauche', state.gradientFrom, v => state.gradientFrom = v));
  f.appendChild(colorField('Couleur droite', state.gradientTo, v => state.gradientTo = v));
  const autoBtn = document.createElement('button');
  autoBtn.type = 'button'; autoBtn.className = 'btn ghost full';
  autoBtn.textContent = '🎨 Couleurs auto depuis le visuel';
  autoBtn.addEventListener('click', async () => {
    autoBtn.disabled = true;
    const ok = await autoGradientFromImage();
    autoBtn.disabled = false;
    if (ok) { buildForm(); refresh(); }
    else autoBtn.textContent = 'Aucune couleur détectée — ajoute d’abord un visuel';
  });
  f.appendChild(autoBtn);

  sec('Description (READ MORE)');
  f.appendChild(descriptionField());

  sec('Points forts');
  state.features.forEach((ft, i) => {
    const box = document.createElement('div'); box.className = 'pairgrp';
    box.appendChild(field('Titre', ft.label, v => state.features[i].label = v));
    const tog = document.createElement('label'); tog.className = 'fld chk-fld';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!ft.check;
    cb.addEventListener('change', e => { state.features[i].check = e.target.checked; buildForm(); refresh(); });
    const t = document.createElement('span'); t.textContent = 'Afficher une coche ✓ (au lieu d’une valeur)';
    tog.append(cb, t); box.appendChild(tog);
    if (!ft.check) box.appendChild(field('Valeur', ft.value, v => state.features[i].value = v));
    f.appendChild(box);
  });
}

// Upload d'un visuel PNG/JPG pour un élément du pack (sinon icône SVG par défaut)
function packImageField(i, p) {
  const wrap = document.createElement('div');
  wrap.className = 'fld';
  const span = document.createElement('span');
  span.textContent = 'Ajouter la photo de l’accessoire en .png ou .jpg';
  const fin = document.createElement('input');
  fin.type = 'file'; fin.accept = 'image/png,image/jpeg'; fin.className = 'filein';
  fin.addEventListener('change', async e => {
    const fl = e.target.files[0]; if (!fl) return;
    state.pack[i].image = await fileToDataUrl(fl);
    buildForm(); refresh();
  });
  wrap.append(span, fin);
  if (p.image) {
    const row = document.createElement('div'); row.className = 'thumbrow';
    const im = document.createElement('img'); im.src = p.image; im.className = 'thumb';
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '✕ retirer'; del.className = 'btn ghost tiny';
    del.addEventListener('click', () => { state.pack[i].image = ''; buildForm(); refresh(); });
    row.append(im, del); wrap.append(row);
  }
  return wrap;
}

function fileToDataUrl(file) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
}

// Upload d'image vers une clé de state (+ vignette + retrait)
function imageUploadField(key, label, opts = {}) {
  const wrap = document.createElement('div'); wrap.className = 'fld';
  const span = document.createElement('span'); span.textContent = label || 'Importer une image (.png/.jpg)';
  const fin = document.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.className = 'filein';
  fin.addEventListener('change', async e => {
    const fl = e.target.files[0]; if (!fl) return;
    state[key] = await fileToDataUrl(fl);
    if (opts.detectWhiteBg) state.whiteBg = /jpe?g/i.test(fl.type);
    if (key === 'image') await autoGradientFromImage();
    buildForm(); refresh();
  });
  wrap.append(span, fin);
  if (state[key]) {
    const row = document.createElement('div'); row.className = 'thumbrow';
    const im = document.createElement('img'); im.src = state[key]; im.className = 'thumb';
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '✕ retirer'; del.className = 'btn ghost tiny';
    del.addEventListener('click', () => { state[key] = ''; buildForm(); refresh(); });
    row.append(im, del); wrap.append(row);
  }
  return wrap;
}

/* ---------- Couleurs auto du dégradé (analyse de la 1ʳᵉ photo) ---------- */
const toHex = c => '#' + [c.r, c.g, c.b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
const darken = (c, f) => ({ r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) });
const colDist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

function dominantColors(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = 64, H = Math.max(1, Math.round(64 * img.height / (img.width || 1)));
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
      let data; try { data = ctx.getImageData(0, 0, W, H).data; } catch { resolve(null); return; }
      const buckets = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 200) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max - min;
        if (max > 235 && sat < 18) continue;   // quasi-blanc (fond)
        if (max < 25) continue;                 // quasi-noir
        if (sat < 22) continue;                 // gris/neutre
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bk = buckets[key] || (buckets[key] = { count: 0, r: 0, g: 0, b: 0 });
        bk.count++; bk.r += r; bk.g += g; bk.b += b;
      }
      const arr = Object.values(buckets)
        .map(b => ({ count: b.count, r: Math.round(b.r / b.count), g: Math.round(b.g / b.count), b: Math.round(b.b / b.count) }))
        .sort((a, b) => b.count - a.count);
      if (!arr.length) { resolve(null); return; }
      const c1 = arr[0];
      let c2 = arr.find((c, i) => i > 0 && colDist(c, c1) > 70) || darken(c1, 0.55);
      resolve([toHex(c1), toHex(c2)]);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function applyColors(cols) {
  if (!cols || cols.length < 2) return false;
  state.gradientFrom = cols[0];
  state.gradientTo = cols[1];
  return true;
}

async function autoGradientFromImage() {
  const src = state.image;
  if (!src) return false;
  if (src.startsWith('data:')) return applyColors(await dominantColors(src)); // upload -> canvas
  try {
    const r = await fetch('/api/colors?url=' + encodeURIComponent(src));     // distante -> serveur
    return applyColors((await r.json()).colors);
  } catch { return false; }
}

// QR code généré depuis l'URL produit (débounce -> /api/qr)
let qrTimer = null;
function scheduleQr() { clearTimeout(qrTimer); qrTimer = setTimeout(generateQrFromUrl, 500); }
async function generateQrFromUrl() {
  const url = (state.productUrl || '').trim();
  if (!url) { state.qr = ''; refresh(); return; }
  try {
    const r = await fetch('/api/qr?text=' + encodeURIComponent(url));
    state.qr = (await r.json()).qr || '';
  } catch { /* ignore */ }
  refresh();
}

/* ---------- Aperçu ---------- */
let refreshTimer = null;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); }

function refresh() {
  const html = render(templateHtml, state);
  const frame = document.getElementById('preview');
  frame.srcdoc = html;
}

/* ---------- Impression / PDF ---------- */
function printSheet() {
  const html = render(templateHtml, state);
  const w = window.open('', '_blank');
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

/* ---------- Extraction IA ---------- */
async function extractFromUrl() {
  const url = document.getElementById('producturl').value.trim();
  const status = document.getElementById('extract-status');
  if (!url) { status.textContent = 'Entrez une URL.'; return; }
  const category = (document.getElementById('cat-select') || {}).value || state.category || 'sup';
  status.textContent = '⏳ Extraction en cours…';
  document.getElementById('extract-btn').disabled = true;
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, category }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    // fusion : on garde la structure, on remplace les valeurs trouvées
    state = mergeExtracted(state, data.data);
    if (tplId === 'generic') {
      state.productUrl = url;
      if (Array.isArray(data.data.gallery)) {
        if (data.data.gallery[0]) state.image2 = data.data.gallery[0];
        if (data.data.gallery[1]) state.image3 = data.data.gallery[1];
      }
    }
    if (!applyColors(data.data.colors)) await autoGradientFromImage(); // dégradé auto
    buildForm(); refresh();
    if (tplId === 'generic') generateQrFromUrl();
    status.textContent = '✅ Données extraites. Vérifiez et ajustez si besoin.';
  } catch (e) {
    status.textContent = '❌ ' + e.message;
  } finally {
    document.getElementById('extract-btn').disabled = false;
  }
}

function mergeExtracted(base, ext) {
  if (!ext) return base;
  const out = JSON.parse(JSON.stringify(base));
  // 'brand' (id de marque) reste piloté par le sélecteur, pas par l'IA.
  ['badge', 'image'].forEach(k => { if (ext[k]) out[k] = ext[k]; });
  if (ext.readMore) out.readMore = String(ext.readMore).slice(0, READMORE_MAX);
  if (ext.name) out.name = ext.name;
  if (typeof ext.whiteBg === 'boolean') out.whiteBg = ext.whiteBg;
  // REF (titre) de la première cellule des caractéristiques principales
  if (ext.ref && out.specsTop[0]) out.specsTop[0].label = ext.ref;
  // L'IA peut substituer titre ET valeur si l'info attendue est absente
  const mergeCell = (dst, s) => {
    if (!dst || !s) return;
    if (s.label) dst.label = s.label;
    if (s.value) dst.value = s.value;
    if (typeof s.enabled === 'boolean') dst.enabled = s.enabled;
  };
  if (Array.isArray(ext.specsTop)) ext.specsTop.forEach((s, i) => mergeCell(out.specsTop[i], s));
  if (Array.isArray(ext.specsDimensions)) ext.specsDimensions.forEach((s, i) => mergeCell(out.specsDimensions[i], s));
  if (Array.isArray(ext.features)) ext.features.forEach((s, i) => {
    const dst = out.features[i]; if (!dst || !s) return;
    if (s.label) dst.label = s.label;
    if (typeof s.check === 'boolean') dst.check = s.check;
    if (dst.check) dst.value = ''; else if (s.value) dst.value = s.value;
  });
  if (Array.isArray(ext.pack) && Array.isArray(out.pack)) ext.pack.forEach((s, i) => {
    const dst = out.pack[i]; if (!dst || !s) return;
    if (s.label) dst.label = s.label;
    if (typeof s.sub === 'string') dst.sub = s.sub;
    if (typeof s.enabled === 'boolean') dst.enabled = s.enabled;
  });
  return out;
}

async function loadCategories() {
  const sel = document.getElementById('cat-select');
  if (!sel) return;
  try {
    const r = await fetch('/api/categories');
    CATEGORIES = (await r.json()).categories || [];
  } catch {
    try { CATEGORIES = (await fetch('/data/categories.json').then(r => r.json())).categories || []; }
    catch { CATEGORIES = []; }
  }
  sel.innerHTML = '';
  CATEGORIES.forEach(c => {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
  });
  sel.value = (state && state.category) || 'sup';
  sel.addEventListener('change', e => {
    applyCategoryLabels(e.target.value);
    buildForm(); refresh();
  });
}

async function loadBrandList() {
  const sel = document.getElementById('brand-select');
  if (!sel) return;
  try {
    const r = await fetch('/api/brands');
    BRANDS = (await r.json()).brands || [];
  } catch {
    try { BRANDS = (await fetch('/data/brands.json').then(r => r.json())).brands || []; }
    catch { BRANDS = []; }
  }
  sel.innerHTML = '';
  BRANDS.forEach(b => {
    const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; sel.appendChild(o);
  });
  if (state) {
    applyBrand(state.brand || 'aquadesign');
    sel.value = state.brand;
    refresh();
  }
  sel.addEventListener('change', e => { applyBrand(e.target.value); refresh(); });
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('tpl-select');
  Object.entries(TEMPLATES).forEach(([id, t]) => {
    const o = document.createElement('option'); o.value = id; o.textContent = t.name; sel.appendChild(o);
  });
  sel.value = tplId;
  sel.addEventListener('change', e => loadTemplate(e.target.value));

  loadCategories();
  loadBrandList();
  boot();
  document.getElementById('print-btn').addEventListener('click', printSheet);
  document.getElementById('extract-btn').addEventListener('click', extractFromUrl);
  document.getElementById('reset-btn').addEventListener('click', async () => {
    state = await fetch(TEMPLATES[tplId].sample).then(r => r.json());
    buildForm(); refresh();
  });
});
