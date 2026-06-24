/* ============================================================
   Générateur de fiches techniques — logique front
   ============================================================ */

/* ---------- Mini moteur de template (mustache-like) ----------
   Supporte :  {{var}}  {{a.b}}  {{#each list}}…{{/each}}
               {{#if cond}}…{{else}}…{{/if}}                      */
function tokenize(str) {
  const re = /\{\{\{?\s*([#\/]?)\s*([^}]*?)\s*\}?\}\}/g;
  const tokens = [];
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: str.slice(last, m.index) });
    const sigil = m[1], body = m[2].trim();
    if (sigil === '#') {
      const [kw, ...rest] = body.split(/\s+/);
      tokens.push({ t: 'open', kw, arg: rest.join(' ') });
    } else if (sigil === '/') {
      tokens.push({ t: 'close', kw: body });
    } else if (body === 'else') {
      tokens.push({ t: 'else' });
    } else {
      tokens.push({ t: 'var', v: body });
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
    else if (n.t === 'var') out += esc(resolve(n.v, ctx, root) ?? '').replace(/\n/g, '<br>');
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

/* ---------- Schéma du formulaire SUP ---------- */
const SCHEMA = {
  text: [
    { key: 'brand', label: 'Marque' },
    { key: 'badge', label: 'Badge (ex: NEW 2026)' },
    { key: 'name', label: 'Nom du modèle' },
    { key: 'ref', label: 'Référence' },
  ],
  specsTop: ['PROGRAM', 'TECHNOLOGY', 'LEVEL', 'WEIGHT', 'MAX. LOAD'],
  dims: ['LENGTH', 'WIDTH', 'THICKNESS', 'VOLUME'],
};

let state = null;
let templateHtml = '';

async function boot() {
  templateHtml = await fetch('/templates/sup.html').then(r => r.text());
  state = await fetch('/data/sample-sup.json').then(r => r.json());
  buildForm();
  refresh();
}

/* ---------- Construction du formulaire ---------- */
function field(label, value, oninput, opts = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'fld';
  const span = document.createElement('span');
  span.textContent = label;
  const input = opts.area ? document.createElement('textarea') : document.createElement('input');
  if (opts.area) input.rows = 5;
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
    f.appendChild(field(s.label, s.value, v => state.specsTop[i].value = v)));

  sec('Dimensions');
  state.specsDimensions.forEach((s, i) =>
    f.appendChild(field(s.label, s.value, v => state.specsDimensions[i].value = v)));

  sec('Visuel produit');
  f.appendChild(field('URL ou base64 de l’image', state.image, v => state.image = v));
  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.className = 'filein';
  file.addEventListener('change', async e => {
    const fl = e.target.files[0]; if (!fl) return;
    state.image = await fileToDataUrl(fl);
    state.whiteBg = /jpe?g/i.test(fl.type); // JPG = fond blanc, PNG = transparent
    buildForm(); refresh();
  });
  f.appendChild(file);

  const bgWrap = document.createElement('label');
  bgWrap.className = 'fld chk-fld';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !!state.whiteBg;
  cb.addEventListener('change', e => { state.whiteBg = e.target.checked; refresh(); });
  const cbt = document.createElement('span');
  cbt.textContent = 'Visuel sur fond blanc (JPG) — dégradé sous le footer';
  bgWrap.append(cb, cbt);
  f.appendChild(bgWrap);

  sec('Pack inclus');
  state.pack.forEach((p, i) => {
    f.appendChild(field('Élément ' + (i + 1) + ' (' + p.icon + ')', p.label, v => state.pack[i].label = v));
    f.appendChild(field('  ↳ sous-texte', p.sub || '', v => state.pack[i].sub = v));
    f.appendChild(packImageField(i, p));
  });

  sec('Couleurs du dégradé');
  f.appendChild(colorField('Couleur gauche', state.gradientFrom, v => state.gradientFrom = v));
  f.appendChild(colorField('Couleur droite', state.gradientTo, v => state.gradientTo = v));

  sec('Description (READ MORE)');
  f.appendChild(field('Texte', state.readMore, v => state.readMore = v, { area: true }));

  sec('Caractéristiques bas de page');
  state.features.forEach((ft, i) =>
    f.appendChild(field(ft.label, ft.check ? '✓ (case cochée)' : ft.value,
      v => { if (!ft.check) state.features[i].value = v; })));
}

// Upload d'un visuel PNG/JPG pour un élément du pack (sinon icône SVG par défaut)
function packImageField(i, p) {
  const wrap = document.createElement('div');
  wrap.className = 'fld';
  const span = document.createElement('span');
  span.textContent = '  ↳ visuel (PNG/JPG) — sinon icône par défaut';
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
  status.textContent = '⏳ Extraction en cours…';
  document.getElementById('extract-btn').disabled = true;
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, category: 'sup' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    // fusion : on garde la structure, on remplace les valeurs trouvées
    state = mergeExtracted(state, data.data);
    buildForm(); refresh();
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
  ['brand', 'badge', 'name', 'ref', 'readMore', 'image'].forEach(k => { if (ext[k]) out[k] = ext[k]; });
  if (Array.isArray(ext.specsTop)) ext.specsTop.forEach((s, i) => { if (out.specsTop[i] && s.value) out.specsTop[i].value = s.value; });
  if (Array.isArray(ext.specsDimensions)) ext.specsDimensions.forEach((s, i) => { if (out.specsDimensions[i] && s.value) out.specsDimensions[i].value = s.value; });
  if (Array.isArray(ext.features)) ext.features.forEach((s, i) => { if (out.features[i] && s.value) out.features[i].value = s.value; });
  return out;
}

document.addEventListener('DOMContentLoaded', () => {
  boot();
  document.getElementById('print-btn').addEventListener('click', printSheet);
  document.getElementById('extract-btn').addEventListener('click', extractFromUrl);
  document.getElementById('reset-btn').addEventListener('click', async () => {
    state = await fetch('/data/sample-sup.json').then(r => r.json());
    buildForm(); refresh();
  });
});
