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