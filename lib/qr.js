/* Génération de QR code (SVG -> data URI, intégrable et imprimable) */
const QRCode = require('qrcode');

async function generateQr(text) {
  if (!text) return '';
  const svg = await QRCode.toString(String(text), {
    type: 'svg',
    margin: 1,
    color: { dark: '#000000', light: '#00000000' }, // fond transparent
  });
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

module.exports = { generateQr };
