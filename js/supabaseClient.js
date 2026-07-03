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
 * Se não houver ou o perfil estiver corrompido, redireciona para o login.
 * Retorna { user, profile } quando válida, ou null.
 */
export async function exigirSessaoAtiva() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error || !session) {
    window.location.href = "index.html";
    return null;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("*, departamentos ( nome )")
    .eq("id", session.user.id)
    .single();

  if (profileError) {
    console.error("Erro ao carregar perfil do usuário:", profileError);
    
    // Tratamento para o erro PGRST116 (registro não encontrado na tabela profiles)
    if (profileError.code === "PGRST116") {
      alert("Seu perfil de usuário não foi encontrado no sistema. Entre em contato com o suporte.");
    }
    
    // Se não há perfil válido, força o logout para evitar loops ou telas quebradas
    await fazerLogout();
    return null;
  }

  return { user: session.user, profile };
}

/**
 * Realiza o encerramento da sessão e limpa estados locais.
 */
export async function fazerLogout() {
  try {
    await supabaseClient.auth.signOut();
  } catch (err) {
    console.error("Erro ao executar signOut:", err);
  } finally {
    // Garante o redirecionamento mesmo se a chamada de rede falhar
    window.location.href = "index.html";
  }
}

/**
 * Garante que existe uma sessão ativa E que o usuário é admin.
 * Caso contrário, redireciona para o gerador (usuário comum)
 * ou para o login (sem sessão).
 */
export async function exigirSessaoAdmin() {
  const sessaoInfo = await exigirSessaoAtiva();
  if (!sessaoInfo) return null;

  if (!sessaoInfo.profile?.is_admin) {
    window.location.href = "gerador.html";
    return null;
  }

  return sessaoInfo;
}

/**
 * Invoca a Edge Function admin-manage-user com o token da sessão atual.
 */
export async function chamarAcaoAdmin(acao, usuario_id, payload = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("Sessão expirada ou inválida.");

  const { data, error } = await supabaseClient.functions.invoke("admin-manage-user", {
    body: { acao, usuario_id, payload },
  });

  if (error) throw error;
  return data;
}