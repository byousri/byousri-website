// Réglages partagés des fonctions YouCan Pay.
// Les prix sont fixés ici, côté serveur : le navigateur ne peut pas les modifier.
// Montants en centimes : 30000 = 300,00 MAD.

export const CURRENCY = 'MAD';

export const OFFERS = {
  appel: { label: 'Prise de contact 30 min', amount: 30000 },
  seance: { label: 'Séance individuelle 1 h', amount: 60000 },
  accompagnement: { label: 'Accompagnement 4 séances + Formation Healing', amount: 340000 },
};

// L'identifiant de commande commence par la formule : "seance-<uuid>".
export const productFromOrderId = (orderId) => {
  const key = String(orderId || '').split('-')[0];
  return Object.hasOwn(OFFERS, key) ? key : null;
};

export const ycpBase = () =>
  process.env.YCP_SANDBOX === 'true' ? 'https://youcanpay.com/sandbox' : 'https://youcanpay.com';

export const siteUrl = (req) => (process.env.URL || new URL(req.url).origin).replace(/\/$/, '');
