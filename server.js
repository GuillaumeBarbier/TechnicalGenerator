/* ============================================================
   Serveur web — sert l'éditeur + endpoint d'extraction IA
   (logique d'extraction dans lib/extract.js)
   ============================================================ */
const express = require('express');
const path = require('path');
const { fetchPageText, extractData, providerInfo } = require('./lib/extract');

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
    const { text, image } = await fetchPageText(url);
    const data = await extractData(text, image);
    res.json({ data });
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
