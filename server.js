/* ============================================================
   Serveur — sert l'éditeur + endpoint d'extraction IA
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/templates', express.static(path.join(__dirname, 'templates')));
app.use('/data', express.static(path.join(__dirname, 'data')));

/* ---------- Outils d'extraction ---------- */

// Récupère le HTML d'une page produit et en extrait un texte lisible.
async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FicheTechniqueBot/1.0)' },
  });
  if (!res.ok) throw new Error(`Page inaccessible (HTTP ${res.status})`);
  let html = await res.text();

  // Récupère une image candidate (og:image en priorité)
  let image = '';
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) image = og[1];

  // Nettoyage en texte
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: text.slice(0, 18000), image };
}

// Structure cible attendue côté front (template SUP). Valeurs en MAJUSCULES.
const SUP_SHAPE = `{
  "brand": "marque (ex: AQUADESIGN)",
  "badge": "badge (ex: NEW 2026, ou vide)",
  "name": "nom du modèle (ex: IOTA)",
  "ref": "référence (ex: REF. LB7567)",
  "specsTop": [
    {"value": "nom du modèle (identique à name)"},
    {"value": "niveau (ex: DÉBUTANT INTERMÉDIAIRE)"},
    {"value": "programme (ex: ALL ROUND)"},
    {"value": "technologie (ex: DROPSTITCH FUSION)"},
    {"value": "charge max (ex: JUSQU'À 135 KG)"}
  ],
  "specsDimensions": [
    {"label": "LONGUEUR <cm> cm", "value": "longueur en pieds/pouces (ex: 10')"},
    {"label": "LARGEUR <cm> cm", "value": "largeur en pouces (ex: 31'')"},
    {"label": "ÉPAISSEUR <cm> cm", "value": "épaisseur en pouces (ex: 5'')"},
    {"label": "VOLUME", "value": "volume (ex: 240 L)"}
  ],
  "features": [
    {"value": "point fort 1"},
    {"value": "point fort 2"},
    {"value": "point fort 3"},
    {"value": "point fort 4"},
    {"value": "point fort 5"}
  ],
  "readMore": "description marketing en MAJUSCULES, 505 caractères MAXIMUM (espaces compris)",
  "image": "URL absolue du visuel principal, ou vide"
}`;

async function extractWithClaude(pageText, fallbackImage) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch { throw new Error('SDK Anthropic non installé (npm install).'); }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY manquante côté serveur.');
  }
  const client = new Anthropic();

  const system =
    "Tu es un assistant qui extrait les caractéristiques d'un Stand-Up Paddle (SUP) " +
    "depuis le contenu texte d'une page produit. Renseigne au mieux la structure JSON demandée. " +
    "Garde les valeurs courtes et EN MAJUSCULES comme sur une fiche technique. " +
    "Pour les dimensions, mets la valeur métrique (cm) dans le label et l'impérial dans value. " +
    "Le champ readMore est une description marketing EN MAJUSCULES limitée à 505 caractères MAXIMUM (espaces compris) — résume si besoin. " +
    "Pour features, donne 5 points forts courts. " +
    "Laisse une valeur vide ('') si l'information est introuvable. Réponds UNIQUEMENT par le JSON.";

  const user =
    `Voici le contenu de la page produit :\n\n${pageText}\n\n` +
    `Renvoie un objet JSON respectant EXACTEMENT cette forme (mêmes clés et même ordre des tableaux) :\n${SUP_SHAPE}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const txt = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
  const data = JSON.parse(json);
  if (!data.image && fallbackImage) data.image = fallbackImage;
  if (typeof data.readMore === 'string') data.readMore = data.readMore.slice(0, 505);
  return data;
}

/* ---------- Routes ---------- */

app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL invalide.' });
  }
  try {
    const { text, image } = await fetchPageText(url);
    const data = await extractWithClaude(text, image);
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: !!process.env.ANTHROPIC_API_KEY });
});

app.listen(PORT, () => {
  console.log(`▶ Générateur de fiches techniques : http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  (⚠ ANTHROPIC_API_KEY non définie — l’extraction IA sera désactivée)');
  }
});
