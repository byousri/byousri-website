// Crée un paiement YouCan Pay pour l'accompagnement et redirige le patient
// vers la page de paiement sécurisée de YouCan Pay.
//
// Variables d'environnement (Netlify → Site configuration → Environment variables) :
//   YCP_PRIVATE_KEY  clé privée YouCan Pay (obligatoire, ne jamais la mettre dans le code)
//   YCP_PUBLIC_KEY   clé publique YouCan Pay (facultative)
//   YCP_SANDBOX      "true" pour tester avec les clés et cartes de test

import { randomUUID } from 'node:crypto';
import { OFFER, ycpBase, siteUrl } from '../lib/ycp.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Méthode non autorisée', { status: 405, headers: { Allow: 'POST' } });
  }

  const site = siteUrl(req);
  const fail = () => Response.redirect(`${site}/accompagnement/?paiement=erreur#paiement`, 303);

  const privateKey = process.env.YCP_PRIVATE_KEY;
  if (!privateKey) {
    console.error('YCP_PRIVATE_KEY manquante');
    return fail();
  }

  const body = new URLSearchParams({
    pri_key: privateKey,
    order_id: `acc-${randomUUID()}`,
    amount: String(OFFER.amount), // en centimes : 490000 = 4 900,00 MAD
    currency: OFFER.currency,
    customer_ip: context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0',
    success_url: `${site}/accompagnement/merci/`,
    error_url: `${site}/accompagnement/?paiement=echec#paiement`,
    'metadata[offre]': OFFER.label,
  });
  if (process.env.YCP_PUBLIC_KEY) body.set('pub_key', process.env.YCP_PUBLIC_KEY);

  try {
    const res = await fetch(`${ycpBase()}/api/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    const tokenId = data?.token?.id;
    if (!res.ok || !tokenId) {
      console.error('Tokenize YouCan Pay refusé', res.status, JSON.stringify(data));
      return fail();
    }
    return Response.redirect(`${ycpBase()}/payment-form/${tokenId}?lang=fr`, 303);
  } catch (err) {
    console.error('Erreur réseau YouCan Pay', err);
    return fail();
  }
};

export const config = { path: '/api/paiement-accompagnement' };
