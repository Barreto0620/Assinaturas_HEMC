import { supabaseClient, exigirSessaoAdmin, chamarAcaoAdmin, fazerLogout } from './supabaseClient.js';

let TODOS_COLABORADORES = [];
let TODOS_LOGS = [];
let ADMIN_ATUAL = null;

// =========================================================
// Inicialização
// =========================================================
(async function iniciar() {
  const sessaoInfo = await exigirSessaoAdmin();
  if (!sessaoInfo) return;

  ADMIN_ATUAL = sessaoInfo;
  document.getElementById("admin-nome-topo").textContent = sessaoInfo.profile?.nome_completo || sessaoInfo.user.email;

  await Promise.all([carregarColaboradores(), carregarLogs()]);
  atualizarCards();

  configurarTabs();
  configurarFiltros();
  configurarModais();
  configurarTema();
})();

document.getElementById("btn-logout")?.addEventListener("click", fazerLogout);

// =========================================================
// Carregamento de dados
// =========================================================
async function carregarColaboradores() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, nome_completo, email, cargo, telefone, ativo, primeiro_acesso, ultimo_login, is_admin")
    .order("nome_completo", { ascending: true });

  if (error) {
    console.error("Erro ao carregar colaboradores:", error);
    return;
  }

  TODOS_COLABORADORES = data || [];
  renderizarColaboradores(TODOS_COLABORADORES);
}

async function carregarLogs() {
  const { data, error } = await supabaseClient
    .from("activity_logs")
    .select("id, usuario_id, nome_no_momento, acao, detalhes, executado_por, criado_em")
    .order("criado_em", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Erro ao carregar logs:", error);
    return;
  }

  TODOS_LOGS = data || [];
  renderizarLogs(TODOS_LOGS);
}

function atualizarCards() {
  const total = TODOS_COLABORADORES.length;
  const ativos = TODOS_COLABORADORES.filter((c) => c.ativo).length;
  const inativos = total - ativos;

  const ha24h = Date.now() - 24 * 60 * 60 * 1000;
  const atividade24h = TODOS_LOGS.filter((l) => new Date(l.criado_em).getTime() >= ha24h).length;

  document.getElementById("card-total").textContent = total;
  document.getElementById("card-ativos").textContent = ativos;
  document.getElementById("card-inativos").textContent = inativos;
  document.getElementById("card-atividade-24h").textContent = atividade24h;
}

// =========================================================
// Renderização: Colaboradores
// =========================================================
function renderizarColaboradores(lista) {
  const corpo = document.getElementById("corpo-tabela-colaboradores");

  if (!lista.length) {
    corpo.innerHTML = `<tr><td colspan="7" class="admin-tabela-vazia">Nenhum colaborador encontrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = lista.map((c) => `
    <tr>
      <td>${escapeHtml(c.nome_completo)}</td>
      <td>${escapeHtml(c.email || "-")}</td>
      <td>${escapeHtml(c.cargo || "-")}</td>
      <td><span class="admin-badge ${c.ativo ? "admin-badge-ativo" : "admin-badge-inativo"}">${c.ativo ? "Ativo" : "Inativo"}</span></td>
      <td>${c.primeiro_acesso ? '<span class="admin-badge admin-badge-pendente">Pendente</span>' : "Concluído"}</td>
      <td>${c.ultimo_login ? formatarData(c.ultimo_login) : "Nunca acessou"}</td>
      <td class="admin-tabela-acoes">
        <button class="admin-icon-btn" data-acao="editar" data-id="${c.id}" title="Editar">✏️</button>
        <button class="admin-icon-btn" data-acao="reset" data-id="${c.id}" title="Resetar senha">🔑</button>
        <button class="admin-icon-btn" data-acao="assinatura" data-id="${c.id}" title="Gerar assinatura">📝</button>
        <button class="admin-icon-btn" data-acao="status" data-id="${c.id}" data-ativo="${c.ativo}" title="${c.ativo ? "Desativar" : "Ativar"}">
          ${c.ativo ? "🚫" : "✅"}
        </button>
      </td>
    </tr>
  `).join("");

  corpo.querySelectorAll("[data-acao]").forEach((btn) => {
    btn.addEventListener("click", () => tratarAcaoColaborador(btn.dataset.acao, btn.dataset.id, btn.dataset));
  });
}

// =========================================================
// Renderização: Logs
// =========================================================
function renderizarLogs(lista) {
  const corpo = document.getElementById("corpo-tabela-logs");

  if (!lista.length) {
    corpo.innerHTML = `<tr><td colspan="5" class="admin-tabela-vazia">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  const nomesPorId = Object.fromEntries(TODOS_COLABORADORES.map((c) => [c.id, c.nome_completo]));

  corpo.innerHTML = lista.map((l) => `
    <tr>
      <td>${formatarData(l.criado_em)}</td>
      <td>${escapeHtml(l.nome_no_momento)}</td>
      <td><span class="admin-badge admin-badge-acao">${traduzirAcao(l.acao)}</span></td>
      <td class="admin-detalhes-cel">${formatarDetalhes(l.detalhes)}</td>
      <td>${l.executado_por ? escapeHtml(nomesPorId[l.executado_por] || "Admin") : "Próprio usuário"}</td>
    </tr>
  `).join("");
}

function traduzirAcao(acao) {
  const mapa = {
    login: "Login",
    cadastro: "Cadastro",
    atualizacao_perfil: "Atualização de perfil",
    reset_senha: "Reset de senha",
    assinatura_gerada: "Assinatura gerada",
    ativado: "Ativação",
    desativado: "Desativação",
    primeiro_acesso_concluido: "1º acesso concluído",
  };
  return mapa[acao] || acao;
}

function formatarDetalhes(detalhes) {
  if (!detalhes || Object.keys(detalhes).length === 0) return "-";
  try {
    return escapeHtml(JSON.stringify(detalhes));
  } catch {
    return "-";
  }
}

function formatarData(iso) {
  return new Date(iso).toLocaleString("pt-BR");
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// =========================================================
// Tabs
// =========================================================
function configurarTabs() {
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("ativo"));
      document.querySelectorAll(".admin-tab-content").forEach((c) => c.classList.remove("ativo"));
      tab.classList.add("ativo");
      document.getElementById(tab.dataset.tab).classList.add("ativo");
    });
  });
}

// =========================================================
// Filtros
// =========================================================
function configurarFiltros() {
  document.getElementById("filtro-nome").addEventListener("input", aplicarFiltroColaboradores);
  document.getElementById("filtro-status").addEventListener("change", aplicarFiltroColaboradores);

  document.getElementById("filtro-log-nome").addEventListener("input", aplicarFiltroLogs);
  document.getElementById("filtro-log-acao").addEventListener("change", aplicarFiltroLogs);
  document.getElementById("filtro-log-data-inicio").addEventListener("change", aplicarFiltroLogs);
  document.getElementById("filtro-log-data-fim").addEventListener("change", aplicarFiltroLogs);

  document.getElementById("btn-exportar-csv").addEventListener("click", exportarLogsCSV);
}

function aplicarFiltroColaboradores() {
  const termo = document.getElementById("filtro-nome").value.toLowerCase().trim();
  const status = document.getElementById("filtro-status").value;

  const filtrados = TODOS_COLABORADORES.filter((c) => {
    const bateTermo = !termo ||
      c.nome_completo?.toLowerCase().includes(termo) ||
      c.email?.toLowerCase().includes(termo);
    const bateStatus =
      status === "todos" ||
      (status === "ativo" && c.ativo) ||
      (status === "inativo" && !c.ativo);
    return bateTermo && bateStatus;
  });

  renderizarColaboradores(filtrados);
}

function obterLogsFiltrados() {
  const termo = document.getElementById("filtro-log-nome").value.toLowerCase().trim();
  const acao = document.getElementById("filtro-log-acao").value;
  const dataInicio = document.getElementById("filtro-log-data-inicio").value;
  const dataFim = document.getElementById("filtro-log-data-fim").value;

  return TODOS_LOGS.filter((l) => {
    const bateTermo = !termo || l.nome_no_momento?.toLowerCase().includes(termo);
    const bateAcao = acao === "todas" || l.acao === acao;
    const dataLog = new Date(l.criado_em);
    const bateInicio = !dataInicio || dataLog >= new Date(dataInicio + "T00:00:00");
    const bateFim = !dataFim || dataLog <= new Date(dataFim + "T23:59:59");
    return bateTermo && bateAcao && bateInicio && bateFim;
  });
}

function aplicarFiltroLogs() {
  renderizarLogs(obterLogsFiltrados());
}

// =========================================================
// Exportação CSV (respeita os filtros aplicados)
// =========================================================
function exportarLogsCSV() {
  const logs = obterLogsFiltrados();

  const cabecalho = ["Data/Hora", "Colaborador", "Ação", "Detalhes", "Executado por"];
  const linhas = logs.map((l) => [
    formatarData(l.criado_em),
    l.nome_no_momento,
    traduzirAcao(l.acao),
    l.detalhes ? JSON.stringify(l.detalhes) : "",
    l.executado_por || "Próprio usuário",
  ]);

  const csv = [cabecalho, ...linhas]
    .map((linha) => linha.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(";"))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `logs_assina_ai_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// =========================================================
// Ações de colaborador
// =========================================================
function tratarAcaoColaborador(acao, id, dataset) {
  const colaborador = TODOS_COLABORADORES.find((c) => c.id === id);
  if (!colaborador) return;

  switch (acao) {
    case "editar":
      abrirModalEditar(colaborador);
      break;
    case "reset":
      abrirConfirmacao(
        "Resetar senha",
        `Deseja gerar uma nova senha temporária para ${colaborador.nome_completo}? A senha atual deixará de funcionar.`,
        async () => {
          const resultado = await chamarAcaoAdmin("resetar_senha", id);
          document.getElementById("texto-senha-gerada").textContent = resultado.senhaTemporaria;
          abrirModal("modal-senha-gerada");
          await recarregarTudo();
        }
      );
      break;
    case "status": {
      const ativoAtual = dataset.ativo === "true";
      const acaoTexto = ativoAtual ? "desativar" : "ativar";
      abrirConfirmacao(
        `${ativoAtual ? "Desativar" : "Ativar"} colaborador`,
        `Deseja ${acaoTexto} o acesso de ${colaborador.nome_completo}?`,
        async () => {
          await chamarAcaoAdmin("alternar_status", id, { ativo: !ativoAtual });
          await recarregarTudo();
        }
      );
      break;
    }
    case "assinatura":
      // Redireciona ao gerador em "modo admin", pré-carregando os dados do colaborador
      sessionStorage.setItem("admin-gerar-para", JSON.stringify(colaborador));
      window.location.href = "gerador.html?adminGerarPara=" + id;
      break;
  }
}

async function recarregarTudo() {
  await Promise.all([carregarColaboradores(), carregarLogs()]);
  atualizarCards();
  aplicarFiltroColaboradores();
}

// =========================================================
// Modais
// =========================================================
function configurarModais() {
  document.querySelectorAll(".admin-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fecharModal(overlay);
    });
    overlay.querySelectorAll("[data-fechar]").forEach((btn) =>
      btn.addEventListener("click", () => fecharModal(overlay))
    );
  });

  document.getElementById("form-editar-colaborador").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-id").value;
    const nome_completo = document.getElementById("edit-nome").value.trim();
    const cargo = document.getElementById("edit-cargo").value.trim();
    const ramal = document.getElementById("edit-ramal").value.trim();

    try {
      await chamarAcaoAdmin("atualizar_perfil", id, {
        nome_completo,
        cargo,
        telefone: ramal ? `(11) 2829-${ramal}` : undefined,
      });
      fecharModal(document.getElementById("modal-editar"));
      await recarregarTudo();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    }
  });
}

function abrirModal(id) {
  document.getElementById(id)?.classList.add("visivel");
}

function fecharModal(overlay) {
  overlay.classList.remove("visivel");
}

function abrirModalEditar(colaborador) {
  document.getElementById("edit-id").value = colaborador.id;
  document.getElementById("edit-nome").value = colaborador.nome_completo || "";
  document.getElementById("edit-cargo").value = colaborador.cargo || "";
  document.getElementById("edit-ramal").value = (colaborador.telefone || "").replace(/\D/g, "").slice(-4);
  abrirModal("modal-editar");
}

let acaoConfirmadaCallback = null;

function abrirConfirmacao(titulo, texto, aoConfirmar) {
  document.getElementById("confirmar-titulo").textContent = titulo;
  document.getElementById("confirmar-texto").textContent = texto;
  acaoConfirmadaCallback = aoConfirmar;
  abrirModal("modal-confirmar");
}

document.getElementById("btn-confirmar-acao")?.addEventListener("click", async () => {
  if (acaoConfirmadaCallback) {
    const btn = document.getElementById("btn-confirmar-acao");
    btn.disabled = true;
    btn.textContent = "Processando...";
    try {
      await acaoConfirmadaCallback();
    } catch (err) {
      alert("Erro: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Confirmar";
      fecharModal(document.getElementById("modal-confirmar"));
      acaoConfirmadaCallback = null;
    }
  }
});

// =========================================================
// Tema (mesmo padrão do gerador.html)
// =========================================================
function configurarTema() {
  const root = document.documentElement;
  const btn = document.getElementById("btn-tema");
  const label = document.getElementById("theme-toggle-label");

  function temaAtual() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function atualizarLabel() {
    label.textContent = temaAtual() === "light" ? "Claro" : "Escuro";
  }

  btn.addEventListener("click", () => {
    const novo = temaAtual() === "light" ? "dark" : "light";
    if (novo === "dark") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", "light");
    try { localStorage.setItem("hemc-tema", novo); } catch (e) {}
    atualizarLabel();
  });

  atualizarLabel();
}