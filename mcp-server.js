#!/usr/bin/env node
/* ============================================================
   Serveur MCP — expose le générateur de fiches techniques SUP
   à une IA (Claude Desktop, Claude Code, tout client MCP).
   Transport : stdio.
   ============================================================ */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const { renderSup, loadSample } = require('./lib/render');
const { fetchPageText, extractData, providerInfo } = require('./lib/extract');

const OUT_DIR = path.join(__dirname, 'output');

const server = new McpServer({ name: 'fiches-techniques-sup', version: '1.0.0' });

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const text = (t) => ({ content: [{ type: 'text', text: t }] });

/* 1. Schéma / valeurs par défaut de la fiche */
server.registerTool('get_sup_template', {
  title: 'Schéma de la fiche technique SUP',
  description:
    "Retourne la structure de données (avec valeurs d'exemple) d'une fiche technique SUP. " +
    "Remplissez ces mêmes clés puis passez l'objet à generate_sup_fiche.",
  inputSchema: {},
}, async () => json(loadSample()));

/* 2. Extraction depuis une URL produit */
server.registerTool('extract_product_data', {
  title: 'Extraire les données produit depuis une URL',
  description:
    "Récupère une page produit et en extrait les caractéristiques au format de la fiche SUP. " +
    "Nécessite une clé API (OpenAI ou Anthropic) configurée côté serveur (.env). " +
    "Retourne un objet de données prêt à être passé à generate_sup_fiche.",
  inputSchema: { url: z.string().url().describe('URL de la page produit') },
}, async ({ url }) => {
  const { text: pageText, image } = await fetchPageText(url);
  const data = await extractData(pageText, image);
  return json(data);
});

/* 3. Génération de la fiche HTML A4 */
server.registerTool('generate_sup_fiche', {
  title: 'Générer la fiche technique SUP (HTML A4 imprimable)',
  description:
    "Génère la fiche technique imprimable (HTML A4 autonome, polices et logo inclus) à partir d'un objet " +
    "de données conforme à get_sup_template. Les champs manquants reprennent les valeurs par défaut. " +
    "Écrit le fichier dans le dossier output/ et renvoie son chemin absolu.",
  inputSchema: {
    data: z.record(z.string(), z.any()).describe('Objet de données de la fiche (voir get_sup_template)'),
    filename: z.string().optional().describe('Nom de fichier optionnel (sans extension)'),
  },
}, async ({ data, filename }) => {
  const merged = { ...loadSample(), ...(data || {}) };
  if (typeof merged.readMore === 'string') merged.readMore = merged.readMore.slice(0, 505);
  const html = renderSup(merged);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const slug = String(filename || merged.name || 'fiche')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fiche';
  const file = path.join(OUT_DIR, `${slug}-${Date.now()}.html`);
  fs.writeFileSync(file, html);
  return text(
    `Fiche générée : ${file}\n` +
    `Ouvrez ce fichier dans un navigateur, puis imprimez-le en PDF (format A4, sans marges).`
  );
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout est réservé au protocole MCP -> logs sur stderr
  console.error(`MCP « fiches-techniques-sup » prêt — provider IA : ${providerInfo().provider}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
