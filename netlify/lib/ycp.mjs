// Réglages partagés des fonctions YouCan Pay.
// Les prix sont fixés ici, côté serveur : le navigateur ne peut pas les modifier.
// Montants en centimes : 50000 = 500,00 MAD.

export const CURRENCY = 'MAD';

export const OFFERS = {
  appel: { label: 'Prise de contact 1 h', amount: 50000 },
  accompagnement: { label: 'Accompagnement 4 séances + Formation Healing', amount: 340000 },
};

// L'identifiant de commande commence par la formule : "appel-<uuid>".
export const productFromOrderId = (orderId) => {
  const key = String(orderId || '').split('-')[0];
  return Object.hasOwn(OFFERS, key) ? key : null;
};

export const ycpBase = () =>
  process.env.YCP_SANDBOX === 'true' ? 'https://youcanpay.com/sandbox' : 'https://youcanpay.com';

export const siteUrl = (req) => (process.env.URL || new URL(req.url).origin).replace(/\/$/, '');

// Lit une transaction chez YouCan Pay. Deux API possibles :
//  - /api/transactions/{id}?pri_key=…   (ancienne API, seule acceptée en sandbox)
//  - /api/v2/transactions/{id}          (API v2, clés live uniquement, auth Basic)
// On essaie la première, puis la v2 en production si besoin.
export async function fetchTransaction(id, privateKey) {
  const legacy = new URL(`${ycpBase()}/api/transactions/${encodeURIComponent(id)}`);
  legacy.searchParams.set('pri_key', privateKey);
  let res = await fetch(legacy, { headers: { Accept: 'application/json' } });
  if (res.ok) return res.json();

  if (process.env.YCP_SANDBOX !== 'true') {
    res = await fetch(`https://youcanpay.com/api/v2/transactions/${encodeURIComponent(id)}`, {
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${privateKey}:`).toString('base64'),
      },
    });
    if (res.ok) return res.json();
  }
  return null;
}

// Montant en centimes, quel que soit le format renvoyé :
// ancienne API → 490000 (centimes) ; v2 → { amount: "4900.00", currency: "MAD" }.
export function amountInCentimes(t) {
  if (t.amount && typeof t.amount === 'object') return Math.round(Number(t.amount.amount) * 100);
  return Number(t.amount);
}

export function currencyOf(t) {
  return String((t.amount && t.amount.currency) || t.currency || CURRENCY).toUpperCase();
}

// Payée : statut 1 (ancienne API) ou "paid" (v2), et montant conforme
// au prix de la formule indiquée dans l'identifiant de commande.
export function checkPaid(t) {
  const product = productFromOrderId(t.order_id);
  const paid =
    product !== null &&
    (String(t.status) === '1' || String(t.status).toLowerCase() === 'paid') &&
    amountInCentimes(t) === OFFERS[product].amount &&
    currencyOf(t) === CURRENCY;
  return { paid, product };
}

export const isTransactionId = (id) => /^[A-Za-z0-9-]{8,64}$/.test(String(id || ''));
