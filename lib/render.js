/* ============================================================
   Rendu serveur du template (même moteur mustache que le front)
   ============================================================ */
const fs = require('fs');
const path = require('path');

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
      } else { nodes.push(tk); i++; }
    }
    return nodes;
  }
  return walk(null);
}

function resolve(p, ctx, root) {
  if (p === '.' || p === 'this') return ctx;
  let cur = (p[0] === '@') ? root : ctx;
  for (const part of p.split('.')) {
    if (part === 'this' || part === '') continue;
    if (cur == null) return undefined;
    cur = cur[part];
  }
  if (cur === undefined && ctx !== root) {
    cur = root;
    for (const part of p.split('.')) { if (cur == null) return undefined; cur = cur[part]; }
  }
  return cur;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderNodes(nodes, ctx, root) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') out += n.raw
      ? String(resolve(n.v, ctx, root) ?? '')
      : esc(resolve(n.v, ctx, root) ?? '').replace(/\n/g, '<br>');
    else if (n.t === 'block') {
      let truePart = n.body, elsePart = [];
      const ei = n.body.findIndex(x => x.t === 'else');
      if (ei >= 0) { truePart = n.body.slice(0, ei); elsePart = n.body.slice(ei + 1); }
      const val = resolve(n.arg, ctx, root);
      if (n.kw === 'each') {
        if (Array.isArray(val) && val.length) val.forEach(item => { out += renderNodes(truePart, item, root); });
        else out += renderNodes(elsePart, ctx, root);
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

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'sup.html');
const SAMPLE_PATH = path.join(__dirname, '..', 'data', 'sample-sup.json');

const { applyBrand } = require('./brands');

const loadTemplate = () => fs.readFileSync(TEMPLATE_PATH, 'utf8');
const loadSample = () => JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
const renderSup = (data) => render(loadTemplate(), applyBrand({ ...data }));

module.exports = { render, renderSup, loadTemplate, loadSample };
