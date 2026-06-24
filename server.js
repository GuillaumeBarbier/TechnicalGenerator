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

// Structure cible attendue côté front (template SUP).
const SUP_SHAPE = `{
  "brand": "string (marque)",
  "badge": "string (ex: NEW 2026, ou vide)",
  "name": "string (nom du modèle)",
  "ref": "string (référence, ex: REF. LB 7567)",
  "specsTop": [
    {"label":"PROGRAM","value":""},
    {"label":"TECHNOLOGY","value":""},
    {"label":"LEVEL","value":""},
    {"label":"WEIGHT","value":""},
    {"label":"MAX. LOAD","value":""}
  ],
  "specsDimensions": [
    {"label":"LENGTH","value":"valeur métrique + impériale ex: 10'0''"},
    {"label":"WIDTH","value":""},
    {"label":"THICKNESS","value":""},
    {"label":"VOLUME","value":""}
  ],
  "features": [
    {"label":"SUP FIN","value":""},
    {"label":"CROCO EVA PAD","value":""},
    {"label":"INCLUDED PACK","value":""},
    {"label":"FUSION DROPSTITCH","value":""},
    {"label":"HIGH-STRENGTH NET","value":""}
  ],
  "readMore": "string (description marketing)",
  "image": "string (URL absolue du visuel principal, ou vide)"
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
    "Garde les valeurs courtes et en majuscules comme sur une fiche technique. " +
    "Pour les dimensions, combine métrique et impérial si disponibles. " +
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
