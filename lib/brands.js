/* ============================================================
   Marques (logo + CSS spécifique) — partagé serveur / MCP.
   Le front lit les mêmes données via /api/brands.
   ============================================================ */
const fs = require('fs');
const path = require('path');

let BRANDS = null;
function loadBrands() {
  if (BRANDS) return BRANDS;
  try {
    const p = path.join(__dirname, '..', 'data', 'brands.json');
    BRANDS = JSON.parse(fs.readFileSync(p, 'utf8')).brands || [];
  } catch { BRANDS = []; }
  return BRANDS;
}

function getBrand(id) {
  const b = loadBrands();
  return b.find(x => x.id === id) || b.find(x => x.id === 'aquadesign') || b[0] || null;
}

// Renseigne logo / brandCss à partir de l'id de marque si absents.
function applyBrand(data) {
  if (!data) return data;
  const brand = getBrand(data.brand);
  if (brand) {
    if (!data.logo) data.logo = brand.logo;
    if (data.brandCss == null) data.brandCss = brand.brandCss || '';
  }
  return data;
}

module.exports = { loadBrands, getBrand, applyBrand };
