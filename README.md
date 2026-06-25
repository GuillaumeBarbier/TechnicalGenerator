# Générateur de fiches techniques

Interface web pour générer des **fiches techniques produits au format A4 imprimable**.
Deux modes de saisie :

1. **Manuel** — l'équipe remplit les champs, l'aperçu A4 se met à jour en temps réel.
2. **Automatique (IA)** — on colle le lien de la page produit ; un agent Claude extrait
   les données et pré-remplit la fiche.

Premier template livré : **SUP** (stand-up paddle), recréé d'après le template Aquadesign.

---

## Démarrage

```bash
npm install
cp .env.example .env          # puis ouvrez .env et collez votre clé API
npm start
# → http://localhost:3000
```

Sans clé, l'éditeur manuel et l'aperçu fonctionnent ; seule l'extraction IA est désactivée.

## Connecter l'agent IA (où mettre le token)

L'extraction supporte **OpenAI (ChatGPT)** ou **Anthropic (Claude)**.

1. Copiez le modèle de configuration : `cp .env.example .env`
2. Ouvrez `.env` et renseignez votre clé :
   - OpenAI : `OPENAI_API_KEY=sk-...` (clé créée sur platform.openai.com → API keys)
   - ou Claude : `ANTHROPIC_API_KEY=sk-ant-...`
3. `npm start`.

> ⚠️ **Sécurité — la clé ne doit jamais finir sur GitHub.** Elle se met **uniquement** dans le fichier `.env`, qui est listé dans `.gitignore` et donc **jamais commité**. Ne collez jamais de clé dans le code, le README, ou un fichier suivi par git. La clé reste côté serveur (jamais envoyée au navigateur).

> 💡 L'API OpenAI est facturée séparément de l'abonnement ChatGPT : vérifiez vos crédits/moyen de paiement sur platform.openai.com → Billing.

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `AI_PROVIDER` | auto | `openai` ou `anthropic` (auto-détecté selon la clé présente) |
| `OPENAI_API_KEY` | — | clé API OpenAI (ChatGPT) |
| `OPENAI_MODEL` | `gpt-4o-mini` | modèle OpenAI |
| `ANTHROPIC_API_KEY` | — | clé API Claude |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | modèle Claude |
| `PORT` | `3000` | port HTTP |

Pour un déploiement (serveur/hébergeur), définissez ces variables dans l'environnement de l'hôte plutôt que dans un fichier.

---

## Structure

```
server.js              Serveur web Express (éditeur + endpoint /api/extract)
mcp-server.js          Serveur MCP (outils pour piloter le générateur depuis une IA)
lib/extract.js         Extraction IA partagée (OpenAI / Anthropic) + galerie + .env
lib/render.js          Moteur de rendu serveur du template (mustache)
lib/qr.js              Génération de QR code (SVG -> data URI)
templates/sup.html     Template SUP (pack en icônes, dégradé pleine page)
templates/generic.html Template générique (photos d'ambiance + QR, dégradé en bas)
data/categories.json       Schémas de specs comparables par catégorie de produit
data/sample-sup.json       Données par défaut du template SUP
data/sample-generic.json   Données par défaut du template générique
public/index.html      Interface (formulaire + aperçu)
public/app.js          Rendu des variables + formulaire + impression + appel IA (front)
public/editor.css      Styles de l'interface
```

### Le template = HTML + variables dynamiques

`templates/sup.html` est un document HTML autonome (CSS et icônes SVG inclus) calé sur
une page A4 (`794 × 1123 px ≈ 210 × 297 mm`). Les données sont injectées via un petit
moteur type *mustache* (`{{var}}`, `{{#each}}`, `{{#if}}…{{else}}…{{/if}}`).

### Modèle de données (extrait)

```json
{
  "brand": "AQUADESIGN", "badge": "NEW 2026", "name": "IOTA", "ref": "REF. LB 7567",
  "specsTop":        [{ "label": "PROGRAM", "value": "ALL ROUND" }, ...],
  "specsDimensions": [{ "label": "LENGTH 305 cm", "value": "10'0''" }, ...],
  "image": "URL ou base64",
  "pack":   [{ "icon": "leash", "label": "SUP LEASH" }, ...],
  "readMore": "texte de description",
  "features": [{ "label": "SUP FIN", "value": "1" }, { "label": "HIGH-STRENGTH NET", "check": true }]
}
```

Icônes disponibles pour le pack : `leash`, `paddle`, `bag`, `pump`, `fin`, `repair`.

---

## Catégories de produits (specs comparables)

Pour que **toutes les fiches d'une même catégorie se lisent de la même manière**
(mêmes intitulés, même ordre, mêmes unités), les specs à extraire sont définies
par catégorie dans **`data/categories.json`** : SUP, kayak/canoë, gilet, pagaie,
raft, néoprène, coupe-vent et une catégorie générique « autre ».

Chaque catégorie déclare 4 cellules `specsTop` + 4 cellules `specsDimensions`
(la 1ʳᵉ cellule « référence / nom » est ajoutée automatiquement) :

```json
{
  "id": "gilet",
  "name": "Gilet d'aide à la flottabilité",
  "note": "Si une donnée varie selon la taille, exprime-la en PLAGE.",
  "specsTop": [{ "label": "USAGE", "value": "ex: CANOË KAYAK / SUP" }, ...],
  "specsDimensions": [{ "label": "TAILLES", "value": "plage, ex: XS à XXL" }, ...]
}
```

- `label` = intitulé **figé** affiché sur la fiche (garantit la comparabilité).
- `value` = exemple/indice fourni à l'IA.
- `note` = consigne IA spécifique (ex. gérer les **plages** quand l'info est partielle :
  `TAILLES « XS à XXL »`, `FLOTTABILITÉ « 35 à 70N »`).

Dans l'interface, choisissez la catégorie dans l'encart **Extraction IA** avant de
coller l'URL : l'agent applique alors le schéma de la catégorie. Une cellule sans
information est désactivée (`enabled:false`) et les autres se recentrent.

**Pour affiner les specs d'une catégorie** (ou en ajouter une) : éditez simplement
`data/categories.json`, puis relancez le serveur. Le formulaire, l'extraction IA et
le serveur MCP reprennent automatiquement les nouveaux intitulés.

### Ajouter un nouveau *template* (mise en page)

1. Dupliquer `templates/sup.html` → `templates/<nom>.html` et adapter la mise en page.
2. Créer `data/sample-<nom>.json` avec les valeurs par défaut.
3. Enregistrer le template dans `TEMPLATES` (`public/app.js`).

> Les catégories (specs) et les templates (mise en page) sont indépendants :
> un même template peut servir toutes les catégories.

---

## Accès MCP (piloter le générateur depuis une IA)

Le projet expose un **serveur MCP** (Model Context Protocol) : une IA compatible
(Claude Desktop, Claude Code, etc.) peut générer des fiches techniques en appelant
directement des outils.

Outils exposés :

| Outil | Rôle |
|---|---|
| `get_sup_template` | renvoie la structure de données (avec exemple) à remplir |
| `list_product_categories` | liste les catégories et leurs specs comparables figées |
| `extract_product_data` | extrait les données depuis une URL produit + `category` (clé API requise) |
| `generate_sup_fiche` | génère la fiche HTML A4 dans `output/` et renvoie son chemin |

Lancer le serveur MCP (transport stdio) :

```bash
npm run mcp
```

### Connecter Claude Desktop (exemple)

Dans le fichier de config MCP du client (`claude_desktop_config.json`), ajoutez :

```json
{
  "mcpServers": {
    "fiches-techniques": {
      "command": "node",
      "args": ["/chemin/absolu/vers/TechnicalGenerator/mcp-server.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

> La clé API peut être fournie ici (`env`) **ou** via le fichier `.env` du projet.
> L'IA peut alors enchaîner : `extract_product_data(url)` → ajuste les données →
> `generate_sup_fiche(data)` → ouvre le HTML produit dans `output/`.

---

## Impression / export PDF

Bouton **Imprimer / PDF** : ouvre la fiche seule et lance la boîte d'impression du navigateur
(`@page A4`, sans marges). Choisir « Enregistrer au format PDF » pour exporter.
