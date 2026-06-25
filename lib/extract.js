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

  // Galerie : on garde les images DU produit (token distinctif issu du nom de fichier
  // de l'image principale, ex. ORYA / ZOOM) et on met les photos "lifestyle" en premier.
  const fileOf = u => (u.split('/').pop() || '').split('?')[0].toLowerCase();
  const STOP = new Set(['sup','web','pack','combo','front','back','light','gonflable','stand','paddle',
    'kayak','gilet','aquadesign','aqds','situ','photo','studio','files','shop','mooving','sarl',
    'barbier','guillaume','combopack','1080','1920','1920px','1080px']);
  const mainFile = fileOf(image || '');
  const tokens = [...new Set(mainFile.split(/[^a-z0-9]+/i)
    .filter(t => t.length >= 4 && /[a-z]/i.test(t) && !STOP.has(t.toLowerCase())))];
  const tokRe = tokens.length ? new RegExp(tokens.join('|'), 'i') : null;
  const packRe = /front|back|-web|_web|combo|pack|_45|-45/i;

  const seen = new Set(); let cand = [];
  const re = /<img[^>]+(?:src|data-src|data-original|srcset|data-srcset)=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi;
  let mm;
  while ((mm = re.exec(html)) !== null) {
    let u = mm[1].split(',')[0].trim().split(' ')[0]; // gère srcset
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:/i.test(u)) continue;
    const f = fileOf(u);
    if (f === mainFile) continue;
    if (/logo|icon|sprite|payment|badge|flag|favicon|placeholder/i.test(f)) continue;
    if (seen.has(f)) continue;
    seen.add(f); cand.push(u);
  }
  let gallery = tokRe ? cand.filter(u => tokRe.test(fileOf(u))) : cand;
  if (gallery.length < 2) gallery = cand;                       // repli si trop filtré
  gallery.sort((a, b) => (packRe.test(fileOf(a)) ? 1 : 0) - (packRe.test(fileOf(b)) ? 1 : 0));
  gallery = gallery.slice(0, 8);

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
    {"label": "la référence (ex: REF. LB7567)", "value": "nom du modèle (identique à name)", "enabled": true},
    {"label": "ex: PROGRAMME", "value": "ex: ALL ROUND", "enabled": true},
    {"label": "ex: NIVEAU", "value": "ex: DÉBUTANT INTERMÉDIAIRE", "enabled": true},
    {"label": "ex: TECHNOLOGIE", "value": "ex: DROPSTITCH FUSION", "enabled": true},
    {"label": "ex: CHARGE MAX.", "value": "ex: JUSQU'À 135 KG", "enabled": true}
  ],
  "specsDimensions": [
    {"label": "ex: LONGUEUR 305 cm", "value": "ex: 10'", "enabled": true},
    {"label": "ex: LARGEUR 79 cm", "value": "ex: 31''", "enabled": true},
    {"label": "ex: ÉPAISSEUR 13 cm", "value": "ex: 5''", "enabled": true},
    {"label": "ex: VOLUME", "value": "ex: 240 L", "enabled": true}
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
  "N'écris JAMAIS de texte indicatif (les 'ex:' du gabarit, ni de chevrons <...>) : mets la vraie donnée, sinon laisse vide ou désactive la cellule. " +
  "IMPORTANT — ADAPTE les specs au TYPE DE PRODUIT réel (paddle, gilet, kayak, pagaie, pompe...). " +
  "Les labels du gabarit sont des EXEMPLES de SUP : remplace-les par les caractéristiques pertinentes du produit. " +
  "Ex. un gilet n'a pas de longueur/largeur/épaisseur/volume de planche : utilise plutôt TAILLE, POIDS, FLOTTABILITÉ, NORME, MATIÈRE, etc. " +
  "Pour CHAQUE cellule de specsTop et specsDimensions, si la caractéristique ne s'applique pas au produit, mets \"enabled\": false " +
  "(la cellule sera masquée et les autres recentrées). Ne laisse JAMAIS une valeur d'exemple SUP sur un produit qui n'est pas un SUP. " +
  "specsDimensions : si applicable, le label contient la mesure métrique (ex: 'LONGUEUR 305 cm', 'cm' une seule fois) et value l'unité usuelle. " +
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
