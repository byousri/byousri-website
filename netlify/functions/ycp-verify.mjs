// Vérifie auprès de YouCan Pay qu'une transaction est bien payée,
// pour la page de remerciement. Ne renvoie que le strict nécessaire.
//
// Deux API possibles chez YouCan Pay :
//  - /api/transactions/{id}?pri_key=…   (ancienne API, seule acceptée en sandbox)
//  - /api/v2/transactions/{id}          (API v2, clés live uniquement, auth Basic)
// On essaie la première, puis la v2 en production si besoin.

import { OFFERS, CURRENCY, productFromOrderId, ycpBase } from '../lib/ycp.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

async function fetchTransaction(id, privateKey) {
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
function amountInCentimes(t) {
  if (t.amount && typeof t.amount === 'object') return Math.round(Number(t.amount.amount) * 100);
  return Number(t.amount);
}

function currencyOf(t) {
  return String((t.amount && t.amount.currency) || t.currency || CURRENCY).toUpperCase();
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get('transaction_id') || '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json({ paid: false, reason: 'invalid' }, 400);

  const privateKey = process.env.YCP_PRIVATE_KEY;
  if (!privateKey) return json({ paid: false, reason: 'config' }, 500);

  try {
    const t = await fetchTransaction(id, privateKey);
    if (!t) return json({ paid: false, reason: 'not_found' }, 404);

    // Payée : statut 1 (ancienne API) ou "paid" (v2), et montant conforme
    // au prix de la formule indiquée dans l'identifiant de commande.
    const product = productFromOrderId(t.order_id);
    const paid =
      product !== null &&
      (String(t.status) === '1' || String(t.status).toLowerCase() === 'paid') &&
      amountInCentimes(t) === OFFERS[product].amount &&
      currencyOf(t) === CURRENCY;

    return json({ paid, product, order_id: t.order_id || null });
  } catch (err) {
    console.error('Vérification YouCan Pay impossible', err);
    return json({ paid: false, reason: 'network' }, 502);
  }
};

export const config = { path: '/api/verifier-paiement' };
