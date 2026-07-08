import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =========================================================
// admin-sync-referencia
// =========================================================
// Function isolada e de responsabilidade única: sincroniza "cargo" e
// "setor" de um colaborador entre "profiles" (o que o painel administrativo
// edita) e "colaboradores_referencia" (a base consultada pela tela de
// login, via RPC buscar_cargo_por_nome, para validar o nome e preencher o
// Cargo automaticamente).
//
// Por que uma function separada em vez de mexer em "admin-manage-user":
// mantém o fluxo principal de gestão de colaboradores (listar, resetar
// senha, ativar/desativar, atualizar perfil) intocado e estável. Qualquer
// ajuste futuro nessa sincronização fica isolado aqui, sem risco de
// quebrar as outras ações administrativas.
//
// Esta function NUNCA deve ser a responsável por falhar uma atualização de
// perfil: ela é chamada DEPOIS que "admin-manage-user" já salvou os dados
// em "profiles" com sucesso. Se a sincronização aqui falhar, o painel
// avisa o admin, mas o perfil já está salvo corretamente.
// =========================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autenticado.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente autenticado com o token do CHAMADOR, só para validar quem é
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) throw new Error("Sessão inválida.");

    // Confirma que o chamador é admin — mesma regra do admin-manage-user
    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .single();

    if (profileErr || !callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: "Acesso negado: requer permissão de administrador." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { usuario_id } = await req.json();
    if (!usuario_id) throw new Error("usuario_id é obrigatório.");

    const resultado = await sincronizarComReferencia(adminClient, usuario_id);

    return new Response(JSON.stringify(resultado), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =========================================================
// Lógica principal de sincronização
// =========================================================
// Lê o cargo/setor ATUAIS de "profiles" (fonte de verdade após a edição
// no painel) e grava em "colaboradores_referencia", casando:
//   1ª tentativa — por RE (matrícula): mais preciso, não depende de grafia.
//   2ª tentativa (fallback) — por nome normalizado, via RPC
//      atualizar_referencia_por_nome, quando o perfil não tem RE ou o RE
//      não existe na base de referência.
async function sincronizarComReferencia(
  adminClient: ReturnType<typeof createClient>,
  usuario_id: string
) {
  const { data: perfil, error: perfilErr } = await adminClient
    .from("profiles")
    .select("re, nome_completo, cargo, setor")
    .eq("id", usuario_id)
    .single();

  if (perfilErr || !perfil) {
    throw new Error("Colaborador não encontrado em profiles.");
  }

  if (!perfil.cargo && !perfil.setor) {
    return { sincronizado: false, motivo: "Nada para sincronizar (cargo e setor vazios)." };
  }

  const atualizacao: Record<string, unknown> = {};
  if (perfil.cargo) atualizacao.cargo = perfil.cargo;
  if (perfil.setor) atualizacao.setor = perfil.setor;

  // Tentativa 1: por RE
  if (perfil.re !== null && perfil.re !== undefined) {
    const { error, count } = await adminClient
      .from("colaboradores_referencia")
      .update(atualizacao, { count: "exact" })
      .eq("re", perfil.re);

    if (error) {
      throw new Error(`Falha ao sincronizar por RE: ${error.message}`);
    }
    if (count && count > 0) {
      return { sincronizado: true, metodo: "re", linhasAfetadas: count };
    }
  }

  // Tentativa 2 (fallback): por nome normalizado
  if (!perfil.nome_completo) {
    return { sincronizado: false, motivo: "Sem RE e sem nome_completo — não foi possível casar com a base de referência." };
  }

  const { data: linhasAfetadas, error: rpcError } = await adminClient.rpc("atualizar_referencia_por_nome", {
    p_nome: perfil.nome_completo,
    p_cargo: atualizacao.cargo ?? null,
    p_setor: atualizacao.setor ?? null,
  });

  if (rpcError) {
    throw new Error(`Falha ao sincronizar por nome: ${rpcError.message}`);
  }

  if (!linhasAfetadas || linhasAfetadas === 0) {
    return {
      sincronizado: false,
      motivo: "Nenhum colaborador correspondente encontrado em colaboradores_referencia (nome sem match exato).",
    };
  }

  return { sincronizado: true, metodo: "nome", linhasAfetadas };
}