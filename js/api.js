/* Folio — accès aux données (Supabase). Toutes les requêtes sont filtrées par les règles RLS. */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.FOLIO_CONFIG;
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const byRecent = (a, b) => new Date(b.added_at) - new Date(a.added_at);
const num = (v) => (v == null || v === '' ? null : Number(v));

/* ---------- Authentification ---------- */
export const auth = {
  signIn: () => sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  }),
  signOut: () => sb.auth.signOut(),
  setFirstName: (prenom) => sb.auth.updateUser({ data: { prenom } }),
};

/* ---------- Tableaux ---------- */
export async function loadAll() {
  const boards = check(await sb.from('boards')
    .select('id, name, created_at, cover_url, products(*)')
    .order('created_at', { ascending: false }));
  boards.forEach((b) => {
    b.products = b.products.map((p) => ({ ...p, price: num(p.price) })).sort(byRecent);
  });
  // Tableaux les plus récents en premier : d'après la dernière épingle ajoutée (ou la création si vide).
  const lastActivity = (b) => (b.products[0]
    ? new Date(b.products[0].added_at).getTime()
    : new Date(b.created_at).getTime());
  boards.sort((a, b) => lastActivity(b) - lastActivity(a));
  return boards;
}

export async function getBoard(id) {
  const [b, t] = await Promise.all([
    sb.from('boards').select('id, name, cover_url, share_token, share_enabled, products(*, product_tags(tag_id))').eq('id', id).maybeSingle(),
    sb.from('tags').select('id, name').eq('board_id', id).order('name'),
  ]);
  const board = check(b);
  const tags = check(t);
  if (!board) return null;
  board.tags = tags;
  board.products = board.products.map((p) => ({ ...p, price: num(p.price) })).sort(byRecent);
  return board;
}

export const createBoard = async (name) =>
  check(await sb.from('boards').insert({ name }).select('id, name').single());

export const renameBoard = async (id, name) =>
  check(await sb.from('boards').update({ name }).eq('id', id));

export const deleteBoard = async (id) =>
  check(await sb.from('boards').delete().eq('id', id));

/* ---------- Coups de cœur ---------- */
export const setProductLiked = async (id, liked) =>
  check(await sb.from('products').update({ liked }).eq('id', id));

/* ---------- État d'achat ---------- */
export const setProductPurchased = async (id, purchased) =>
  check(await sb.from('products').update({ purchased }).eq('id', id));

/* ---------- Photo du tableau ---------- */
/* Envoie l'image dans le dossier de l'utilisateur (bucket « covers ») et renvoie son adresse publique. */
export async function uploadCover(boardId, userId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${userId}/${boardId}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('covers').upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
}

export const setBoardCover = async (id, cover_url) =>
  check(await sb.from('boards').update({ cover_url }).eq('id', id));

/* ---------- Partage ---------- */
export const setBoardShare = async (id, { share_token, share_enabled }) =>
  check(await sb.from('boards').update({ share_token, share_enabled }).eq('id', id));

/* Accessible sans compte : la fonction SQL ne renvoie que le tableau et ses épingles publiques. */
export async function getSharedBoard(token) {
  const data = check(await sb.rpc('get_shared_board', { p_token: token }));
  if (!data) return null;
  data.products = (data.products || []).map((p) => ({ ...p, price: num(p.price) }));
  return data;
}

/* ---------- Épingles ---------- */
export const deleteProduct = async (id) =>
  check(await sb.from('products').delete().eq('id', id));

/* Crée ou met à jour une épingle, puis remplace ses tags. */
export async function saveProduct(boardId, data, tagNames, productId = null) {
  let id = productId;
  if (id) {
    check(await sb.from('products').update(data).eq('id', id));
  } else {
    const row = check(await sb.from('products').insert({ ...data, board_id: boardId }).select('id').single());
    id = row.id;
  }

  const tags = await ensureTags(boardId, tagNames);
  check(await sb.from('product_tags').delete().eq('product_id', id));
  if (tags.length) {
    check(await sb.from('product_tags').insert(tags.map((t) => ({ product_id: id, tag_id: t.id }))));
  }
  return id;
}

/* Retourne les tags (existants ou créés) correspondant aux noms, sans tenir compte de la casse. */
async function ensureTags(boardId, names) {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!wanted.length) return [];

  const existing = check(await sb.from('tags').select('id, name').eq('board_id', boardId));
  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t]));

  const missing = wanted.filter((n) => !byLower.has(n.toLowerCase()));
  if (missing.length) {
    const created = check(await sb.from('tags')
      .insert(missing.map((name) => ({ board_id: boardId, name })))
      .select('id, name'));
    created.forEach((t) => byLower.set(t.name.toLowerCase(), t));
  }
  return wanted.map((n) => byLower.get(n.toLowerCase())).filter(Boolean);
}
