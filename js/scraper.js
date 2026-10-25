/* Folio — appel au relais Cloudflare pour récupérer les infos d'un produit.
   Si le relais n'est pas configuré ou ne répond pas, l'app bascule sur la saisie manuelle. */
window.FolioScraper = (() => {
  'use strict';

  const TIMEOUT_MS = 15000;

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function fetchProduct(url, workerUrl) {
    if (!workerUrl) return { ok: false, reason: 'no-worker' };

    const endpoint = `${workerUrl.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      let json = null;
      try { json = await res.json(); } catch { /* réponse non JSON */ }

      if (!res.ok || !json || !json.ok) {
        return { ok: false, reason: json?.error || `http-${res.status}` };
      }
      return { ok: true, data: json.data };
    } catch (err) {
      return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return { isValidUrl, fetchProduct };
})();
