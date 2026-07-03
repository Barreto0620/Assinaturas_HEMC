import { supabaseClient } from './supabaseClient.js';

// =========================================================
// Módulo de Autenticação Institucional — HEMC/FUABC
// Responsável por: login, validação de conta ativa,
// sincronização de perfil, redefinição obrigatória de senha
// no primeiro acesso, tratamento de sessão e registro de
// auditoria (activity_logs).
// =========================================================

const DOMINIO_INSTITUCIONAL = "@hemc.fuabc.org.br";
const PREFIXO_RAMAL = "(11) 2829-";
const REDIRECT_URL = "gerador.html";

const els = {
  form: document.getElementById("form-auth"),
  btnSubmit: document.getElementById("btn-submit"),
  msgErro: document.getElementById("msg-erro"),
  msgSucesso: document.getElementById("msg-sucesso"),
  nome: document.getElementById("nome"),
  email: document.getElementById("email"),
  senha: document.getElementById("senha"),
  cargo: document.getElementById("cargo"),
  telefone: document.getElementById("telefone"),

  // Modal de redefinição de senha (primeiro acesso)
  modalOverlay: document.getElementById("modal-redefinir-senha-overlay"),
  formRedefinicao: document.getElementById("form-redefinir-senha"),
  novaSenha: document.getElementById("nova-senha"),
  confirmarSenha: document.getElementById("confirmar-senha"),
  btnConfirmarRedefinicao: document.getElementById("btn-confirmar-redefinicao"),
  msgErroRedefinicao: document.getElementById("msg-erro-redefinicao"),
};

// =========================================================
// 1. Utilidades de UI
// =========================================================

function mostrarErro(texto) {
  els.msgSucesso?.classList.remove("visivel");
  if (!els.msgErro) return;
  els.msgErro.textContent = texto;
  els.msgErro.classList.add("visivel");
}

function mostrarSucesso(texto) {
  els.msgErro?.classList.remove("visivel");
  if (!els.msgSucesso) return;
  els.msgSucesso.textContent = texto;
  els.msgSucesso.classList.add("visivel");
}

function limparMensagens() {
  els.msgErro?.classList.remove("visivel");
  els.msgSucesso?.classList.remove("visivel");
}

function setCarregando(carregando) {
  if (!els.btnSubmit) return;
  els.btnSubmit.disabled = carregando;
  els.btnSubmit.textContent = carregando ? "Validando..." : "Entrar";
}

function mostrarErroRedefinicao(texto) {
  if (!els.msgErroRedefinicao) return;
  els.msgErroRedefinicao.textContent = texto;
  els.msgErroRedefinicao.classList.add("visivel");
}

function limparErroRedefinicao() {
  els.msgErroRedefinicao?.classList.remove("visivel");
}

function setCarregandoRedefinicao(carregando) {
  if (!els.btnConfirmarRedefinicao) return;
  els.btnConfirmarRedefinicao.disabled = carregando;
  els.btnConfirmarRedefinicao.textContent = carregando ? "Salvando..." : "Salvar e continuar";
}

function abrirModalRedefinicao() {
  els.modalOverlay?.classList.add("visivel");
}

function fecharModalRedefinicao() {
  els.modalOverlay?.classList.remove("visivel");
}

// =========================================================
// 2. Log estruturado (facilita debug em produção)
// =========================================================

function log(etapa, detalhe = "") {
  console.info(`[auth] ${etapa}`, detalhe);
}

function logErro(etapa, erro) {
  console.error(`[auth] ${etapa}`, erro?.message || erro);
}

// =========================================================
// 2.1 Auditoria — registro de atividades na tabela activity_logs
// Nunca deve travar o fluxo principal do usuário: falhas aqui
// são apenas logadas no console, nunca lançadas adiante.
// =========================================================

async function registrarAtividade(usuarioId, nomeCompleto, acao, detalhes = {}) {
  try {
    const { error } = await supabaseClient.from("activity_logs").insert({
      usuario_id: usuarioId,
      nome_no_momento: nomeCompleto,
      acao,
      detalhes,
    });
    if (error) throw error;
  } catch (erro) {
    logErro("registrarAtividade", erro);
  }
}

async function atualizarUltimoLogin(usuarioId) {
  try {
    const { error } = await supabaseClient
      .from("profiles")
      .update({ ultimo_login: new Date().toISOString() })
      .eq("id", usuarioId);
    if (error) throw error;
  } catch (erro) {
    logErro("atualizarUltimoLogin", erro);
  }
}

// =========================================================
// 3. Coleta e validação dos dados do formulário
// =========================================================

function coletarDadosFormulario() {
  const emailPrefixo = els.email?.value.trim() ?? "";
  const senha = els.senha?.value ?? "";
  const nomeCompleto = els.nome?.value.trim() ?? "";
  const cargo = els.cargo?.value.trim() ?? "";
  const ramal = els.telefone?.value.trim() ?? "";

  return {
    emailPrefixo,
    email: emailPrefixo ? `${emailPrefixo}${DOMINIO_INSTITUCIONAL}` : "",
    senha,
    nomeCompleto,
    cargo,
    ramal,
    telefoneFormatado: ramal ? `${PREFIXO_RAMAL}${ramal}` : "",
  };
}

function validarDados({ emailPrefixo, cargo, ramal, senha, nomeCompleto }) {
  if (!emailPrefixo) {
    return "Por favor, insira o seu e-mail institucional.";
  }
  if (!senha) {
    return "Por favor, insira a sua senha.";
  }
  if (!nomeCompleto || nomeCompleto.length < 3) {
    return "Por favor, insira o seu nome completo.";
  }
  if (!cargo) {
    return "Por favor, informe o seu Cargo institucional.";
  }
  if (!ramal || ramal.length !== 4 || !/^\d{4}$/.test(ramal)) {
    return "Por favor, insira um Ramal válido contendo exatamente 4 dígitos.";
  }
  return null;
}

function validarNovaSenha(novaSenha, confirmarSenha) {
  if (!novaSenha || novaSenha.length < 6) {
    return "A nova senha deve ter no mínimo 6 caracteres.";
  }
  if (novaSenha !== confirmarSenha) {
    return "As senhas não coincidem. Verifique e tente novamente.";
  }
  return null;
}

// =========================================================
// 3.1 Diff dos dados de perfil (usado para registrar no log de
// login exatamente o que mudou em relação ao acesso anterior)
// =========================================================

// Normaliza strings para comparação: remove espaços nas pontas e trata
// string vazia como equivalente a "não preenchido" — evita falso-negativo
// (campo marcado como "sem alteração" por causa de espaço/whitespace).
function normalizarParaComparacao(valor) {
  const texto = (valor ?? "").toString().trim();
  return texto.length ? texto : null;
}

function montarDiffPerfil(perfilAntes, dados) {
  const alteracoes = {};

  const nomeAntes = normalizarParaComparacao(perfilAntes?.nome_completo);
  const cargoAntes = normalizarParaComparacao(perfilAntes?.cargo);
  const telefoneAntes = normalizarParaComparacao(perfilAntes?.telefone);

  const nomeDepois = normalizarParaComparacao(dados.nomeCompleto);
  const cargoDepois = normalizarParaComparacao(dados.cargo);
  const telefoneDepois = normalizarParaComparacao(dados.telefoneFormatado);

  if (nomeAntes !== nomeDepois) {
    alteracoes.nome_completo = { de: nomeAntes, para: nomeDepois };
  }
  if (cargoAntes !== cargoDepois) {
    alteracoes.cargo = { de: cargoAntes, para: cargoDepois };
  }
  if (telefoneAntes !== telefoneDepois) {
    alteracoes.telefone = { de: telefoneAntes, para: telefoneDepois };
  }

  return alteracoes;
}

// =========================================================
// 4. Autenticação
// =========================================================

async function autenticar(email, senha) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) throw error;
  if (!data?.user) throw new Error("Falha inesperada: usuário não retornado pela autenticação.");

  return data.user;
}

// =========================================================
// 5. Validação de conta ativa e verificação de primeiro acesso
// Verifica se o perfil existe, não está desativado/bloqueado e
// se a senha já foi redefinida (primeiro acesso).
// Também traz nome/cargo/telefone/email já salvos, para servir de
// base de comparação (diff) no log de login.
// Tolerante à ausência das colunas "ativo" e "senha_redefinida"
// (não quebra caso não existam — trata como já liberado/redefinido).
// =========================================================

async function validarContaAtiva(usuarioId) {
  const { data: perfil, error } = await supabaseClient
    .from("profiles")
    .select("id, ativo, senha_redefinida, nome_completo, cargo, telefone, email")
    .eq("id", usuarioId)
    .maybeSingle();

  if (error) {
    logErro("validarContaAtiva:leitura", error);
    return { ativo: true, senhaRedefinida: true, perfil: null };
  }

  if (perfil && perfil.ativo === false) {
    return { ativo: false, senhaRedefinida: true, perfil };
  }

  const senhaRedefinida = perfil?.senha_redefinida === undefined
    ? true
    : perfil.senha_redefinida === true;

  return { ativo: true, senhaRedefinida, perfil };
}

// =========================================================
// 6. Sincronização do perfil (tabela "profiles")
// Único ponto de persistência de nome/cargo/telefone/email — não
// usamos mais auth.updateUser() para evitar duplicidade de fontes.
// O e-mail é gravado aqui porque o painel administrativo lê a
// coluna "profiles.email" (não tem acesso a auth.users via RLS).
// =========================================================

async function sincronizarPerfil(usuarioId, nomeCompleto, cargo, telefoneFormatado, email) {
  const { error } = await supabaseClient
    .from("profiles")
    .upsert(
      {
        id: usuarioId,
        nome_completo: nomeCompleto,
        cargo,
        telefone: telefoneFormatado,
        email,
      },
      { onConflict: "id" }
    );

  if (error) {
    logErro("sincronizarPerfil", error);
    throw new Error("Não foi possível sincronizar os dados do perfil institucional.");
  }

  log("sincronizarPerfil:sucesso", { usuarioId, cargo });
}

// =========================================================
// 6.1 Marca o perfil como tendo passado pela redefinição de senha
// =========================================================

async function marcarSenhaRedefinida(usuarioId) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({ senha_redefinida: true, primeiro_acesso: false, senha_alterada: true })
    .eq("id", usuarioId);

  if (error) {
    logErro("marcarSenhaRedefinida", error);
    throw new Error("Não foi possível concluir a atualização de segurança da sua conta.");
  }

  log("marcarSenhaRedefinida:sucesso", { usuarioId });
}

// =========================================================
// 7. Tradução de erros técnicos para mensagens amigáveis
// =========================================================

function traduzirErro(erro) {
  const msg = erro?.message || "";

  const mapa = {
    "Invalid login credentials": "E-mail institucional ou senha inválidos.",
    "Email not confirmed": "Por favor, confirme seu e-mail corporativo antes de prosseguir.",
    "User not found": "Usuário não encontrado na base institucional.",
    "Too many requests": "Muitas tentativas em sequência. Aguarde alguns instantes e tente novamente.",
    "Network request failed": "Falha de conexão. Verifique sua internet e tente novamente.",
    "New password should be different from the old password.": "A nova senha deve ser diferente da senha atual.",
    "Password should be at least 6 characters.": "A nova senha deve ter no mínimo 6 caracteres.",
  };

  return mapa[msg] || "Ocorreu um erro ao prosseguir. Verifique suas informações e tente novamente.";
}

// =========================================================
// 8. Redirecionamento
// =========================================================

function redirecionar(destino = REDIRECT_URL, atraso = 900) {
  setTimeout(() => {
    window.location.href = destino;
  }, atraso);
}

// =========================================================
// 9. Fluxo principal de login (orquestração)
// =========================================================

let usuarioPendenteRedefinicao = null;

async function processarLogin(evento) {
  evento.preventDefault();
  limparMensagens();
  setCarregando(true);

  const dados = coletarDadosFormulario();
  const erroValidacao = validarDados(dados);

  if (erroValidacao) {
    mostrarErro(erroValidacao);
    setCarregando(false);
    return;
  }

  try {
    log("autenticar:inicio", { email: dados.email });
    const usuario = await autenticar(dados.email, dados.senha);
    log("autenticar:sucesso", { id: usuario.id });

    const { ativo, senhaRedefinida, perfil: perfilAntes } = await validarContaAtiva(usuario.id);
    if (!ativo) {
      await supabaseClient.auth.signOut();
      mostrarErro("Sua conta está desativada. Entre em contato com o setor de TI.");
      setCarregando(false);
      return;
    }

    await sincronizarPerfil(usuario.id, dados.nomeCompleto, dados.cargo, dados.telefoneFormatado, dados.email);
    await atualizarUltimoLogin(usuario.id);

    // ---------------------------------------------------------
    // 📋 Log detalhado do login — registra com qual nome, cargo e
    // ramal o colaborador efetivamente entrou, e sinaliza (via
    // campos_alterados) caso algum desses dados tenha mudado em
    // relação ao que estava salvo no acesso anterior.
    // ---------------------------------------------------------
    const alteracoesPerfil = montarDiffPerfil(perfilAntes, dados);
    await registrarAtividade(usuario.id, dados.nomeCompleto, "login", {
      nome_completo: dados.nomeCompleto,
      cargo: dados.cargo,
      ramal: dados.telefoneFormatado,
      email: dados.email,
      ...(Object.keys(alteracoesPerfil).length ? { campos_alterados: alteracoesPerfil } : {}),
    });

    // ---------------------------------------------------------
    // 🔐 Primeiro acesso: bloqueia o fluxo normal e exige que o
    // usuário defina uma nova senha antes de prosseguir.
    // ---------------------------------------------------------
    if (!senhaRedefinida) {
      log("processarLogin:primeiroAcesso", { id: usuario.id });
      usuarioPendenteRedefinicao = usuario;
      mostrarSucesso("Login validado. Por segurança, defina uma nova senha.");
      setCarregando(false);
      abrirModalRedefinicao();
      return;
    }

    mostrarSucesso("Acesso validado! Atualizando informações institucionais...");
    redirecionar();
  } catch (erro) {
    logErro("processarLogin", erro);
    mostrarErro(traduzirErro(erro));
    setCarregando(false);
  }
}

// =========================================================
// 9.1 Fluxo de redefinição obrigatória de senha (primeiro acesso)
// =========================================================

async function processarRedefinicaoSenha(evento) {
  evento.preventDefault();
  limparErroRedefinicao();

  if (!usuarioPendenteRedefinicao) {
    mostrarErroRedefinicao("Sessão expirada. Faça login novamente.");
    return;
  }

  const novaSenha = els.novaSenha?.value ?? "";
  const confirmarSenha = els.confirmarSenha?.value ?? "";

  const erroValidacao = validarNovaSenha(novaSenha, confirmarSenha);
  if (erroValidacao) {
    mostrarErroRedefinicao(erroValidacao);
    return;
  }

  setCarregandoRedefinicao(true);

  try {
    log("processarRedefinicaoSenha:inicio", { id: usuarioPendenteRedefinicao.id });

    const { error: erroSenha } = await supabaseClient.auth.updateUser({
      password: novaSenha,
    });

    if (erroSenha) throw erroSenha;

    await marcarSenhaRedefinida(usuarioPendenteRedefinicao.id);
    await registrarAtividade(
      usuarioPendenteRedefinicao.id,
      usuarioPendenteRedefinicao.user_metadata?.nome_completo || els.nome?.value.trim() || "Colaborador",
      "primeiro_acesso_concluido"
    );

    log("processarRedefinicaoSenha:sucesso", { id: usuarioPendenteRedefinicao.id });

    fecharModalRedefinicao();
    mostrarSucesso("Senha redefinida com sucesso! Redirecionando...");
    usuarioPendenteRedefinicao = null;

    redirecionar();
  } catch (erro) {
    logErro("processarRedefinicaoSenha", erro);
    mostrarErroRedefinicao(traduzirErro(erro));
    setCarregandoRedefinicao(false);
  }
}

// =========================================================
// 10. Verificação de sessão existente ao carregar a página
// =========================================================

async function verificarSessaoExistente() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) {
      logErro("verificarSessaoExistente", error);
      return;
    }
    if (session) {
      log("verificarSessaoExistente:sessaoAtiva", { userId: session.user?.id });

      const { ativo, senhaRedefinida } = await validarContaAtiva(session.user.id);

      if (!ativo) {
        await supabaseClient.auth.signOut();
        return;
      }

      if (!senhaRedefinida) {
        usuarioPendenteRedefinicao = session.user;
        abrirModalRedefinicao();
        return;
      }

      redirecionar(REDIRECT_URL, 0);
    }
  } catch (erro) {
    logErro("verificarSessaoExistente:excecao", erro);
  }
}

// =========================================================
// 11. Inicialização
// =========================================================

if (els.form) {
  els.form.addEventListener("submit", processarLogin);
}

if (els.formRedefinicao) {
  els.formRedefinicao.addEventListener("submit", processarRedefinicaoSenha);
}

verificarSessaoExistente();