// Vérifie auprès de YouCan Pay qu'une transaction est bien payée,
// pour la page de remerciement. Ne renvoie que le strict nécessaire.

import { fetchTransaction, checkPaid, isTransactionId } from '../lib/ycp.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export default async (req) => {
  const id = new URL(req.url).searchParams.get('transaction_id') || '';
  if (!isTransactionId(id)) return json({ paid: false, reason: 'invalid' }, 400);

  const privateKey = process.env.YCP_PRIVATE_KEY;
  if (!privateKey) return json({ paid: false, reason: 'config' }, 500);

  try {
    const t = await fetchTransaction(id, privateKey);
    if (!t) return json({ paid: false, reason: 'not_found' }, 404);
    const { paid, product } = checkPaid(t);
    return json({ paid, product, order_id: t.order_id || null });
  } catch (err) {
    console.error('Vérification YouCan Pay impossible', err);
    return json({ paid: false, reason: 'network' }, 502);
  }
};

export const config = { path: '/api/verifier-paiement' };
