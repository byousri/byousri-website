// Vérifie auprès de YouCan Pay qu'une transaction est bien payée,
// pour la page de remerciement. Ne renvoie que le strict nécessaire.

import { OFFER, ycpBase } from '../lib/ycp.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export default async (req) => {
  const id = new URL(req.url).searchParams.get('transaction_id') || '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json({ paid: false, reason: 'invalid' }, 400);

  const privateKey = process.env.YCP_PRIVATE_KEY;
  if (!privateKey) return json({ paid: false, reason: 'config' }, 500);

  try {
    const url = new URL(`${ycpBase()}/api/transactions/${encodeURIComponent(id)}`);
    url.searchParams.set('pri_key', privateKey);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return json({ paid: false, reason: 'not_found' }, 404);
    const t = await res.json();

    // Statut 1 = transaction payée chez YouCan Pay.
    const paid =
      (String(t.status) === '1' || String(t.status).toLowerCase() === 'paid') &&
      Number(t.amount) === OFFER.amount &&
      String(t.currency || OFFER.currency).toUpperCase() === OFFER.currency;

    return json({ paid, order_id: t.order_id || null });
  } catch (err) {
    console.error('Vérification YouCan Pay impossible', err);
    return json({ paid: false, reason: 'network' }, 502);
  }
};

export const config = { path: '/api/verifier-paiement' };
