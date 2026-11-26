// Reçoit les notifications (webhooks) de YouCan Pay et envoie un e-mail
// à chaque paiement confirmé.
//
// Sécurité : on ne fait pas confiance au contenu reçu. On n'en extrait que
// l'identifiant de la transaction, puis on relit cette transaction directement
// chez YouCan Pay avec la clé privée (même contrôle que la page « merci ») :
// statut payé, montant et devise conformes à la formule. Un faux appel ne peut
// donc pas déclencher d'e-mail.
//
// Variables d'environnement (Netlify → Site configuration → Environment variables) :
//   YCP_PRIVATE_KEY  clé privée YouCan Pay (déjà utilisée par le paiement)
//   RESEND_API_KEY   clé API Resend (https://resend.com → API Keys)
//   NOTIFY_EMAIL     adresse qui reçoit les alertes (plusieurs : séparées par des virgules)
//   NOTIFY_FROM      expéditeur, ex. "Paiements <paiements@mon-domaine.com>" (domaine
//                    vérifié chez Resend). Facultatif : par défaut onboarding@resend.dev,
//                    qui ne peut écrire qu'à l'adresse du compte Resend.
//
// Adresse à déclarer dans le tableau de bord YouCan Pay (Webhooks) :
//   https://<domaine>/api/ycp-webhook

import {
  OFFERS,
  CURRENCY,
  fetchTransaction,
  checkPaid,
  amountInCentimes,
  isTransactionId,
} from '../lib/ycp.mjs';

const ok = (msg) => new Response(msg, { status: 200 });

// Lit le corps, en JSON ou en formulaire.
async function readBody(req) {
  const raw = await req.text();
  try {
    return JSON.parse(raw);
  } catch {}
  try {
    return Object.fromEntries(new URLSearchParams(raw));
  } catch {}
  return {};
}

// Cherche les identifiants de transaction possibles, quelle que soit la forme
// exacte de la notification : transaction_id, ou id d'un objet "transaction".
function candidateIds(body) {
  const ids = new Set();
  const walk = (node, parentKey, depth) => {
    if (!node || typeof node !== 'object' || depth > 5) return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' || typeof value === 'number') {
        const isTxId = key === 'transaction_id' || (key === 'id' && parentKey === 'transaction');
        if (isTxId && isTransactionId(value)) ids.add(String(value));
      } else {
        walk(value, key, depth + 1);
      }
    }
  };
  walk(body, '', 0);
  return [...ids].slice(0, 3);
}

// Première valeur texte trouvée pour une de ces clés (infos client, à titre indicatif).
function findValue(node, keys, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return '';
  for (const [key, value] of Object.entries(node)) {
    if (keys.includes(key) && typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const value of Object.values(node)) {
    const found = findValue(value, keys, depth + 1);
    if (found) return found;
  }
  return '';
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatMad = (centimes) =>
  (centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ' + CURRENCY;

async function sendEmail({ subject, rows }) {
  const html =
    `<h2 style="font-family:sans-serif">${escapeHtml(subject)}</h2>` +
    '<table style="font-family:sans-serif;border-collapse:collapse">' +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td>` +
          `<td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`,
      )
      .join('') +
    '</table>';
  const text = subject + '\n\n' + rows.map(([k, v]) => `${k} : ${v}`).join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || 'Paiements <onboarding@resend.dev>',
      to: process.env.NOTIFY_EMAIL.split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} ${await res.text().catch(() => '')}`);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Méthode non autorisée', { status: 405, headers: { Allow: 'POST' } });
  }

  const privateKey = process.env.YCP_PRIVATE_KEY;
  if (!privateKey || !process.env.RESEND_API_KEY || !process.env.NOTIFY_EMAIL) {
    console.error('Webhook YouCan Pay : YCP_PRIVATE_KEY, RESEND_API_KEY ou NOTIFY_EMAIL manquante');
    // 500 : YouCan Pay réessaiera, le temps de corriger la configuration.
    return new Response('Configuration incomplète', { status: 500 });
  }

  const body = await readBody(req);
  const ids = candidateIds(body);
  if (!ids.length) {
    console.warn('Webhook YouCan Pay sans identifiant de transaction', JSON.stringify(body).slice(0, 500));
    return ok('ignoré');
  }

  let transaction = null;
  let txId = null;
  try {
    for (const id of ids) {
      const t = await fetchTransaction(id, privateKey);
      if (t) {
        transaction = t;
        txId = id;
        break;
      }
    }
  } catch (err) {
    console.error('Webhook YouCan Pay : lecture de la transaction impossible', err);
    return new Response('Erreur réseau', { status: 502 }); // YouCan Pay réessaiera
  }

  if (!transaction) {
    console.warn('Webhook YouCan Pay : transaction introuvable', ids);
    return ok('ignoré');
  }

  const { paid, product } = checkPaid(transaction);
  if (!paid) {
    console.log('Webhook YouCan Pay : transaction non payée ou non conforme', txId, transaction.status);
    return ok('non payé');
  }

  const name = findValue(body, ['name', 'full_name', 'customer_name']) || findValue(transaction, ['name', 'full_name']);
  const email = findValue(body, ['email', 'customer_email']) || findValue(transaction, ['email']);
  const phone = findValue(body, ['phone', 'customer_phone']) || findValue(transaction, ['phone']);
  const amount = formatMad(amountInCentimes(transaction));
  const sandbox = process.env.YCP_SANDBOX === 'true';

  const rows = [
    ['Formule', OFFERS[product].label],
    ['Montant', amount],
    ['Client', name || '—'],
    ['E-mail', email || '—'],
    ['Téléphone', phone || '—'],
    ['Commande', transaction.order_id],
    ['Transaction', txId],
    ['Reçu le', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })],
  ];
  if (sandbox) rows.push(['Mode', 'TEST (sandbox)']);

  try {
    await sendEmail({
      subject: `${sandbox ? '[TEST] ' : ''}💰 Nouveau paiement : ${OFFERS[product].label} — ${amount}`,
      rows,
    });
  } catch (err) {
    console.error("Webhook YouCan Pay : envoi de l'e-mail impossible", err);
    return new Response('Envoi impossible', { status: 500 }); // YouCan Pay réessaiera
  }

  return ok('notifié');
};

export const config = { path: '/api/ycp-webhook' };
