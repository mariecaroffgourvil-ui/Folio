/* Folio — logique de l'application. Tout est stocké dans le navigateur (localStorage). */
(() => {
  'use strict';

  const DATA_KEY = 'folio.v1';
  const SETTINGS_KEY = 'folio.settings';
  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');

  /* ---------- Utilitaires ---------- */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u).trim() : '');
  const clip = (s, n) => String(s ?? '').trim().slice(0, n);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const brandKey = (p) => (p.brand || '').trim();
  const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

  function formatPrice(p) {
    if (p.price == null) return '<span class="muted small">Prix non renseigné</span>';
    try {
      return esc(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: p.currency || 'EUR' }).format(p.price));
    } catch {
      return esc(`${p.price} ${p.currency || ''}`.trim());
    }
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ---------- Stockage ---------- */
  const storage = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        toast("Impossible d'enregistrer : le stockage du navigateur est indisponible.");
        return false;
      }
    },
  };

  function sanitize(data) {
    const boards = Array.isArray(data?.boards) ? data.boards : [];
    return {
      boards: boards
        .filter((b) => b && typeof b.name === 'string')
        .map((b) => ({
          id: typeof b.id === 'string' ? b.id : uid(),
          name: b.name.slice(0, 60),
          products: (Array.isArray(b.products) ? b.products : [])
            .filter((p) => p && typeof p.url === 'string')
            .map((p) => ({
              id: typeof p.id === 'string' ? p.id : uid(),
              url: p.url,
              title: String(p.title || ''),
              image: safeUrl(p.image),
              site: String(p.site || ''),
              brand: String(p.brand || ''),
              price: typeof p.price === 'number' && isFinite(p.price) ? p.price : null,
              currency: p.currency ? String(p.currency) : 'EUR',
              addedAt: Number(p.addedAt) || Date.now(),
            })),
        })),
    };
  }

  let state = sanitize(storage.read(DATA_KEY, { boards: [] }));
  const save = () => storage.write(DATA_KEY, state);
  const settings = () => storage.read(SETTINGS_KEY, {});

  /* ---------- Routage ---------- */
  let filters = null;
  const newFilters = (boardId) => ({ boardId, min: '', max: '', brands: new Set(), sort: 'recent' });

  function route() {
    const m = location.hash.match(/^#\/board\/([\w-]+)$/);
    if (m && state.boards.some((b) => b.id === m[1])) renderBoard(m[1]);
    else renderHome();
  }
  window.addEventListener('hashchange', route);

  /* ---------- Accueil : liste des tableaux ---------- */
  function renderHome() {
    document.title = 'Folio — Keep what you love.';
    app.innerHTML = `
      <section class="home">
        <h1 class="page-title">Mes <em>tableaux</em></h1>
        <form id="form-board" class="board-create">
          <input id="board-name" placeholder="Nouveau tableau, ex. Déco" maxlength="60" required autocomplete="off">
          <button class="btn" type="submit">Créer</button>
        </form>
        <div class="board-grid">
          ${state.boards.length
            ? state.boards.map((b) => `
              <a class="board-card" href="#/board/${esc(b.id)}">
                <span class="board-name"><em>${esc(b.name)}</em></span>
                <span class="board-count">${plural(b.products.length, 'produit')}</span>
              </a>`).join('')
            : `<p class="empty">Aucun tableau pour l'instant. Crée le premier ci-dessus.</p>`}
        </div>
      </section>`;

    $('#form-board').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = clip($('#board-name').value, 60);
      if (!name) return;
      const board = { id: uid(), name, products: [], createdAt: Date.now() };
      state.boards.unshift(board);
      if (save()) location.hash = `#/board/${board.id}`;
    });
  }

  /* ---------- Tableau ---------- */
  function renderBoard(id) {
    const board = state.boards.find((b) => b.id === id);
    if (!filters || filters.boardId !== id) filters = newFilters(id);
    document.title = `${board.name} — Folio`;

    app.innerHTML = `
      <section class="board">
        <a class="back" href="#/">← Tous les tableaux</a>
        <div class="board-head">
          <h1 class="page-title"><em>${esc(board.name)}</em></h1>
          <div class="row">
            <button class="btn ghost" id="btn-rename" type="button">Renommer</button>
            <button class="btn ghost" id="btn-delete-board" type="button">Supprimer</button>
            <button class="btn" id="btn-add" type="button">+ Ajouter un produit</button>
          </div>
        </div>
        <div class="layout">
          <aside class="filters" id="filters"></aside>
          <div>
            <p class="count" id="count"></p>
            <div class="grid" id="grid"></div>
          </div>
        </div>
      </section>`;

    const aside = $('#filters');
    renderFilters(board);

    // Écouteurs posés une seule fois par rendu du tableau (pas à chaque reconstruction du panneau)
    const onFilterChange = () => {
      filters.min = $('#f-min').value;
      filters.max = $('#f-max').value;
      filters.sort = $('#f-sort').value;
      filters.brands = new Set([...aside.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value));
      renderGrid(board);
    };
    aside.addEventListener('input', onFilterChange);
    aside.addEventListener('change', onFilterChange);
    aside.addEventListener('click', (e) => {
      if (e.target.id === 'f-reset') {
        filters = newFilters(board.id);
        renderFilters(board);
        renderGrid(board);
      }
    });

    renderGrid(board);

    $('#btn-add').onclick = () => openProductDialog(board.id, null);

    $('#btn-rename').onclick = () => {
      const name = clip(prompt('Nouveau nom du tableau', board.name), 60);
      if (!name) return;
      board.name = name;
      save();
      renderBoard(board.id);
      toast('Tableau renommé');
    };

    $('#btn-delete-board').onclick = () => {
      if (!confirm(`Supprimer « ${board.name} » et tous ses produits ?`)) return;
      state.boards = state.boards.filter((b) => b.id !== board.id);
      save();
      location.hash = '#/';
      toast('Tableau supprimé');
    };

    $('#grid').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const card = btn.closest('.card');
      const product = board.products.find((p) => p.id === card.dataset.id);
      if (!product) return;

      if (btn.dataset.act === 'edit') {
        openProductDialog(board.id, product);
      } else if (btn.dataset.act === 'delete') {
        if (!confirm(`Retirer « ${product.title || product.url} » de ce tableau ?`)) return;
        board.products = board.products.filter((p) => p.id !== product.id);
        save();
        renderBoard(board.id);
        toast('Produit retiré');
      }
    });
  }

  function renderFilters(board) {
    const keys = [...new Set(board.products.map(brandKey))].sort((a, b) => a.localeCompare(b, 'fr'));
    const aside = $('#filters');
    aside.innerHTML = `
      <div class="filters-head">
        <h2>Filtres</h2>
        <button class="link" id="f-reset" type="button">Réinitialiser</button>
      </div>
      <fieldset>
        <legend>Prix</legend>
        <div class="range">
          <label>Min<input id="f-min" type="number" min="0" step="1" inputmode="decimal" value="${esc(filters.min)}"></label>
          <label>Max<input id="f-max" type="number" min="0" step="1" inputmode="decimal" value="${esc(filters.max)}"></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Marque</legend>
        ${keys.length
          ? `<div class="brands">${keys.map((k) => `
              <label class="check">
                <input type="checkbox" value="${esc(k)}" ${filters.brands.has(k) ? 'checked' : ''}>
                <span>${esc(k || 'Sans marque')}</span>
              </label>`).join('')}</div>`
          : '<p class="muted small">Les marques apparaîtront ici.</p>'}
      </fieldset>
      <label class="field">Trier par
        <select id="f-sort">
          <option value="recent">Plus récents</option>
          <option value="price-asc">Prix croissant</option>
          <option value="price-desc">Prix décroissant</option>
        </select>
      </label>`;
    $('#f-sort').value = filters.sort;
  }

  function visibleProducts(board) {
    const f = filters;
    const min = f.min === '' ? null : Number(f.min);
    const max = f.max === '' ? null : Number(f.max);
    const priceFilterOn = min !== null || max !== null;

    const list = board.products.filter((p) => {
      if (priceFilterOn) {
        if (p.price == null) return false; // sans prix : exclu quand un filtre de prix est actif
        if (min !== null && p.price < min) return false;
        if (max !== null && p.price > max) return false;
      }
      if (f.brands.size && !f.brands.has(brandKey(p))) return false;
      return true;
    });

    // Les produits sans prix sont toujours placés en fin de liste
    const byPrice = (dir) => (a, b) => {
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return dir * (a.price - b.price);
    };
    if (f.sort === 'price-asc') list.sort(byPrice(1));
    else if (f.sort === 'price-desc') list.sort(byPrice(-1));
    else list.sort((a, b) => b.addedAt - a.addedAt);

    return list;
  }

  function renderGrid(board) {
    const list = visibleProducts(board);
    const total = board.products.length;
    $('#count').textContent = list.length === total
      ? plural(total, 'produit')
      : `${list.length} sur ${plural(total, 'produit')}`;

    const grid = $('#grid');
    if (!total) grid.innerHTML = `<p class="empty">Ce tableau est vide. Ajoute le lien d'un premier produit.</p>`;
    else if (!list.length) grid.innerHTML = `<p class="empty">Aucun produit ne correspond à ces filtres.</p>`;
    else grid.innerHTML = list.map(productCard).join('');
  }

  function productCard(p) {
    const img = safeUrl(p.image);
    const link = safeUrl(p.url);
    return `
      <article class="card" data-id="${esc(p.id)}">
        <div class="card-media">
          ${img
            ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : '<span class="no-img">Pas de photo</span>'}
        </div>
        <div class="card-body">
          <p class="card-site">${esc(p.site || hostOf(p.url))}</p>
          <h3 class="card-title">${esc(p.title || 'Sans titre')}</h3>
          ${p.brand ? `<p class="card-brand">${esc(p.brand)}</p>` : ''}
          <p class="card-price">${formatPrice(p)}</p>
        </div>
        <div class="card-actions">
          ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Voir</a>` : ''}
          <button type="button" data-act="edit">Modifier</button>
          <button type="button" data-act="delete">Supprimer</button>
        </div>
      </article>`;
  }

  /* ---------- Dialogue produit (ajout / modification) ---------- */
  const dlgProduct = $('#dlg-product');
  let ctx = null; // { boardId, product | null }

  const REASONS = {
    'no-worker': "Relais non configuré : renseigne-le dans Réglages pour récupérer les infos automatiquement. Tu peux remplir à la main.",
    timeout: 'Le site met trop de temps à répondre. Complète à la main.',
    network: "Impossible de joindre le relais. Vérifie son adresse dans Réglages.",
    'missing-url': 'Lien manquant.',
    'invalid-url': 'Ce lien n’est pas valide.',
    'invalid-protocol': 'Seuls les liens http(s) sont acceptés.',
    'forbidden-host': 'Ce lien ne peut pas être lu par le relais.',
    'not-html': 'Ce lien ne pointe pas vers une page web.',
  };
  const explainError = (reason) => {
    if (REASONS[reason]) return REASONS[reason];
    if (/^http-(401|403|429)$/.test(reason)) return 'Le site bloque la lecture automatique. Complète à la main.';
    return 'Infos introuvables sur cette page. Complète à la main.';
  };

  function setStatus(msg, kind = 'info') {
    const el = $('#p-status');
    el.textContent = msg;
    el.className = `status ${kind}`;
  }

  function ensureOption(select, value) {
    if (![...select.options].some((o) => o.value === value)) {
      const opt = new Option(value, value);
      select.add(opt);
    }
  }

  function updatePreview() {
    const src = safeUrl($('#p-image').value);
    $('#p-preview').innerHTML = src
      ? `<img src="${esc(src)}" alt="Aperçu du produit" referrerpolicy="no-referrer">`
      : '<span class="no-img">Aperçu de la photo</span>';
  }

  function openProductDialog(boardId, product) {
    ctx = { boardId, product };
    $('#dlg-product-title').textContent = product ? 'Modifier le produit' : 'Ajouter un produit';
    $('#p-url').value = product?.url || '';
    $('#p-title').value = product?.title || '';
    $('#p-brand').value = product?.brand || '';
    $('#p-site').value = product?.site || '';
    $('#p-price').value = product?.price ?? '';
    ensureOption($('#p-currency'), product?.currency || 'EUR');
    $('#p-currency').value = product?.currency || 'EUR';
    $('#p-image').value = product?.image || '';
    setStatus(product ? '' : 'Colle le lien : les infos se remplissent automatiquement si le relais est configuré.');
    updatePreview();
    dlgProduct.showModal();
    $('#p-url').focus();
  }

  async function fetchInfo() {
    const url = $('#p-url').value.trim();
    if (!FolioScraper.isValidUrl(url)) return setStatus('Colle un lien complet commençant par https://', 'error');

    const workerUrl = settings().workerUrl;
    if (!workerUrl) return setStatus(REASONS['no-worker'], 'info');

    const btn = $('#p-fetch');
    btn.disabled = true;
    setStatus('Récupération en cours…', 'info');
    const res = await FolioScraper.fetchProduct(url, workerUrl);
    btn.disabled = false;

    if (!res.ok) return setStatus(explainError(res.reason), 'error');

    const d = res.data || {};
    if (d.title) $('#p-title').value = clip(d.title, 200);
    if (d.brand) $('#p-brand').value = clip(d.brand, 80);
    if (d.site) $('#p-site').value = clip(d.site, 80);
    if (d.price != null) $('#p-price').value = d.price;
    if (d.currency) { ensureOption($('#p-currency'), d.currency); $('#p-currency').value = d.currency; }
    if (d.image) $('#p-image').value = safeUrl(d.image);
    updatePreview();

    const found = ['title', 'brand', 'price', 'image'].some((k) => d[k] != null && d[k] !== '');
    setStatus(
      found ? 'Infos récupérées. Vérifie avant d’enregistrer.' : 'Aucune info exploitable sur cette page. Complète à la main.',
      found ? 'ok' : 'info'
    );
  }

  $('#p-fetch').addEventListener('click', fetchInfo);
  $('#p-image').addEventListener('input', updatePreview);
  $('#p-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fetchInfo(); }
  });
  $('#p-url').addEventListener('paste', () => setTimeout(() => {
    if (FolioScraper.isValidUrl($('#p-url').value.trim()) && settings().workerUrl) fetchInfo();
  }, 50));

  $('#form-product').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#p-url').value.trim();
    if (!FolioScraper.isValidUrl(url)) return setStatus('Le lien du produit est obligatoire (https://…).', 'error');

    const priceRaw = $('#p-price').value.trim();
    const price = priceRaw === '' ? null : Number(priceRaw.replace(',', '.'));

    const data = {
      url,
      title: clip($('#p-title').value, 200),
      brand: clip($('#p-brand').value, 80),
      site: clip($('#p-site').value, 80) || hostOf(url),
      price: price !== null && isFinite(price) ? price : null,
      currency: $('#p-currency').value,
      image: safeUrl($('#p-image').value),
    };

    const board = state.boards.find((b) => b.id === ctx.boardId);
    if (!board) return;

    if (ctx.product) {
      Object.assign(ctx.product, data);
    } else {
      board.products.unshift({ id: uid(), ...data, addedAt: Date.now() });
    }
    if (!save()) return;

    dlgProduct.close();
    renderBoard(board.id);
    toast(ctx.product ? 'Produit mis à jour' : 'Produit ajouté');
  });

  /* ---------- Réglages ---------- */
  const dlgSettings = $('#dlg-settings');
  $('#btn-settings').addEventListener('click', () => {
    $('#set-worker').value = settings().workerUrl || '';
    dlgSettings.showModal();
  });
  $('#form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#set-worker').value.trim().replace(/\/+$/, '');
    if (url && !FolioScraper.isValidUrl(url)) return toast('Adresse invalide');
    storage.write(SETTINGS_KEY, { ...settings(), workerUrl: url });
    dlgSettings.close();
    toast('Réglages enregistrés');
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  /* ---------- Export / import ---------- */
  $('#btn-export').addEventListener('click', () => {
    const payload = { app: 'folio', version: 1, exportedAt: new Date().toISOString(), boards: state.boards };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `folio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.boards)) throw new Error('format');
      if (!confirm('Remplacer tous tes tableaux actuels par ceux du fichier ?')) return;
      state = sanitize(data);
      save();
      filters = null;
      route();
      toast('Import réussi');
    } catch {
      toast('Fichier invalide.');
    }
  });

  /* ---------- Démarrage ---------- */
  route();
})();
