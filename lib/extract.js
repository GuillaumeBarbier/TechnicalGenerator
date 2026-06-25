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

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: text.slice(0, 18000), image };
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
    {"label": "LONGUEUR <cm> cm", "value": "longueur en pieds/pouces (ex: 10')"},
    {"label": "LARGEUR <cm> cm", "value": "largeur en pouces (ex: 31'')"},
    {"label": "ÉPAISSEUR <cm> cm", "value": "épaisseur en pouces (ex: 5'')"},
    {"label": "VOLUME", "value": "volume (ex: 240 L)"}
  ],
  "features": [
    {"label": "titre du point fort 1", "value": "valeur (ou 'CHECK' pour une coche)"},
    {"label": "titre du point fort 2", "value": "valeur"},
    {"label": "titre du point fort 3", "value": "valeur"},
    {"label": "titre du point fort 4", "value": "valeur"},
    {"label": "titre du point fort 5", "value": "valeur"}
  ],
  "readMore": "description marketing en MAJUSCULES, 505 caractères MAXIMUM (espaces compris)",
  "image": "URL absolue du visuel principal, ou vide"
}`;

const SYSTEM_PROMPT =
  "Tu es un assistant qui extrait les caractéristiques d'un Stand-Up Paddle (SUP) " +
  "depuis le contenu texte d'une page produit. Renseigne au mieux la structure JSON demandée. " +
  "Garde les valeurs courtes et EN MAJUSCULES comme sur une fiche technique. " +
  "Pour les dimensions, mets la valeur métrique (cm) dans le label et l'impérial dans value. " +
  "Le champ readMore est une description marketing EN MAJUSCULES limitée à 505 caractères MAXIMUM (espaces compris) — résume si besoin. " +
  "Pour specsTop et features : essaie d'abord de renseigner l'information correspondant au label demandé ; " +
  "si elle est introuvable sur la page, tu PEUX remplacer le titre (label) ET la valeur par une autre " +
  "caractéristique intéressante pour la fiche technique (courte, en MAJUSCULES). " +
  "Laisse une valeur vide ('') seulement si tu n'as vraiment rien de pertinent. Réponds UNIQUEMENT par un objet JSON valide.";

const buildUserPrompt = (pageText) =>
  `Voici le contenu de la page produit :\n\n${pageText}\n\n` +
  `Renvoie un objet JSON respectant EXACTEMENT cette forme (mêmes clés et même ordre des tableaux) :\n${SUP_SHAPE}`;

function finalize(data, fallbackImage) {
  if (!data.image && fallbackImage) data.image = fallbackImage;
  if (typeof data.readMore === 'string') data.readMore = data.readMore.slice(0, 505);
  return data;
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
