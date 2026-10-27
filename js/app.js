/* Folio — pages et logique de l'interface. Les données sont dans Supabase (voir api.js). */
import {
  sb, auth, loadAll, getBoard, createBoard, renameBoard, deleteBoard, deleteProduct, saveProduct,
  setBoardShare, getSharedBoard, uploadCover, setBoardCover, setProductPurchased, setProductLiked,
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
  boardId, q: '', min: '', max: '', brands: new Set(), tags: new Set(), sort: 'recent', open: false, liked: false,
});

/* ---------- État ---------- */
let session = null;
let homeBoards = [];
let current = null;                    // Folio affiché
let filters = newFilters(null);

const setLoggedIn = () => { document.body.classList.remove('is-login'); $('#btn-menu').hidden = false; };
const setLoggedOut = () => { document.body.classList.add('is-login'); $('#btn-menu').hidden = true; };
const setShared = () => { document.body.classList.remove('is-login'); $('#btn-menu').hidden = !session; };
const fail = (e) => { toast(errMsg(e)); app.innerHTML = '<p class="empty">Impossible de charger cette page. Réessaie dans un instant.</p>'; };

/* ---------- Cartes ---------- */
function boardCard(b) {
  const covers = [...b.products].slice(0, 4).map((p) => safeUrl(p.image)).filter(Boolean);
  const cells = [0, 1, 2, 3].map((i) => (covers[i]
    ? `<img src="${esc(covers[i])}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<span></span>')).join('');
  const photo = safeUrl(b.cover_url);
  const cover = photo
    ? `<div class="cover cover-photo"><img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
    : `<div class="cover${covers.length ? '' : ' cover-empty'}">${cells}</div>`;
  return `
    <a class="board-card" href="#/board/${esc(b.id)}">
      ${cover}
      <h2 class="board-name"><em>${esc(b.name)}</em></h2>
      <span class="board-count">${plural(b.products.length, 'épingle')}</span>
    </a>`;
}

function pinCard(p, boardId, boardName = '', withDelete = false) {
  const img = safeUrl(p.image);
  const link = safeUrl(p.url);
  return `
    <article class="card${p.purchased ? ' is-bought' : ''}" data-id="${esc(p.id)}">
      ${p.purchased ? '<p class="bought-tag">Acheté</p>' : ''}
      <button type="button" class="heart" data-like="${esc(p.id)}" aria-pressed="${p.liked ? 'true' : 'false'}" aria-label="Coup de cœur">${p.liked ? '♥' : '♡'}</button>
      <a class="card-link" href="#/board/${esc(boardId)}/pin/${esc(p.id)}">
        <div class="card-media">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="no-img">Pas de photo</span>'}
        </div>
        <div class="card-body">
          <p class="card-site">${esc(p.site || hostOf(p.url))}</p>
          <h3 class="card-title">${esc(p.title || 'Sans titre')}</h3>
          ${p.brand ? `<p class="card-brand">${esc(p.brand)}</p>` : ''}
          ${boardName ? `<p class="card-brand">Dans ${esc(boardName)}</p>` : ''}
          ${withDelete && p.is_public ? '<p class="card-brand">Publique</p>' : ''}
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
const TAGLINE = 'Keep what\nyou love.';

/* Écrit la baseline lettre par lettre, après le fondu du logo. */
function typeTagline(el) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = TAGLINE;
    return;
  }
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  const tick = () => {
    el.textContent = TAGLINE.slice(0, ++i);
    if (i < TAGLINE.length) setTimeout(tick, 70);
    else el.classList.remove('typing');
  };
  setTimeout(tick, 2000);
}

function renderLogin() {
  setLoggedOut();
  document.title = 'Folio — Keep what you love.';
  app.innerHTML = `
    <section class="login">
      <div class="login-brand">
        <img src="assets/folio.svg" alt="Folio" class="logo logo-light">
        <span class="login-sep" aria-hidden="true"></span>
        <p class="login-tag" id="login-tag"></p>
      </div>
      <button class="btn light" id="btn-login" type="button">Connexion avec Google</button>
    </section>`;
  typeTagline($('#login-tag'));
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
      <div class="hero">
        <h1 class="page-title"><em>Bienvenue</em><span class="name">${esc(firstName(session.user))},</span></h1>
      </div>
      <div class="toolbar">
        <input id="home-search" class="search" type="search" placeholder="Rechercher une épingle" autocomplete="off">
        <button class="btn" id="btn-new-board" type="button">Créer un Folio</button>
      </div>
      <div id="home-body">${loading()}</div>
    </section>`;

  $('#btn-new-board').onclick = async () => {
    const name = clip(prompt('Nom du Folio (ex. Déco)') || '', 60);
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
      : '<p class="empty">Aucun Folio pour l’instant. Crée le premier.</p>';
    return;
  }

  const hits = homeBoards.flatMap((b) => b.products
    .filter((p) => matches(p, needle))
    .map((p) => ({ p, b })));
  body.innerHTML = hits.length
    ? `<div class="grid">${hits.map(({ p, b }) => pinCard(p, b.id, b.name)).join('')}</div>`
    : `<p class="empty">Aucune épingle ne correspond à « ${esc(q)} ».</p>`;
}

/* ---------- Folio ---------- */
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
      <a class="back" href="#/">← Retour aux Folios</a>
      <div class="board-head">
        <h1 class="page-title"><em>${esc(board.name)}</em></h1>
        <div class="row">
          <button class="link" id="btn-cover" type="button">Changer la photo</button>
          ${board.cover_url ? '<button class="link" id="btn-cover-reset" type="button">Retirer la photo</button>' : ''}
          <button class="link" id="btn-rename" type="button">Renommer</button>
          <button class="link danger" id="btn-delete-board" type="button">Supprimer le Folio</button>
        </div>
      </div>
      <div class="toolbar">
        <input id="b-search" class="search" type="search" placeholder="Rechercher une épingle" value="${esc(filters.q)}" autocomplete="off">
        <button class="btn" id="btn-add" type="button">Créer une épingle</button>
        <button class="btn ghost" id="btn-filters" type="button" aria-expanded="${filters.open}">Filtres</button>
        <button class="btn ghost" id="btn-share" type="button">Partager</button>
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
  $('#btn-share').onclick = openShare;
  $('#btn-cover').onclick = () => $('#cover-input').click();
  const reset = $('#btn-cover-reset');
  if (reset) reset.onclick = async () => {
    try {
      await setBoardCover(current.id, null);
      toast('Photo retirée');
      route();
    } catch (e) { toast(errMsg(e)); }
  };

  $('#btn-rename').onclick = async () => {
    const name = clip(prompt('Nouveau nom du Folio', current.name) || '', 60);
    if (!name) return;
    try { await renameBoard(current.id, name); route(); } catch (e) { toast(errMsg(e)); }
  };
  $('#btn-delete-board').onclick = async () => {
    if (!confirm(`Supprimer « ${current.name} » et toutes ses épingles ?`)) return;
    try {
      await deleteBoard(current.id);
      toast('Folio supprimé');
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

/* ---------- Coups de cœur ---------- */
const likeLabel = (on) => (on ? 'Retirer le coup de cœur' : 'Ajouter aux coups de cœur');

/* Bouton cœur sur la photo : met à jour la base, puis les données locales et l'affichage. */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-like]');
  if (!btn) return;
  e.preventDefault();
  const id = btn.dataset.like;
  const liked = btn.getAttribute('aria-pressed') !== 'true';
  try {
    await setProductLiked(id, liked);
    [current, ...homeBoards].forEach((b) => {
      const p = b?.products.find((x) => x.id === id);
      if (p) p.liked = liked;
    });
    if (current && $('#grid')) renderGrid(current);
    else if ($('#home-body')) renderHomeBody($('#home-search')?.value || '');
  } catch (err) { toast(errMsg(err)); }
});

/* ---------- Photo du Folio ---------- */
$('#cover-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !current) return;
  if (!file.type.startsWith('image/')) return toast('Choisis un fichier image.');
  if (file.size > 5 * 1024 * 1024) return toast('Image trop lourde (5 Mo maximum).');

  toast('Envoi de la photo…');
  try {
    const url = await uploadCover(current.id, session.user.id, file);
    await setBoardCover(current.id, url);
    toast('Photo du Folio mise à jour');
    route();
  } catch (err) {
    toast(errMsg(err));
  }
});

/* ---------- Partage du Folio ---------- */
const dlgShare = $('#dlg-share');
const shareLink = (token) => `${location.origin}${location.pathname}#/share/${token}`;

function renderShareDialog() {
  const url = current.share_enabled && current.share_token ? shareLink(current.share_token) : '';
  $('#s-active').checked = !!current.share_enabled;
  $('#s-url').value = url;
  $('#s-copy').disabled = !url;
}

function openShare() {
  renderShareDialog();
  dlgShare.showModal();
}

$('#s-active').addEventListener('change', async (e) => {
  const on = e.target.checked;
  // Le lien est créé une seule fois et conservé : le désactiver puis le réactiver ne change pas l'adresse.
  const share_token = current.share_token || crypto.randomUUID().replace(/-/g, '');
  try {
    await setBoardShare(current.id, { share_token, share_enabled: on });
    current.share_token = share_token;
    current.share_enabled = on;
    renderShareDialog();
    toast(on ? 'Lien de partage activé' : 'Lien de partage désactivé');
  } catch (err) {
    e.target.checked = !on;
    toast(errMsg(err));
  }
});

$('#s-copy').addEventListener('click', async () => {
  const input = $('#s-url');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Lien copié');
  } catch {
    input.select();
    toast('Copie le lien manuellement.');
  }
});

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
      <fieldset>
        <legend>Coups de cœur</legend>
        <label class="check">
          <input type="checkbox" id="f-liked" ${filters.liked ? 'checked' : ''}>
          <span>Seulement mes coups de cœur</span>
        </label>
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
    else if (t.id === 'f-liked') filters.liked = t.checked;
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
    if (filters.liked && !p.liked) return false;
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
  if (!total) html = '<p class="empty">Ce Folio est vide. Ajoute ta première épingle.</p>';
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
      <a class="back" href="#/board/${esc(bid)}">← Retour au Folio</a>
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
          ${p.note ? `<p class="pin-note">${esc(p.note)}</p>` : ''}
          <p class="muted small">${p.is_public ? 'Publique : visible sur le lien de partage' : 'Privée : non visible sur le lien de partage'}</p>
          <label class="field">État
            <select id="pin-status">
              <option value="todo" ${p.purchased ? '' : 'selected'}>Wish</option>
              <option value="bought" ${p.purchased ? 'selected' : ''}>Acheté</option>
            </select>
          </label>
          ${names.length ? `<div class="chips">${names.map((n) => `<span class="chip static">${esc(n)}</span>`).join('')}</div>` : ''}
          ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Accéder à l’article</a>` : ''}
          <div class="row pin-actions">
            <button class="btn ghost" id="pin-like" type="button">${likeLabel(p.liked)}</button>
            <button class="btn ghost" id="pin-copy" type="button">Ajouter à un autre Folio</button>
          </div>
          <div class="row">
            <button class="link" id="pin-edit" type="button">Modifier</button>
            <button class="link danger" id="pin-del" type="button">Supprimer</button>
          </div>
        </div>
      </div>
    </section>`;

  $('#pin-edit').onclick = () => openProductDialog(board, p);
  $('#pin-copy').onclick = () => openCopy(board, p, names);
  $('#pin-like').onclick = async (e) => {
    const liked = !p.liked;
    try {
      await setProductLiked(p.id, liked);
      p.liked = liked;
      e.target.textContent = likeLabel(liked);
      toast(liked ? 'Ajoutée aux coups de cœur' : 'Retirée des coups de cœur');
    } catch (err) { toast(errMsg(err)); }
  };
  $('#pin-status').onchange = async (e) => {
    const purchased = e.target.value === 'bought';
    try {
      await setProductPurchased(p.id, purchased);
      p.purchased = purchased;
      toast(purchased ? 'Marquée comme achetée' : 'Remise en wish');
    } catch (err) {
      e.target.value = purchased ? 'todo' : 'bought';
      toast(errMsg(err));
    }
  };
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
  $('#p-public').checked = !!product?.is_public;
  $('#p-note').value = product?.note || '';
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

/* Lit le formulaire d'épingle. Renvoie null (et affiche l'erreur) si le lien est absent. */
function readProductForm() {
  addTag($('#p-tag-input').value);

  const url = $('#p-url').value.trim();
  if (!FolioScraper.isValidUrl(url)) {
    setStatus('Le lien du produit est obligatoire (https://…).', 'error');
    return null;
  }

  const priceRaw = $('#p-price').value.trim();
  const price = priceRaw === '' ? null : Number(priceRaw.replace(',', '.'));
  return {
    url,
    title: clip($('#p-title').value, 200),
    brand: clip($('#p-brand').value, 80),
    site: clip($('#p-site').value, 80) || hostOf(url),
    price: price !== null && isFinite(price) ? price : null,
    currency: $('#p-currency').value,
    image: safeUrl($('#p-image').value),
    is_public: $('#p-public').checked,
    note: clip($('#p-note').value, 500),
  };
}

$('#form-product').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readProductForm();
  if (!data) return;

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

/* Enregistre l'épingle puis propose de l'ajouter à d'autres Folios. */
$('#p-copy').addEventListener('click', async () => {
  const data = readProductForm();
  if (!data) return;

  const board = dialogBoard;
  const names = [...pinTags];
  const btn = $('#p-copy');
  btn.disabled = true;
  try {
    const id = await saveProduct(board.id, data, pinTags, dialogProduct?.id ?? null);
    dlgProduct.close();
    route();
    openCopy(board, { ...data, id }, names);
  } catch (err) {
    setStatus(errMsg(err), 'error');
  } finally {
    btn.disabled = false;
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

/* ---------- Ajouter une épingle à d'autres Folios (copie indépendante) ---------- */
const dlgCopy = $('#dlg-copy');
let copySource = null;

async function openCopy(board, p, names) {
  copySource = { product: p, tagNames: names };
  let others;
  try {
    others = (await loadAll()).filter((b) => b.id !== board.id);
  } catch (e) { return toast(errMsg(e)); }

  $('#c-list').innerHTML = others.length
    ? others.map((b) => `
      <label class="check">
        <input type="checkbox" value="${esc(b.id)}">
        <span>${esc(b.name)}</span>
      </label>`).join('')
    : '<p class="muted small">Tu n’as pas encore d’autre Folio. Crées-en un d’abord.</p>';
  $('#c-save').disabled = !others.length;
  dlgCopy.showModal();
}

$('#c-save').addEventListener('click', async () => {
  const ids = [...$('#c-list').querySelectorAll('input:checked')].map((i) => i.value);
  if (!ids.length || !copySource) return toast('Choisis au moins un Folio.');

  const { product: p, tagNames } = copySource;
  const data = {
    url: p.url,
    title: p.title,
    brand: p.brand,
    site: p.site,
    price: p.price,
    currency: p.currency,
    image: p.image,
    is_public: p.is_public,
    note: p.note,
  };
  const btn = $('#c-save');
  btn.disabled = true;
  try {
    for (const id of ids) await saveProduct(id, data, tagNames);
    dlgCopy.close();
    toast(ids.length > 1 ? 'Épingle ajoutée aux Folios' : 'Épingle ajoutée au Folio');
  } catch (e) {
    toast(errMsg(e));
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Page partagée (accessible sans compte) ---------- */
const sharedCard = (p) => {
  const img = safeUrl(p.image);
  const link = safeUrl(p.url);
  return `
    <article class="card">
      <div class="card-media">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="no-img">Pas de photo</span>'}
      </div>
      <div class="card-body">
        <p class="card-site">${esc(p.site || hostOf(p.url))}</p>
        <h3 class="card-title">${esc(p.title || 'Sans titre')}</h3>
        ${p.brand ? `<p class="card-brand">${esc(p.brand)}</p>` : ''}
        <p class="card-price">${formatPrice(p)}</p>
      </div>
      ${link ? `<div class="card-actions"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Voir</a></div>` : ''}
    </article>`;
};

const joinCta = () => `
  <aside class="join">
    <p class="join-text"><em>Et toi, qu’est-ce que tu aimes ?</em></p>
    <a class="btn light" href="#/">Rejoignez Folio</a>
  </aside>`;

async function renderShared(token) {
  setShared();
  app.innerHTML = loading();
  let data;
  try {
    data = await getSharedBoard(token);
  } catch (e) { return fail(e); }

  if (!data) {
    document.title = 'Folio';
    app.innerHTML = `
      <section class="shared">
        <p class="empty">Ce lien de partage n’est plus actif.</p>
        ${joinCta()}
      </section>`;
    return;
  }

  const { board, owner, products } = data;
  document.title = `${board.name} — Folio`;
  app.innerHTML = `
    <section class="shared">
      <div class="hero">
        <h1 class="page-title"><em>Bienvenue sur le Folio</em> ${esc(board.name)}${owner ? ` de ${esc(owner)}` : ''}</h1>
      </div>
      ${products.length
        ? `<div class="grid">${products.map(sharedCard).join('')}</div>`
        : '<p class="empty">Aucune épingle publique pour l’instant.</p>'}
      ${joinCta()}
    </section>`;
}

/* ---------- Routage et démarrage ---------- */
async function route() {
  const h = location.hash;
  const s = h.match(/^#\/share\/([\w-]+)$/);
  if (s) return renderShared(s[1]);
  if (!session) return renderLogin();
  let m = h.match(/^#\/board\/([\w-]+)\/pin\/([\w-]+)$/);
  if (m) return renderPin(m[1], m[2]);
  m = h.match(/^#\/board\/([\w-]+)$/);
  if (m) return renderBoard(m[1]);
  return renderHome();
}

window.addEventListener('hashchange', route);

/* ---------- Écran de chargement au lancement ---------- */
const SPLASH_MIN_MS = 4500;   // le temps que la séquence (fond, logo, baseline) se termine
let splashDone = false;

/* Écrit un texte lettre par lettre dans un élément, après un délai. */
function typeInto(el, text, delay) {
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = text;
    return;
  }
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  const tick = () => {
    el.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(tick, 100);
    else el.classList.remove('typing');
  };
  setTimeout(tick, delay);
}

/* Masque l'écran de chargement. Connecté : après la séquence complète. Sans session : tout de suite,
   car la page de connexion joue déjà sa propre animation. */
function dismissSplash(loggedIn) {
  const el = $('#splash');
  if (!el || splashDone) return;
  splashDone = true;
  const hide = () => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 700);
  };
  if (!loggedIn) return el.remove(); // pas de fondu : évite de superposer les deux logos
  setTimeout(hide, Math.max(0, SPLASH_MIN_MS - performance.now()));
}

typeInto($('#splash-tag'), TAGLINE, 2000);

sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (event === 'SIGNED_OUT') filters = newFilters(null);
  dismissSplash(!!s);
  route();
});
