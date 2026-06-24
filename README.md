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
export ANTHROPIC_API_KEY=sk-ant-...      # nécessaire seulement pour l'extraction IA
npm start
# → http://localhost:3000
```

Sans clé API, l'éditeur manuel et l'aperçu fonctionnent ; seule l'extraction IA est désactivée.

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | port HTTP |
| `ANTHROPIC_API_KEY` | — | clé API Claude (extraction IA) |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | modèle utilisé pour l'extraction |

---

## Structure

```
server.js              Serveur Express + endpoint /api/extract (récupère la page, appelle Claude)
templates/sup.html     Template A4 du SUP, avec variables {{…}}, boucles {{#each}}, icônes SVG
data/sample-sup.json   Données d'exemple (la planche IOTA) + schéma de données
public/index.html      Interface (formulaire + aperçu)
public/app.js          Moteur de rendu des variables + formulaire + impression + appel IA
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

## Ajouter une nouvelle catégorie de produit

1. Dupliquer `templates/sup.html` → `templates/<categorie>.html` et adapter la mise en page.
2. Créer `data/sample-<categorie>.json` avec les valeurs par défaut.
3. Adapter le schéma de formulaire dans `public/app.js` (section `SCHEMA` / `buildForm`).
4. Côté extraction, adapter `SUP_SHAPE` dans `server.js` pour la nouvelle catégorie.

> L'architecture est volontairement prévue pour décliner un template par catégorie de produit.

---

## Impression / export PDF

Bouton **Imprimer / PDF** : ouvre la fiche seule et lance la boîte d'impression du navigateur
(`@page A4`, sans marges). Choisir « Enregistrer au format PDF » pour exporter.
