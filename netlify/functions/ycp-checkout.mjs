// Crée un paiement YouCan Pay pour la formule choisie (prise de contact,
// séance ou accompagnement) et redirige vers la page de paiement sécurisée.
//
// Variables d'environnement (Netlify → Site configuration → Environment variables) :
//   YCP_PRIVATE_KEY  clé privée YouCan Pay (obligatoire, ne jamais la mettre dans le code)
//   YCP_PUBLIC_KEY   clé publique YouCan Pay (facultative)
//   YCP_SANDBOX      "true" pour tester avec les clés et cartes de test

import { randomUUID } from 'node:crypto';
import { OFFERS, CURRENCY, ycpBase, siteUrl } from '../lib/ycp.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Méthode non autorisée', { status: 405, headers: { Allow: 'POST' } });
  }

  const site = siteUrl(req);
  let lang = 'fr';
  let product = null;
  try {
    const form = await req.formData();
    if (['fr', 'ar', 'en'].includes(form.get('lang'))) lang = form.get('lang');
    if (Object.hasOwn(OFFERS, form.get('product'))) product = form.get('product');
  } catch {}
  const fail = () => Response.redirect(`${site}/accompagnement/?lang=${lang}&paiement=erreur#parcours`, 303);

  if (!product) return fail();

  const privateKey = process.env.YCP_PRIVATE_KEY;
  if (!privateKey) {
    console.error('YCP_PRIVATE_KEY manquante');
    return fail();
  }

  const offer = OFFERS[product];
  const body = new URLSearchParams({
    pri_key: privateKey,
    order_id: `${product}-${randomUUID()}`,
    amount: String(offer.amount),
    currency: CURRENCY,
    customer_ip: context.ip || req.headers.get('x-nf-client-connection-ip') || '0.0.0.0',
    // Langue et formule dans le chemin (pas en paramètre) : YouCan Pay ajoute
    // ses propres paramètres (transaction_id…) à ces adresses.
    success_url: `${site}/accompagnement/merci/${lang}/${product}/`,
    error_url: `${site}/accompagnement/echec/${lang}/`,
    'metadata[formule]': offer.label,
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

// /api/paiement-accompagnement reste accepté pour les pages déjà ouvertes.
export const config = { path: ['/api/paiement', '/api/paiement-accompagnement'] };
