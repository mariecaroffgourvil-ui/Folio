/* Folio — pages et logique de l'interface. Les données sont dans Supabase (voir api.js). */
import {
  sb, auth, loadAll, getBoard, createBoard, renameBoard, deleteBoard, deleteProduct, saveProduct,
} from './api.js';

/* ---------- Utilitaires ---------- */
const $ = (s) => document.querySelector(s);
const app = $('#app');
const SETTINGS_KEY = 'folio.settings';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u).trim() : '');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const errMsg = (e) => e?.message || 'Une erreur est survenue.';
const loading = () => '<p class="loading">Chargement…</p>';
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const brandKey = (p) => (p.brand || '').trim();
const tagIdsOf = (p) => (p.product_tags || []).map((pt) => pt.tag_id);
const matches = (p, needle) => [p.title, p.brand, p.site, p.url]
  .some((v) => String(v || '').toLowerCase().includes(needle));

const settings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { toast('Impossible d’enregistrer les réglages.'); } };

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function formatPrice(p) {
  if (p.price == null) return '<span class="muted small">Prix non renseigné</span>';
  try {
    return esc(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: p.currency || 'EUR' }).format(p.price));
  } catch {
    return esc(`${p.price} ${p.currency || ''}`.trim());
  }
}

function firstName(user) {
  const m = user?.user_metadata || {};
  return m.prenom || (m.full_name || m.name || '').split(' ')[0] || '';
}

const newFilters = (boardId) => ({
  boardId, q: '', min: '', max: '', brands: new Set(), tags: new Set(), sort: 'recent', open: false,
});

/* ---------- État ---------- */
let session = null;
let homeBoards = [];
let current = null;                    // tableau affiché
let filters = newFilters(null);

const setLoggedIn = () => { document.body.classList.remove('is-login'); $('#btn-menu').hidden = false; };
const setLoggedOut = () => { document.body.classList.add('is-login'); $('#btn-menu').hidden = true; };
const fail = (e) => { toast(errMsg(e)); app.innerHTML = '<p class="empty">Impossible de charger cette page. Réessaie dans un instant.</p>'; };

/* ---------- Cartes ---------- */
function boardCard(b) {
  const covers = [...b.products].slice(0, 4).map((p) => safeUrl(p.image)).filter(Boolean);
  const cells = [0, 1, 2, 3].map((i) => (covers[i]
    ? `<img src="${esc(covers[i])}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<span></span>')).join('');
  return `
    <a class="board-card" href="#/board/${esc(b.id)}">
      <div class="cover${covers.length ? '' : ' cover-empty'}">${cells}</div>
      <h2 class="board-name"><em>${esc(b.name)}</em></h2>
      <span class="board-count">${plural(b.products.length, 'épingle')}</span>
    </a>`;
}

function pinCard(p, boardId, boardName = '', withDelete = false) {
  const img = safeUrl(p.image);
  const link = safeUrl(p.url);
  return `
    <article class="card" data-id="${esc(p.id)}">
      <a class="card-link" href="#/board/${esc(boardId)}/pin/${esc(p.id)}">
        <div class="card-media">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="no-img">Pas de photo</span>'}
        </div>
        <div class="card-body">
          <p class="card-site">${esc(p.site || hostOf(p.url))}</p>
          <h3 class="card-title">${esc(p.title || 'Sans titre')}</h3>
          ${p.brand ? `<p class="card-brand">${esc(p.brand)}</p>` : ''}
          ${boardName ? `<p class="card-brand">Dans ${esc(boardName)}</p>` : ''}
          <p class="card-price">${formatPrice(p)}</p>
        </div>
      </a>
      <div class="card-actions">
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Voir</a>` : ''}
        ${withDelete ? '<button type="button" data-del>Supprimer</button>' : ''}
      </div>
    </article>`;
}

/* ---------- Connexion ---------- */
function renderLogin() {
  setLoggedOut();
  document.title = 'Folio — Keep what you love.';
  app.innerHTML = `
    <section class="login">
      <div class="login-brand">
        <img src="assets/folio.svg" alt="Folio" class="logo logo-light">
        <span class="login-sep" aria-hidden="true"></span>
        <p class="login-tag">Keep what<br>you love.</p>
      </div>
      <button class="btn light" id="btn-login" type="button">Connexion avec Google</button>
    </section>`;
  $('#btn-login').onclick = async () => {
    const { error } = await auth.signIn();
    if (error) toast(errMsg(error));
  };
}

/* ---------- Accueil ---------- */
async function renderHome() {
  setLoggedIn();
  document.title = 'Folio';
  app.innerHTML = `
    <section class="home">
      <h1 class="page-title"><em>Bienvenue</em><span class="name">${esc(firstName(session.user))},</span></h1>
      <div class="toolbar">
        <input id="home-search" class="search" type="search" placeholder="Rechercher une épingle" autocomplete="off">
        <button class="btn" id="btn-new-board" type="button">Créer un tableau</button>
      </div>
      <div id="home-body">${loading()}</div>
    </section>`;

  $('#btn-new-board').onclick = async () => {
    const name = clip(prompt('Nom du tableau (ex. Déco)') || '', 60);
    if (!name) return;
    try {
      const b = await createBoard(name);
      go(`#/board/${b.id}`);
    } catch (e) { toast(errMsg(e)); }
  };
  $('#home-search').oninput = (e) => renderHomeBody(e.target.value);

  try {
    homeBoards = await loadAll();
  } catch (e) {
    return fail(e);
  }
  renderHomeBody($('#home-search').value);
}

function renderHomeBody(q) {
  const body = $('#home-body');
  if (!body) return;
  const needle = q.trim().toLowerCase();

  if (!needle) {
    body.innerHTML = homeBoards.length
      ? `<div class="board-grid">${homeBoards.map(boardCard).join('')}</div>`
      : '<p class="empty">Aucun tableau pour l’instant. Crée le premier.</p>';
    return;
  }

  const hits = homeBoards.flatMap((b) => b.products
    .filter((p) => matches(p, needle))
    .map((p) => ({ p, b })));
  body.innerHTML = hits.length
    ? `<div class="grid">${hits.map(({ p, b }) => pinCard(p, b.id, b.name)).join('')}</div>`
    : `<p class="empty">Aucune épingle ne correspond à « ${esc(q)} ».</p>`;
}

/* ---------- Tableau ---------- */
async function renderBoard(id) {
  setLoggedIn();
  app.innerHTML = loading();
  let board;
  try {
    board = await getBoard(id);
  } catch (e) { return fail(e); }
  if (!board) return go('#/');

  current = board;
  if (filters.boardId !== id) filters = newFilters(id);
  document.title = `${board.name} — Folio`;

  app.innerHTML = `
    <section class="board">
      <a class="back" href="#/">← Retour aux tableaux</a>
      <div class="board-head">
        <h1 class="page-title"><em>${esc(board.name)}</em></h1>
        <div class="row">
          <button class="link" id="btn-rename" type="button">Renommer</button>
          <button class="link danger" id="btn-delete-board" type="button">Supprimer le tableau</button>
        </div>
      </div>
      <div class="toolbar">
        <input id="b-search" class="search" type="search" placeholder="Rechercher une épingle" value="${esc(filters.q)}" autocomplete="off">
        <button class="btn" id="btn-add" type="button">Créer une épingle</button>
        <button class="btn ghost" id="btn-filters" type="button" aria-expanded="${filters.open}">Filtres</button>
      </div>
      <div id="filters-panel" class="filters" ${filters.open ? '' : 'hidden'}></div>
      <p class="count" id="count"></p>
      <div class="grid" id="grid"></div>
    </section>`;

  renderFilterPanel(board);
  renderGrid(board);

  $('#b-search').oninput = (e) => { filters.q = e.target.value; renderGrid(current); };
  $('#btn-filters').onclick = () => {
    filters.open = !filters.open;
    $('#filters-panel').hidden = !filters.open;
    $('#btn-filters').setAttribute('aria-expanded', String(filters.open));
  };
  $('#btn-add').onclick = () => openProductDialog(current, null);

  $('#btn-rename').onclick = async () => {
    const name = clip(prompt('Nouveau nom du tableau', current.name) || '', 60);
    if (!name) return;
    try { await renameBoard(current.id, name); route(); } catch (e) { toast(errMsg(e)); }
  };
  $('#btn-delete-board').onclick = async () => {
    if (!confirm(`Supprimer « ${current.name} » et toutes ses épingles ?`)) return;
    try {
      await deleteBoard(current.id);
      toast('Tableau supprimé');
      go('#/');
    } catch (e) { toast(errMsg(e)); }
  };

  $('#grid').onclick = async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const p = current.products.find((x) => x.id === btn.closest('.card').dataset.id);
    if (!p || !confirm(`Retirer « ${p.title || p.url} » ?`)) return;
    try {
      await deleteProduct(p.id);
      toast('Épingle supprimée');
      route();
    } catch (err) { toast(errMsg(err)); }
  };
}

const toggleIn = (set, v, on) => { if (on) set.add(v); else set.delete(v); };

function tagsUsed(board) {
  const ids = new Set(board.products.flatMap(tagIdsOf));
  return board.tags.filter((t) => ids.has(t.id));
}

function renderFilterPanel(board) {
  const panel = $('#filters-panel');
  const brands = [...new Set(board.products.map(brandKey))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  const tags = tagsUsed(board);

  panel.innerHTML = `
    <div class="filters-head">
      <h2>Filtres</h2>
      <button class="link" id="f-reset" type="button">Réinitialiser</button>
    </div>
    <div class="filters-grid">
      <fieldset>
        <legend>Prix</legend>
        <div class="range">
          <label>Min<input id="f-min" type="number" min="0" step="1" inputmode="decimal" value="${esc(filters.min)}"></label>
          <label>Max<input id="f-max" type="number" min="0" step="1" inputmode="decimal" value="${esc(filters.max)}"></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Marque</legend>
        <div class="toggles">${brands.length ? brands.map((b) => `
          <label class="check">
            <input type="checkbox" data-brand value="${esc(b)}" ${filters.brands.has(b) ? 'checked' : ''}>
            <span>${esc(b || 'Sans marque')}</span>
          </label>`).join('') : '<p class="muted small">Les marques apparaîtront ici.</p>'}
        </div>
      </fieldset>
      <fieldset>
        <legend>Tags</legend>
        <div class="toggles">${tags.length ? tags.map((t) => `
          <label class="tag-toggle">
            <input type="checkbox" data-tag value="${esc(t.id)}" ${filters.tags.has(t.id) ? 'checked' : ''}>
            <span>${esc(t.name)}</span>
          </label>`).join('') : '<p class="muted small">Les tags de tes épingles apparaîtront ici.</p>'}
        </div>
      </fieldset>
      <label class="field">Trier par
        <select id="f-sort">
          <option value="recent">Plus récents</option>
          <option value="price-asc">Prix croissant</option>
          <option value="price-desc">Prix décroissant</option>
        </select>
      </label>
    </div>`;
  $('#f-sort').value = filters.sort;

  panel.oninput = panel.onchange = (e) => {
    const t = e.target;
    if (t.id === 'f-min') filters.min = t.value;
    else if (t.id === 'f-max') filters.max = t.value;
    else if (t.id === 'f-sort') filters.sort = t.value;
    else if (t.dataset.brand !== undefined) toggleIn(filters.brands, t.value, t.checked);
    else if (t.dataset.tag !== undefined) toggleIn(filters.tags, t.value, t.checked);
    else return;
    renderGrid(current);
  };
  panel.onclick = (e) => {
    if (e.target.id !== 'f-reset') return;
    filters = { ...newFilters(current.id), q: filters.q, open: filters.open };
    renderFilterPanel(current);
    renderGrid(current);
  };
}

function visibleProducts(board) {
  const q = filters.q.trim().toLowerCase();
  const min = filters.min === '' ? null : Number(filters.min);
  const max = filters.max === '' ? null : Number(filters.max);
  const priceOn = min !== null || max !== null;

  const list = board.products.filter((p) => {
    if (q && !matches(p, q)) return false;
    if (priceOn) {
      if (p.price == null) return false;
      if (min !== null && p.price < min) return false;
      if (max !== null && p.price > max) return false;
    }
    if (filters.brands.size && !filters.brands.has(brandKey(p))) return false;
    if (filters.tags.size) {
      const ids = new Set(tagIdsOf(p));
      for (const t of filters.tags) if (!ids.has(t)) return false; // ET : toutes les étiquettes doivent être présentes
    }
    return true;
  });

  const byPrice = (dir) => (a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return dir * (a.price - b.price);
  };
  if (filters.sort === 'price-asc') list.sort(byPrice(1));
  else if (filters.sort === 'price-desc') list.sort(byPrice(-1));
  return list;
}

function renderGrid(board) {
  const list = visibleProducts(board);
  const total = board.products.length;
  $('#count').textContent = list.length === total
    ? plural(total, 'épingle')
    : `${list.length} sur ${plural(total, 'épingle')}`;

  let html;
  if (!total) html = '<p class="empty">Ce tableau est vide. Ajoute ta première épingle.</p>';
  else if (!list.length) html = '<p class="empty">Aucune épingle ne correspond à ces filtres.</p>';
  else html = list.map((p) => pinCard(p, board.id, '', true)).join('');
  $('#grid').innerHTML = html;
}

/* ---------- Page épingle ---------- */
async function renderPin(bid, pid) {
  setLoggedIn();
  app.innerHTML = loading();
  let board;
  try {
    board = await getBoard(bid);
  } catch (e) { return fail(e); }

  const p = board?.products.find((x) => x.id === pid);
  if (!p) return go(`#/board/${bid}`);

  current = board;
  document.title = `${p.title || 'Épingle'} — Folio`;
  const names = board.tags.filter((t) => tagIdsOf(p).includes(t.id)).map((t) => t.name);
  const img = safeUrl(p.image);
  const link = safeUrl(p.url);

  app.innerHTML = `
    <section class="pin">
      <a class="back" href="#/board/${esc(bid)}">← Retour au tableau</a>
      <h1 class="page-title"><em>${esc(board.name)}</em></h1>
      <div class="pin-layout">
        <div class="pin-media">
          ${img ? `<img src="${esc(img)}" alt="${esc(p.title)}" referrerpolicy="no-referrer">` : '<span class="no-img">Pas de photo</span>'}
        </div>
        <div class="pin-info">
          <p class="card-site">${esc(p.site || hostOf(p.url))}</p>
          <h2 class="pin-title">${esc(p.title || 'Sans titre')}</h2>
          ${p.brand ? `<p class="pin-brand">${esc(p.brand)}</p>` : ''}
          <p class="pin-price">${formatPrice(p)}</p>
          ${names.length ? `<div class="chips">${names.map((n) => `<span class="chip static">${esc(n)}</span>`).join('')}</div>` : ''}
          ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Accéder à l’article</a>` : ''}
          <div class="row">
            <button class="link" id="pin-edit" type="button">Modifier</button>
            <button class="link danger" id="pin-del" type="button">Supprimer</button>
          </div>
        </div>
      </div>
    </section>`;

  $('#pin-edit').onclick = () => openProductDialog(board, p);
  $('#pin-del').onclick = async () => {
    if (!confirm('Supprimer cette épingle ?')) return;
    try {
      await deleteProduct(p.id);
      toast('Épingle supprimée');
      go(`#/board/${bid}`);
    } catch (e) { toast(errMsg(e)); }
  };
}

/* ---------- Dialogue épingle (création / modification) ---------- */
const dlgProduct = $('#dlg-product');
let dialogBoard = null;
let dialogProduct = null;
let pinTags = [];

const REASONS = {
  'no-worker': 'Récupération automatique indisponible pour le moment. Tu peux remplir à la main.',
  timeout: 'Le site met trop de temps à répondre. Complète à la main.',
  network: 'Impossible de joindre le relais pour le moment. Tu peux remplir à la main.',
  'invalid-url': 'Ce lien n’est pas valide.',
  'invalid-protocol': 'Seuls les liens http(s) sont acceptés.',
  'forbidden-host': 'Ce lien ne peut pas être lu par le relais.',
  'not-html': 'Ce lien ne pointe pas vers une page web.',
};
const getWorkerUrl = () => window.FOLIO_CONFIG.WORKER_URL || '';
const explainError = (r) => {
  if (REASONS[r]) return REASONS[r];
  if (/^http-(401|403|429)$/.test(r)) return 'Le site bloque la lecture automatique. Complète à la main.';
  return 'Infos introuvables sur cette page. Complète à la main.';
};

function setStatus(msg, kind = 'info') {
  const el = $('#p-status');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function updatePreview() {
  const src = safeUrl($('#p-image').value);
  $('#p-preview').innerHTML = src
    ? `<img src="${esc(src)}" alt="Aperçu du produit" referrerpolicy="no-referrer">`
    : '<span class="no-img">Aperçu de la photo</span>';
}

function renderChips() {
  $('#p-chips').innerHTML = pinTags.map((t, i) => `
    <span class="chip">${esc(t)}<button type="button" data-rm="${i}" aria-label="Retirer ${esc(t)}">×</button></span>`).join('');
}

function addTag(raw) {
  const input = $('#p-tag-input');
  const t = clip(String(raw).replace(/,/g, ''), 30);
  input.value = '';
  if (!t) return;
  if (!pinTags.some((x) => x.toLowerCase() === t.toLowerCase())) pinTags.push(t);
  renderChips();
}

function openProductDialog(board, product) {
  dialogBoard = board;
  dialogProduct = product;
  pinTags = product
    ? board.tags.filter((t) => tagIdsOf(product).includes(t.id)).map((t) => t.name)
    : [];

  $('#dlg-product-title').textContent = product ? 'Modifier l’épingle' : 'Créer une épingle';
  $('#p-url').value = product?.url || '';
  $('#p-title').value = product?.title || '';
  $('#p-brand').value = product?.brand || '';
  $('#p-site').value = product?.site || '';
  $('#p-price').value = product?.price ?? '';
  const cur = product?.currency || 'EUR';
  if (![...$('#p-currency').options].some((o) => o.value === cur)) $('#p-currency').add(new Option(cur, cur));
  $('#p-currency').value = cur;
  $('#p-image').value = product?.image || '';
  $('#p-tag-input').value = '';
  $('#tag-suggestions').innerHTML = board.tags.map((t) => `<option value="${esc(t.name)}">`).join('');
  setStatus(product ? '' : 'Colle le lien : les infos se remplissent automatiquement.');
  renderChips();
  updatePreview();
  dlgProduct.showModal();
  $('#p-url').focus();
}

async function fetchInfo() {
  const url = $('#p-url').value.trim();
  if (!FolioScraper.isValidUrl(url)) return setStatus('Colle un lien complet commençant par https://', 'error');

  const workerUrl = getWorkerUrl();
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
  if (d.currency) {
    if (![...$('#p-currency').options].some((o) => o.value === d.currency)) $('#p-currency').add(new Option(d.currency, d.currency));
    $('#p-currency').value = d.currency;
  }
  if (d.image) $('#p-image').value = safeUrl(d.image);
  updatePreview();

  const found = ['title', 'brand', 'price', 'image'].some((k) => d[k] != null && d[k] !== '');
  setStatus(
    found ? 'Infos récupérées. Vérifie avant d’enregistrer.' : 'Aucune info exploitable sur cette page. Complète à la main.',
    found ? 'ok' : 'info',
  );
}

$('#p-fetch').addEventListener('click', fetchInfo);
$('#p-image').addEventListener('input', updatePreview);
$('#p-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); fetchInfo(); }
});
$('#p-url').addEventListener('paste', () => setTimeout(() => {
  if (FolioScraper.isValidUrl($('#p-url').value.trim()) && getWorkerUrl()) fetchInfo();
}, 50));

$('#p-tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target.value); }
});
$('#p-tag-input').addEventListener('blur', (e) => addTag(e.target.value));
$('#p-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  pinTags.splice(Number(b.dataset.rm), 1);
  renderChips();
});

$('#form-product').addEventListener('submit', async (e) => {
  e.preventDefault();
  addTag($('#p-tag-input').value);

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

  const save = $('#p-save');
  save.disabled = true;
  try {
    await saveProduct(dialogBoard.id, data, pinTags, dialogProduct?.id ?? null);
    dlgProduct.close();
    toast(dialogProduct ? 'Épingle mise à jour' : 'Épingle ajoutée');
    route();
  } catch (err) {
    setStatus(errMsg(err), 'error');
  } finally {
    save.disabled = false;
  }
});

/* ---------- Menu : compte, réglages, export, déconnexion ---------- */
const dlgMenu = $('#dlg-menu');

function openMenu() {
  $('#m-email').textContent = session?.user?.email || '';
  $('#m-name').value = firstName(session?.user);
  dlgMenu.showModal();
}

$('#form-name').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await auth.setFirstName(clip($('#m-name').value, 40));
    toast('Prénom enregistré');
    route();
  } catch (err) { toast(errMsg(err)); }
});

$('#m-export').addEventListener('click', async () => {
  try {
    const boards = await loadAll();
    const payload = { app: 'folio', version: 2, exportedAt: new Date().toISOString(), boards };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `folio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { toast(errMsg(e)); }
});

$('#m-logout').addEventListener('click', async () => {
  dlgMenu.close();
  await auth.signOut();
});

$('#btn-menu').addEventListener('click', openMenu);

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

/* ---------- Routage et démarrage ---------- */
async function route() {
  if (!session) return renderLogin();
  const h = location.hash;
  let m = h.match(/^#\/board\/([\w-]+)\/pin\/([\w-]+)$/);
  if (m) return renderPin(m[1], m[2]);
  m = h.match(/^#\/board\/([\w-]+)$/);
  if (m) return renderBoard(m[1]);
  return renderHome();
}

window.addEventListener('hashchange', route);

sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (event === 'SIGNED_OUT') filters = newFilters(null);
  route();
});
