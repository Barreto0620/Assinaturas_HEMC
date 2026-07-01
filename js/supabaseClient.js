// =========================================================
// Cliente único do Supabase, usado em todas as páginas.
// As credenciais vêm do .env (lido automaticamente pelo Vite
// em build/dev) — nada de duplicar valores em outro arquivo.
// =========================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Variáveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas. " +
    "Verifique o arquivo .env (local) ou as Environment Variables do projeto na Vercel."
  );
}

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Garante que existe uma sessão ativa.
 * Se não houver, redireciona para o login.
 * Retorna { user, profile } quando válida, ou null.
 */
export async function exigirSessaoAtiva() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error || !session) {
    window.location.href = "/index.html";
    return null;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("*, departamentos ( nome )")
    .eq("id", session.user.id)
    .single();

  if (profileError) {
    console.error("Erro ao carregar perfil:", profileError);
  }

  return { user: session.user, profile };
}

export async function fazerLogout() {
  await supabaseClient.auth.signOut();
  window.location.href = "/index.html";
}