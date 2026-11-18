// Réglages partagés des fonctions YouCan Pay.
// Le prix est fixé ici, côté serveur : le navigateur ne peut pas le modifier.

export const OFFER = {
  label: 'Accompagnement trauma',
  amount: 490000, // centimes → 4 900,00 MAD
  currency: 'MAD',
};

export const ycpBase = () =>
  process.env.YCP_SANDBOX === 'true' ? 'https://youcanpay.com/sandbox' : 'https://youcanpay.com';

export const siteUrl = (req) => (process.env.URL || new URL(req.url).origin).replace(/\/$/, '');
