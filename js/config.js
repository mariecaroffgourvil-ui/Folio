/* Folio — configuration publique, commune à tous les utilisateurs.
   La clé « publishable » peut être publique : la sécurité repose sur les règles RLS de Supabase.
   Ne jamais mettre ici la clé « secret » ou « service_role ». */
window.FOLIO_CONFIG = {
  SUPABASE_URL: 'https://xsjzjircrythurcdbirj.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_85qhypfV0SsRplqK8Q-eEQ_CfBVAywS',
  // Relais Cloudflare qui récupère les infos des pages produit (commun à tous).
  WORKER_URL: 'https://folio.marie-caroff-gourvil.workers.dev',
};
