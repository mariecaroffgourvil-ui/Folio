/**
 * Folio — relais de récupération des infos produit (Cloudflare Worker).
 *
 * Appel : GET https://<ton-worker>.workers.dev/?url=https://site.com/produit
 * Réponse : { ok: true, data: { url, title, image, site, brand, price, currency } }
 *           { ok: false, error: "..." }
 *
 * Variable optionnelle (Settings > Variables) :
 *   ALLOWED_ORIGIN = https://<ton-pseudo>.github.io   (sinon '*')
 */

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ ok: false, error: 'method-not-allowed' }, 405, cors);

    const target = new URL(request.url).searchParams.get('url');
    const problem = validateTarget(target);
    if (problem) return json({ ok: false, error: problem }, 400, cors);

    try {
      const page = await fetchPage(target);
      const data = extractProduct(page, target);
      return json({ ok: true, data }, 200, cors);
    } catch (err) {
      return json({ ok: false, error: err.message || 'fetch-failed' }, 502, cors);
    }
  },
};

/* ---------- Sécurité : on ne lit que des pages web publiques ---------- */

function validateTarget(raw) {
  if (!raw) return 'missing-url';
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'invalid-url';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid-protocol';

  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return 'forbidden-host';
  if (h.includes(':')) return 'forbidden-host'; // adresses IPv6 littérales
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && isPrivateIPv4(h)) return 'forbidden-host';
  return null;
}

function isPrivateIPv4(h) {
  const [a, b] = h.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/* ---------- Téléchargement de la page ---------- */

async function fetchPage(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`http-${res.status}`);

    const type = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(type)) throw new Error('not-html');

    const html = await readLimited(res, MAX_BYTES);
    return { html };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res, max) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= max) {
      await reader.cancel();
      break;
    }
  }
  return out + decoder.decode();
}

/* ---------- Extraction : données structurées d'abord, balises ensuite ---------- */

function extractProduct({ html }, pageUrl) {
  const meta = readMeta(html);
  const ld = readJsonLdProduct(html);
  const title = ld.name || meta['og:title'] || meta['twitter:title'] || readTitleTag(html);
  const image = absolutize(ld.image || meta['og:image'] || meta['twitter:image'], pageUrl);
  const brand = ld.brand || meta['product:brand'] || meta['og:brand'];
  const priceRaw = ld.price ?? meta['product:price:amount'] ?? meta['og:price:amount'] ?? null;
  const currency = ld.currency || meta['product:price:currency'] || meta['og:price:currency'] || null;

  return {
    url: pageUrl,
    title: clean(title),
    image: image || '',
    site: clean(meta['og:site_name']) || new URL(pageUrl).hostname.replace(/^www\./, ''),
    brand: clean(brand),
    price: parsePrice(priceRaw),
    currency: currency ? String(currency).toUpperCase().slice(0, 3) : null,
  };
}

function readMeta(html) {
  const out = {};
  const re = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content != null && !(key in out)) out[key] = decodeEntities(content);
  }
  return out;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return m ? m[2] : null;
}

function readTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1] : '';
}

function readJsonLdProduct(html) {
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const node of flatten(data)) {
      if (!isType(node, 'Product')) continue;
      const offer = pickOffer(node.offers);
      return {
        name: typeof node.name === 'string' ? node.name : null,
        image: firstImage(node.image),
        brand: brandName(node.brand),
        price: offer ? offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price ?? null : null,
        currency: offer ? offer.priceCurrency || offer.priceSpecification?.priceCurrency || null : null,
      };
    }
  }
  return {};
}

function flatten(data, acc = []) {
  if (Array.isArray(data)) {
    data.forEach((d) => flatten(d, acc));
  } else if (data && typeof data === 'object') {
    acc.push(data);
    if (data['@graph']) flatten(data['@graph'], acc);
  }
  return acc;
}

function isType(node, type) {
  const t = node['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

function pickOffer(offers) {
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  return list.find((o) => o && (o.price != null || o.lowPrice != null)) || list[0] || null;
}

function firstImage(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === 'object') return img.url || img.contentUrl || null;
  return null;
}

function brandName(b) {
  if (!b) return null;
  if (typeof b === 'string') return b;
  if (typeof b === 'object' && typeof b.name === 'string') return b.name;
  return null;
}

/* "1 299,00" -> 1299 ; "1,299.00" -> 1299 ; "49.9" -> 49.9 */
function parsePrice(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function absolutize(src, base) {
  if (!src || typeof src !== 'string') return null;
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return named[e.toLowerCase()] ?? whole;
  });
}

function clean(s) {
  if (s == null) return '';
  return decodeEntities(String(s)).replace(/\s+/g, ' ').trim();
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=600' },
  });
}
