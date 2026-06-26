/* ============================================================
   Serveur web — sert l'éditeur + endpoint d'extraction IA
   (logique d'extraction dans lib/extract.js)
   ============================================================ */
const express = require('express');
const path = require('path');
const { fetchPageText, extractData, providerInfo, loadCategories } = require('./lib/extract');
const { loadBrands } = require('./lib/brands');
const { generateQr } = require('./lib/qr');
const { dominantColorsFromUrl } = require('./lib/colors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/templates', express.static(path.join(__dirname, 'templates')));
app.use('/data', express.static(path.join(__dirname, 'data')));

app.post('/api/extract', async (req, res) => {
  const { url, category } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL invalide.' });
  }
  try {
    const { text, image, gallery } = await fetchPageText(url);
    const data = await extractData(text, image, category);
    data.gallery = gallery || [];
    try { data.colors = await dominantColorsFromUrl(data.image || image); } catch { data.colors = null; }
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/categories', (_req, res) => {
  res.json({ categories: loadCategories() });
});

app.get('/api/brands', (_req, res) => {
  res.json({ brands: loadBrands() });
});

app.get('/api/colors', async (req, res) => {
  try {
    const u = String(req.query.url || '');
    if (!/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'URL invalide.' });
    res.json({ colors: await dominantColorsFromUrl(u) });
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
