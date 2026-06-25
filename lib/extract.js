/* ============================================================
   Extraction des données produit (OpenAI ou Anthropic)
   Réutilisé par le serveur web (server.js) et le serveur MCP.
   ============================================================ */
const path = require('path');
const fs = require('fs');

// Charge un .env local (jamais commité) s'il existe.
function loadEnv() {
  try {
    const p = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][\w.-]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1];
      const v = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* ignore */ }
}
loadEnv();

// Ignore les clés restées sur la valeur d'exemple (.env mal rempli) -> message clair.
for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
  if (process.env[k] && /votre[-_ ]?cle/i.test(process.env[k])) delete process.env[k];
}

const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

function pickProvider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p === 'openai') return 'openai';
  if (p === 'anthropic' || p === 'claude') return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'openai';
}

function providerInfo() {
  const provider = pickProvider();
  return {
    provider,
    model: provider === 'anthropic' ? ANTHROPIC_MODEL() : OPENAI_MODEL(),
    hasKey: provider === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY,
  };
}

async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FicheTechniqueBot/1.0)' },
  });
  if (!res.ok) throw new Error(`Page inaccessible (HTTP ${res.status})`);
  const html = await res.text();

  let image = '';
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) image = og[1];

  // Galerie : images candidates de la page (hors logos/icônes), dédupliquées.
  const norm = (u) => { if (u.startsWith('//')) u = 'https:' + u; return u; };
  const mainBase = (image || '').split('?')[0];
  const seen = new Set(), gallery = [];
  const re = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi;
  let mm;
  while ((mm = re.exec(html)) !== null) {
    let u = norm(mm[1]);
    if (!/^https?:/i.test(u)) continue;
    const base = u.split('?')[0];
    if (base === mainBase) continue;
    if (/logo|icon|sprite|payment|badge|flag|favicon|placeholder/i.test(base)) continue;
    if (seen.has(base)) continue;
    seen.add(base); gallery.push(u);
    if (gallery.length >= 8) break;
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: text.slice(0, 18000), image, gallery };
}

const SUP_SHAPE = `{
  "brand": "marque (ex: AQUADESIGN)",
  "badge": "badge (ex: NEW 2026, ou vide)",
  "name": "nom du modèle (ex: IOTA)",
  "ref": "référence (ex: REF. LB7567)",
  "specsTop": [
    {"label": "la référence (ex: REF. LB7567)", "value": "nom du modèle (identique à name)"},
    {"label": "PROGRAMME", "value": "ex: ALL ROUND"},
    {"label": "NIVEAU", "value": "ex: DÉBUTANT INTERMÉDIAIRE"},
    {"label": "TECHNOLOGIE", "value": "ex: DROPSTITCH FUSION"},
    {"label": "CHARGE MAX.", "value": "ex: JUSQU'À 135 KG"}
  ],
  "specsDimensions": [
    {"label": "LONGUEUR 305 cm (remplace par la vraie mesure)", "value": "longueur en pieds/pouces (ex: 10')"},
    {"label": "LARGEUR 79 cm (remplace par la vraie mesure)", "value": "largeur en pouces (ex: 31'')"},
    {"label": "ÉPAISSEUR 13 cm (remplace par la vraie mesure)", "value": "épaisseur en pouces (ex: 5'')"},
    {"label": "VOLUME", "value": "volume (ex: 240 L)"}
  ],
  "features": [
    {"label": "titre du point fort 1 (vrai argument de vente)", "value": "valeur courte, ou 'CHECK' pour une coche"},
    {"label": "titre du point fort 2", "value": "valeur ou 'CHECK'"},
    {"label": "titre du point fort 3", "value": "valeur ou 'CHECK'"},
    {"label": "titre du point fort 4", "value": "valeur ou 'CHECK'"},
    {"label": "titre du point fort 5", "value": "valeur ou 'CHECK'"}
  ],
  "pack": [
    {"label": "ACCESSOIRE 1 (nom court en MAJUSCULES)", "sub": "référence si dispo, sinon vide", "enabled": true},
    {"label": "ACCESSOIRE 2", "sub": "", "enabled": true},
    {"label": "ACCESSOIRE 3", "sub": "", "enabled": true},
    {"label": "ACCESSOIRE 4", "sub": "", "enabled": true},
    {"label": "ACCESSOIRE 5", "sub": "", "enabled": true},
    {"label": "ACCESSOIRE 6", "sub": "", "enabled": true}
  ],
  "readMore": "description marketing en MAJUSCULES, 505 caractères MAXIMUM (espaces compris)",
  "image": "URL absolue du visuel principal, ou vide"
}`;

const SYSTEM_PROMPT =
  "Tu es un assistant qui extrait les caractéristiques d'un Stand-Up Paddle (SUP) " +
  "depuis le contenu texte d'une page produit. Renseigne au mieux la structure JSON demandée. " +
  "Garde les valeurs courtes et EN MAJUSCULES comme sur une fiche technique. " +
  "N'écris JAMAIS de texte indicatif entre chevrons (ex: <cm>) ni le mot d'exemple : mets toujours la vraie donnée, sinon laisse vide. " +
  "specsDimensions : le label contient la mesure en cm (ex: 'LONGUEUR 305 cm', n'écris 'cm' qu'une seule fois) et value l'équivalent en pieds/pouces. " +
  "specsTop : si une valeur fait 2 mots ou plus, garde-la telle quelle (le système la répartira sur 2 lignes). " +
  "Le champ readMore est une description marketing EN MAJUSCULES limitée à 505 caractères MAXIMUM (espaces compris) — résume si besoin. " +
  "pack : liste les accessoires RÉELLEMENT inclus ; un emplacement par accessoire (label = nom court en MAJUSCULES, sub = référence si disponible). " +
  "Mets \"enabled\": false sur TOUS les emplacements restants non utilisés. Si aucun accessoire n'est identifiable, mets enabled=false partout. " +
  "features (points forts) : de VRAIS arguments de vente (construction, matériaux, technologie, stabilité, garantie...). " +
  "Ne liste PAS le détail des accessoires ici (c'est le rôle de pack) : pour un atout binaire comme un pack fourni, mets le titre synthétique (ex: 'PACK COMPLET') avec la valeur 'CHECK' (une coche s'affichera). " +
  "Pour specsTop et features : si l'info attendue est introuvable, tu PEUX remplacer le titre ET la valeur par une autre caractéristique pertinente (courte, MAJUSCULES). " +
  "Laisse une valeur vide ('') seulement si tu n'as vraiment rien de pertinent. Réponds UNIQUEMENT par un objet JSON valide.";

const buildUserPrompt = (pageText) =>
  `Voici le contenu de la page produit :\n\n${pageText}\n\n` +
  `Renvoie un objet JSON respectant EXACTEMENT cette forme (mêmes clés et même ordre des tableaux) :\n${SUP_SHAPE}`;

// Répartit une valeur de 2 mots ou plus sur 2 lignes équilibrées (via \n).
function balanceTwoLines(str) {
  if (typeof str !== 'string' || str.includes('\n')) return str;
  const w = str.trim().split(/\s+/);
  if (w.length < 2) return str;
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < w.length; i++) {
    const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return w.slice(0, best).join(' ') + '\n' + w.slice(best).join(' ');
}

// Nettoie une chaîne : placeholders <...> résiduels, unités dupliquées, espaces.
function clean(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/<[^>]*>/g, '')                 // supprime les placeholders <...> recopiés
    .replace(/\b(cm|kg|l)\b(\s+\1\b)+/gi, '$1') // "cm cm" -> "cm"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Normalise la sortie IA pour coller au template.
function normalize(data) {
  for (const key of ['specsTop', 'specsDimensions', 'features', 'pack']) {
    if (Array.isArray(data[key])) {
      data[key].forEach(c => {
        if (!c) return;
        if (typeof c.label === 'string') c.label = clean(c.label);
        if (typeof c.value === 'string') c.value = clean(c.value);
        if (typeof c.sub === 'string') c.sub = clean(c.sub);
      });
    }
  }
  if (Array.isArray(data.specsTop)) {
    data.specsTop.forEach(c => { if (c && typeof c.value === 'string') c.value = balanceTwoLines(c.value); });
  }
  if (Array.isArray(data.features)) {
    data.features.forEach(f => {
      if (!f) return;
      if (typeof f.value === 'string' && f.value.trim().toUpperCase() === 'CHECK') { f.check = true; f.value = ''; }
      else f.check = false;
    });
  }
  // Mode "fond blanc" déduit du type d'image (jpg = fond plein, png = transparent)
  if (data.image) {
    const u = String(data.image).toLowerCase();
    if (/\.(jpg|jpeg)(\?|#|$)/.test(u) || u.startsWith('data:image/jpeg')) data.whiteBg = true;
    else if (/\.png(\?|#|$)/.test(u) || u.startsWith('data:image/png')) data.whiteBg = false;
  }
  return data;
}

function finalize(data, fallbackImage) {
  if (!data.image && fallbackImage) data.image = fallbackImage;
  if (typeof data.readMore === 'string') data.readMore = data.readMore.slice(0, 505);
  return normalize(data);
}

async function extractWithOpenAI(pageText, fallbackImage) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY manquante côté serveur.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(pageText) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return finalize(JSON.parse(j.choices?.[0]?.message?.content || '{}'), fallbackImage);
}

async function extractWithClaude(pageText, fallbackImage) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch { throw new Error('SDK Anthropic non installé (npm install).'); }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante côté serveur.');
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL(),
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(pageText) }],
  });
  const txt = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
  return finalize(JSON.parse(json), fallbackImage);
}

async function extractData(pageText, image) {
  return pickProvider() === 'anthropic'
    ? extractWithClaude(pageText, image)
    : extractWithOpenAI(pageText, image);
}

module.exports = { loadEnv, fetchPageText, extractData, pickProvider, providerInfo };
