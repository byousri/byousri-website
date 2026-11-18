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
  // Langue choisie sur la page (fr, ar ou en), reprise par YouCan Pay et au retour.
  let lang = 'fr';
  try {
    const form = await req.formData();
    if (['fr', 'ar', 'en'].includes(form.get('lang'))) lang = form.get('lang');
  } catch {}
  const fail = () => Response.redirect(`${site}/accompagnement/?lang=${lang}&paiement=erreur#paiement`, 303);

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
    // Langue dans le chemin (pas en paramètre) : YouCan Pay ajoute ses propres
    // paramètres (transaction_id…) à ces adresses.
    success_url: `${site}/accompagnement/merci/${lang}/`,
    error_url: `${site}/accompagnement/echec/${lang}/`,
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
    return Response.redirect(`${ycpBase()}/payment-form/${tokenId}?lang=${lang}`, 303);
  } catch (err) {
    console.error('Erreur réseau YouCan Pay', err);
    return fail();
  }
};

export const config = { path: '/api/paiement-accompagnement' };
