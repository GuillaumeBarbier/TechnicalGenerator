/* ============================================================
   Serveur web — sert l'éditeur + endpoint d'extraction IA
   (logique d'extraction dans lib/extract.js)
   ============================================================ */
const express = require('express');
const path = require('path');
const { fetchPageText, extractData, providerInfo } = require('./lib/extract');
const { generateQr } = require('./lib/qr');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/templates', express.static(path.join(__dirname, 'templates')));
app.use('/data', express.static(path.join(__dirname, 'data')));

app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL invalide.' });
  }
  try {
    const { text, image, gallery } = await fetchPageText(url);
    const data = await extractData(text, image);
    data.gallery = gallery || [];
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy d'image (renvoie une data URL) -> permet l'analyse couleur côté client sans CORS.
app.get('/api/fetch-image', async (req, res) => {
  try {
    const u = String(req.query.url || '');
    if (!/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'URL invalide.' });
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (FicheTechniqueBot/1.0)' } });
    if (!r.ok) return res.status(502).json({ error: 'HTTP ' + r.status });
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct)) return res.status(415).json({ error: 'Pas une image.' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.json({ dataUrl: `data:${ct};base64,` + buf.toString('base64') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/qr', async (req, res) => {
  try {
    res.json({ qr: await generateQr(req.query.text || '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ...providerInfo() });
});

app.listen(PORT, () => {
  const { provider, model, hasKey } = providerInfo();
  console.log(`▶ Générateur de fiches techniques : http://localhost:${PORT}`);
  console.log(`  Fournisseur IA : ${provider} (${model})`);
  if (!hasKey) {
    console.log(`  (⚠ clé API ${provider === 'anthropic' ? 'ANTHROPIC' : 'OPENAI'} non définie — l’extraction IA sera désactivée)`);
  }
});
