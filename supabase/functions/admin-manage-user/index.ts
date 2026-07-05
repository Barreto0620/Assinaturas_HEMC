import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Confirma que o chamador é admin
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

    // Cliente admin (service_role) para operações privilegiadas
    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { acao, usuario_id, payload } = body;

    let resultado: Record<string, unknown> = {};

    switch (acao) {
      case "listar_colaboradores": {
        resultado = { colaboradores: await listarColaboradores(adminClient) };
        break;
      }

      case "resetar_senha": {
        const novaSenhaTemporaria = payload?.novaSenha || gerarSenhaTemporaria();

        const { error } = await adminClient.auth.admin.updateUserById(usuario_id, {
          password: novaSenhaTemporaria,
        });
        if (error) throw error;

        await adminClient
          .from("profiles")
          .update({ senha_redefinida: false, senha_alterada: false })
          .eq("id", usuario_id);

        await registrarLog(adminClient, usuario_id, "reset_senha", caller.id, {
          por_admin: true,
        });

        resultado = { senhaTemporaria: novaSenhaTemporaria };
        break;
      }

      case "alternar_status": {
        const { ativo } = payload;
        const { error } = await adminClient
          .from("profiles")
          .update({ ativo })
          .eq("id", usuario_id);
        if (error) throw error;

        await registrarLog(adminClient, usuario_id, ativo ? "ativado" : "desativado", caller.id, {});
        resultado = { ativo };
        break;
      }

      case "atualizar_perfil": {
        const camposPermitidos = ["nome_completo", "cargo", "telefone", "departamento_id"];
        const dadosLimpos: Record<string, unknown> = {};
        for (const campo of camposPermitidos) {
          if (payload[campo] !== undefined) dadosLimpos[campo] = payload[campo];
        }

        const { error } = await adminClient
          .from("profiles")
          .update(dadosLimpos)
          .eq("id", usuario_id);
        if (error) throw error;

        await registrarLog(adminClient, usuario_id, "atualizacao_perfil", caller.id, { campos: dadosLimpos });
        resultado = { atualizado: true };
        break;
      }

      default:
        throw new Error(`Ação desconhecida: ${acao}`);
    }

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
// Listagem de colaboradores — fonte de verdade é o Supabase Auth
// =========================================================
// Antes, o painel só enxergava quem já tinha um registro em "profiles"
// (criado no primeiro login). Isso escondia pessoas que já existem no
// Auth (e-mail já cadastrado) mas ainda nunca fizeram o primeiro acesso.
//
// Aqui buscamos TODOS os usuários do Auth (paginado) e cruzamos com
// "profiles" pelo id. Quem não tem perfil ainda aparece com os dados
// vazios (nome/cargo/departamento) mas com o e-mail sempre visível e
// marcado como "Nunca acessou" / "possui_perfil: false", para deixar
// claro quem falta entrar pela primeira vez.
async function listarColaboradores(adminClient: ReturnType<typeof createClient>) {
  const authUsers = await listarTodosUsuariosAuth(adminClient);

  const { data: perfis, error: perfilError } = await adminClient
    .from("profiles")
    .select("*");
  if (perfilError) throw perfilError;

  const perfisPorId = new Map((perfis || []).map((p: any) => [p.id, p]));

  return authUsers.map((u) => {
    const perfil: any = perfisPorId.get(u.id) || null;
    const possuiPerfil = !!perfil;

    // IMPORTANTE: "email" e "ultimo_login" sempre priorizam o Auth (u.email /
    // u.last_sign_in_at), que é a fonte de verdade sobre quem existe e quem
    // já acessou de fato. O front-end usa "ultimo_login" (não "possui_perfil")
    // para decidir o badge de 1º acesso — é o sinal mais direto e confiável.
    return {
      id: u.id,
      email: u.email || perfil?.email || null,
      nome_completo: perfil?.nome_completo || null,
      cargo: perfil?.cargo || null,
      telefone: perfil?.telefone || null,
      departamento_id: perfil?.departamento_id || null,
      re: perfil?.re ?? null,
      is_admin: perfil?.is_admin || false,
      ativo: perfil ? (perfil.ativo ?? true) : true,
      primeiro_acesso: possuiPerfil ? (perfil.primeiro_acesso ?? false) : true,
      ultimo_login: u.last_sign_in_at || perfil?.ultimo_login || null,
      possui_perfil: possuiPerfil,
      criado_em_auth: u.created_at,
    };
  });
}

// Busca todos os usuários do Auth, paginando automaticamente
// (a API do Supabase Auth retorna no máximo 1000 por página,
// mas paginamos de 200 em 200 por segurança/consistência).
async function listarTodosUsuariosAuth(adminClient: ReturnType<typeof createClient>) {
  const usuarios: any[] = [];
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    usuarios.push(...data.users);

    if (data.users.length < perPage) break;
    page += 1;
    if (page > 50) break; // trava de segurança (10.000 usuários)
  }

  return usuarios;
}

function gerarSenhaTemporaria(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let senha = "";
  for (let i = 0; i < 10; i++) senha += chars[Math.floor(Math.random() * chars.length)];
  return senha;
}

async function registrarLog(
  client: ReturnType<typeof createClient>,
  usuario_id: string,
  acao: string,
  executado_por: string,
  detalhes: Record<string, unknown>
) {
  const { data: perfil } = await client.from("profiles").select("nome_completo").eq("id", usuario_id).single();
  await client.from("activity_logs").insert({
    usuario_id,
    nome_no_momento: perfil?.nome_completo || "Desconhecido",
    acao,
    detalhes,
    executado_por,
  });
} 