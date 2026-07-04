import { supabaseClient, exigirSessaoAdmin, chamarAcaoAdmin, fazerLogout } from './supabaseClient.js';

// =========================================================
// Estado
// =========================================================
let TODOS_COLABORADORES = [];
let TODOS_LOGS = [];
let ADMIN_ATUAL = null;
let CANAL_REALTIME = null;

let DEPARTAMENTOS = [];
let DEPARTAMENTOS_POR_ID = {};

const estadoColaboradores = {
  status: 'todos',
  departamentoId: 'todos',
  termo: '',
  ordenarPor: 'nome_completo',
  ordenarDir: 'asc',
  pagina: 1,
  tamanhoPagina: 10,
};

const estadoLogs = {
  termo: '',
  acao: 'todas',
  dataInicio: '',
  dataFim: '',
  pagina: 1,
  tamanhoPagina: 10,
};

const MAPA_ACOES = {
  login: { rotulo: 'Login', tom: 'neutro', icone: '→' },
  cadastro: { rotulo: 'Cadastro', tom: 'sucesso', icone: '+' },
  atualizacao_perfil: { rotulo: 'Atualização de perfil', tom: 'neutro', icone: '✎' },
  reset_senha: { rotulo: 'Reset de senha', tom: 'alerta', icone: '⟳' },
  assinatura_gerada: { rotulo: 'Assinatura gerada', tom: 'sucesso', icone: '✓' },
  ativado: { rotulo: 'Ativação', tom: 'sucesso', icone: '✓' },
  desativado: { rotulo: 'Desativação', tom: 'erro', icone: '×' },
  primeiro_acesso_concluido: { rotulo: '1º acesso concluído', tom: 'sucesso', icone: '✓' },
  cargo_nao_localizado: { rotulo: 'Cargo não localizado', tom: 'alerta', icone: '!' },
};

// Rótulos amigáveis para os campos que aparecem nos diffs de log (nome_completo, cargo, telefone, ...)
const MAPA_CAMPOS = {
  nome_completo: 'Nome',
  cargo: 'Cargo',
  telefone: 'Ramal/Telefone',
  ativo: 'Status',
  departamento_id: 'Departamento',
  re: 'RE',
};

// =========================================================
// Inicialização
// =========================================================
(async function iniciar() {
  const sessaoInfo = await exigirSessaoAdmin();
  if (!sessaoInfo) return;

  ADMIN_ATUAL = sessaoInfo;
  document.getElementById('admin-nome-topo').textContent =
    sessaoInfo.profile?.nome_completo || sessaoInfo.user.email;

  configurarTabs();
  injetarEstilosTimelineLogs();
  configurarToolbarColaboradores();
  configurarToolbarLogs();
  configurarPaginacao();
  configurarModais();
  configurarTema();

  await carregarDepartamentos();
  await carregarTudo();
  configurarRealtime();
})();

document.getElementById('btn-logout')?.addEventListener('click', fazerLogout);
document.getElementById('erro-banner-retry')?.addEventListener('click', carregarTudo);

// =========================================================
// Departamentos
// =========================================================
async function carregarDepartamentos() {
  try {
    DEPARTAMENTOS = await buscarDepartamentos();
    DEPARTAMENTOS_POR_ID = Object.fromEntries(DEPARTAMENTOS.map((d) => [d.id, d.nome]));
    popularFiltroDepartamentos();
    popularSelectDepartamentoEdicao();
  } catch (erro) {
    console.error('Erro ao carregar departamentos:', erro);
    mostrarToast('Não foi possível carregar a lista de departamentos.', 'alerta');
  }
}

async function buscarDepartamentos() {
  const { data, error } = await supabaseClient
    .from('departamentos')
    .select('id, nome')
    .order('nome', { ascending: true });
  if (error) throw error;
  return data || [];
}

function popularFiltroDepartamentos() {
  const select = document.getElementById('filtro-departamento');
  if (!select) return;
  // Mantém a opção "Todos" e recria as demais, para suportar recarregamento.
  select.querySelectorAll('option:not([value="todos"])').forEach((op) => op.remove());
  DEPARTAMENTOS.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.nome;
    select.appendChild(opt);
  });
}

function popularSelectDepartamentoEdicao() {
  const select = document.getElementById('edit-departamento');
  if (!select) return;
  select.querySelectorAll('option:not([value=""])').forEach((op) => op.remove());
  DEPARTAMENTOS.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.nome;
    select.appendChild(opt);
  });
}

function nomeDepartamento(id) {
  if (!id) return null;
  return DEPARTAMENTOS_POR_ID[id] || null;
}

// Enriquece um colaborador vindo do backend com o nome do departamento
// (resolvido localmente a partir do departamento_id), já que a Edge Function
// pode retornar apenas o id.
function enriquecerColaborador(c) {
  return { ...c, departamento_nome: nomeDepartamento(c.departamento_id) };
}

// =========================================================
// Carregamento de dados
// =========================================================
async function carregarTudo() {
  ocultarErro();
  try {
    const [colaboradores, logs] = await Promise.all([buscarColaboradores(), buscarLogs()]);
    TODOS_COLABORADORES = colaboradores;
    TODOS_LOGS = logs;
    atualizarCards();
    renderizarColaboradores();
    renderizarLogs();
  } catch (erro) {
    console.error('Erro ao carregar painel:', erro);
    mostrarErro('Não foi possível carregar os dados do painel. Verifique as permissões de acesso ou sua conexão.');
  }
}

async function buscarColaboradores() {
  // Modificado: Agora busca através da Edge Function para contornar restrições estritas de RLS.
  // Solicitamos um limite alto para manter os filtros reativos locais rodando perfeitamente em memória.
  const resposta = await chamarAcaoAdmin('listar_colaboradores', null, { pagina: 1, limite: 5000 });
  const colaboradores = resposta?.colaboradores || [];
  // IMPORTANTE: a Edge Function "listar_colaboradores" precisa retornar
  // "departamento_id" e "re" de profiles para que estes campos funcionem.
  return colaboradores.map(enriquecerColaborador);
}

async function buscarLogs() {
  const { data, error } = await supabaseClient
    .from('activity_logs')
    .select('id, usuario_id, nome_no_momento, acao, detalhes, executado_por, criado_em')
    .order('criado_em', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

function atualizarCards() {
  const total = TODOS_COLABORADORES.length;
  const ativos = TODOS_COLABORADORES.filter((c) => c.ativo).length;
  const inativos = total - ativos;

  const ha24h = Date.now() - 24 * 60 * 60 * 1000;
  const atividade24h = TODOS_LOGS.filter((l) => new Date(l.criado_em).getTime() >= ha24h).length;

  setValorCard('card-total', total);
  setValorCard('card-ativos', ativos);
  setValorCard('card-inativos', inativos);
  setValorCard('card-atividade-24h', atividade24h);
}

function setValorCard(id, valor) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = valor;
    el.classList.remove('skeleton-valor');
  }
}

// =========================================================
// Erro global (Silenciado para não afetar a interface)
// =========================================================
function mostrarErro(texto) {
  // Apenas deixa o aviso no console do navegador (F12) para os desenvolvedores
  console.warn('Aviso do Painel (Ocultado da UI):', texto);
}

function ocultarErro() {
  const banner = document.getElementById('erro-banner');
  if (banner) banner.hidden = true;
}

// =========================================================
// Colaboradores: filtro + ordenação + paginação
// =========================================================
function obterColaboradoresFiltrados() {
  const termo = estadoColaboradores.termo;
  const status = estadoColaboradores.status;
  const departamentoId = estadoColaboradores.departamentoId;

  let lista = TODOS_COLABORADORES.filter((c) => {
    const bateTermo = !termo ||
      c.nome_completo?.toLowerCase().includes(termo) ||
      c.email?.toLowerCase().includes(termo) ||
      String(c.re ?? '').includes(termo);
    const bateStatus =
      status === 'todos' ||
      (status === 'ativo' && c.ativo) ||
      (status === 'inativo' && !c.ativo);
    const bateDepartamento =
      departamentoId === 'todos' || c.departamento_id === departamentoId;
    return bateTermo && bateStatus && bateDepartamento;
  });

  const { ordenarPor, ordenarDir } = estadoColaboradores;
  lista = lista.slice().sort((a, b) => {
    let va = a[ordenarPor];
    let vb = b[ordenarPor];

    // Tratamento robusto para valores nulos ou indefinidos
    if (va === null || va === undefined) va = '';
    if (vb === null || vb === undefined) vb = '';

    if (ordenarPor === 'ativo') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
    if (ordenarPor === 'ultimo_login') { va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0; }
    if (ordenarPor === 're') { va = va === '' ? -Infinity : Number(va); vb = vb === '' ? -Infinity : Number(vb); }

    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();

    if (va < vb) return ordenarDir === 'asc' ? -1 : 1;
    if (va > vb) return ordenarDir === 'asc' ? 1 : -1;
    return 0;
  });

  return lista;
}

function renderizarColaboradores() {
  const lista = obterColaboradoresFiltrados();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / estadoColaboradores.tamanhoPagina));
  estadoColaboradores.pagina = Math.min(estadoColaboradores.pagina, totalPaginas);

  const inicio = (estadoColaboradores.pagina - 1) * estadoColaboradores.tamanhoPagina;
  const pagina = lista.slice(inicio, inicio + estadoColaboradores.tamanhoPagina);

  const corpo = document.getElementById('corpo-tabela-colaboradores');
  if (!corpo) return;

  document.getElementById('contagem-colaboradores').textContent =
    `${lista.length} colaborador${lista.length === 1 ? '' : 'es'}`;

  if (!pagina.length) {
    corpo.innerHTML = `<tr><td colspan="9" class="admin-tabela-vazia">
      ${lista.length === 0 && TODOS_COLABORADORES.length > 0
        ? 'Nenhum colaborador corresponde aos filtros aplicados.'
        : 'Nenhum colaborador cadastrado ainda.'}
    </td></tr>`;
  } else {
    corpo.innerHTML = pagina.map((c) => `
      <tr data-row-id="${c.id}">
        <td>
          <div class="admin-pessoa">
            <span class="admin-avatar">${iniciais(c.nome_completo)}</span>
            <span>${escapeHtml(c.nome_completo)}</span>
          </div>
        </td>
        <td class="admin-cel-muted">${escapeHtml(c.email || '—')}</td>
        <td>${c.departamento_nome ? escapeHtml(c.departamento_nome) : '<span class="admin-cel-muted">Não definido</span>'}</td>
        <td class="admin-cel-mono">${c.re ?? '<span class="admin-cel-muted">—</span>'}</td>
        <td>${escapeHtml(c.cargo || '—')}</td>
        <td><span class="admin-badge ${c.ativo ? 'admin-badge-ativo' : 'admin-badge-inativo'}"><i></i>${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td>${c.primeiro_acesso ? '<span class="admin-badge admin-badge-pendente"><i></i>Pendente</span>' : '<span class="admin-cel-muted">Concluído</span>'}</td>
        <td class="admin-cel-mono">${c.ultimo_login ? formatarData(c.ultimo_login) : '<span class="admin-cel-muted">Nunca acessou</span>'}</td>
        <td class="admin-tabela-acoes">
          <button class="admin-icon-btn" data-acao="editar" data-id="${c.id}" title="Editar" aria-label="Editar ${escapeHtml(c.nome_completo)}">✎</button>
          <button class="admin-icon-btn" data-acao="reset" data-id="${c.id}" title="Resetar senha" aria-label="Resetar senha de ${escapeHtml(c.nome_completo)}">⟳</button>
          <button class="admin-icon-btn" data-acao="assinatura" data-id="${c.id}" title="Gerar assinatura" aria-label="Gerar assinatura para ${escapeHtml(c.nome_completo)}">✒</button>
          <button class="admin-icon-btn ${c.ativo ? 'admin-icon-btn-perigo' : 'admin-icon-btn-sucesso'}" data-acao="status" data-id="${c.id}" data-ativo="${c.ativo}" title="${c.ativo ? 'Desativar' : 'Ativar'}" aria-label="${c.ativo ? 'Desativar' : 'Ativar'} ${escapeHtml(c.nome_completo)}">
            ${c.ativo ? '⏻' : '✓'}
          </button>
        </td>
      </tr>
    `).join('');

    corpo.querySelectorAll('[data-acao]').forEach((btn) => {
      btn.addEventListener('click', () => tratarAcaoColaborador(btn.dataset.acao, btn.dataset.id, btn.dataset));
    });
  }

  atualizarCabecalhoOrdenacao();
  atualizarPaginacaoUI('colaboradores', lista.length, estadoColaboradores);
}

function atualizarCabecalhoOrdenacao() {
  document.querySelectorAll('#tabela-colaboradores th.ordenavel').forEach((th) => {
    th.classList.remove('ordenado-asc', 'ordenado-desc');
    if (th.dataset.campo === estadoColaboradores.ordenarPor) {
      th.classList.add(estadoColaboradores.ordenarDir === 'asc' ? 'ordenado-asc' : 'ordenado-desc');
    }
  });
}

function iniciais(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/);
  const primeiras = partes[0]?.[0] || '';
  const ultimas = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeiras + ultimas).toUpperCase();
}

// =========================================================
// Logs: filtro + timeline + paginação
// =========================================================
function obterLogsFiltrados() {
  const { termo, acao, dataInicio, dataFim } = estadoLogs;
  return TODOS_LOGS.filter((l) => {
    const bateTermo = !termo || l.nome_no_momento?.toLowerCase().includes(termo);
    const bateAcao = acao === 'todas' || l.acao === acao;
    const dataLog = new Date(l.criado_em);
    const bateInicio = !dataInicio || dataLog >= new Date(dataInicio + 'T00:00:00');
    const bateFim = !dataFim || dataLog <= new Date(dataFim + 'T23:59:59');
    return bateTermo && bateAcao && bateInicio && bateFim;
  });
}

function renderizarLogs() {
  const lista = obterLogsFiltrados();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / estadoLogs.tamanhoPagina));
  estadoLogs.pagina = Math.min(estadoLogs.pagina, totalPaginas);

  const inicio = (estadoLogs.pagina - 1) * estadoLogs.tamanhoPagina;
  const pagina = lista.slice(inicio, inicio + estadoLogs.tamanhoPagina);

  const container = document.getElementById('timeline-logs');
  if (!container) return;

  if (!pagina.length) {
    container.innerHTML = `<div class="admin-tabela-vazia">
      ${lista.length === 0 && TODOS_LOGS.length > 0
        ? 'Nenhum evento corresponde aos filtros aplicados.'
        : 'Nenhuma atividade registrada ainda.'}
    </div>`;
    document.getElementById('paginacao-info-logs').textContent = '—';
    atualizarPaginacaoUI('logs', lista.length, estadoLogs);
    return;
  }

  const nomesPorId = Object.fromEntries(TODOS_COLABORADORES.map((c) => [c.id, c.nome_completo]));

  let grupoAtual = null;
  let html = '';
  pagina.forEach((l) => {
    const dataGrupo = formatarDataGrupo(l.criado_em);
    if (dataGrupo !== grupoAtual) {
      grupoAtual = dataGrupo;
      html += `<div class="admin-timeline-data">${dataGrupo}</div>`;
    }
    const meta = MAPA_ACOES[l.acao] || { rotulo: l.acao, tom: 'neutro', icone: '•' };
    const executor = l.executado_por ? (nomesPorId[l.executado_por] || 'Admin') : 'Próprio usuário';
    const temDetalhes = l.detalhes && Object.keys(l.detalhes).length > 0;
    const resumo = resumoDetalhesLog(l);

    html += `
      <div class="admin-timeline-item">
        <span class="admin-timeline-icone tom-${meta.tom}">${meta.icone}</span>
        <div class="admin-timeline-corpo">
          <div class="admin-timeline-linha1">
            <span class="admin-timeline-nome">${escapeHtml(l.nome_no_momento)}</span>
            <span class="admin-badge admin-badge-acao tom-${meta.tom}">${meta.rotulo}</span>
          </div>
          <div class="admin-timeline-linha2">
            <span class="admin-cel-mono">${formatarHora(l.criado_em)}</span>
            <span class="admin-timeline-ponto">·</span>
            <span>por ${escapeHtml(executor)}</span>
            ${temDetalhes ? `<button class="admin-link-detalhes" data-detalhes-id="${l.id}">Ver detalhes</button>` : ''}
          </div>
          ${resumo ? `<div class="admin-timeline-linha3">${resumo}</div>` : ''}
        </div>
      </div>`;
  });

  container.innerHTML = html;
  container.querySelectorAll('[data-detalhes-id]').forEach((btn) => {
    btn.addEventListener('click', () => abrirDetalhesLog(btn.dataset.detalhesId));
  });

  atualizarPaginacaoUI('logs', lista.length, estadoLogs);
}

// Gera o resumo visual do evento (chips de informação + bloco de alterações),
// exibido direto na timeline, sem precisar abrir o modal de detalhes.
//
// Para o evento de "login": sempre mostra Nome / Cargo / Departamento / RE / Ramal
// com que o colaborador efetivamente entrou, em formato de chips — mantendo o
// registro fiel ao dado empresarial vigente no momento do acesso.
// Quando há alterações (login com dado diferente do último acesso, edição
// de perfil pelo admin, ativação/desativação): mostra um bloco destacado
// "Alterações", com "De" riscado e "Para" em destaque.
function resumoDetalhesLog(log) {
  const detalhes = log?.detalhes;
  if (!detalhes || typeof detalhes !== 'object') return '';

  const blocos = [];

  if (log.acao === 'login') {
    const pares = [];
    if (detalhes.nome_completo) pares.push({ rotulo: 'Nome', valor: detalhes.nome_completo });
    if (detalhes.cargo) pares.push({ rotulo: 'Cargo', valor: detalhes.cargo });
    if (detalhes.departamento) pares.push({ rotulo: 'Departamento', valor: detalhes.departamento });
    if (detalhes.re) pares.push({ rotulo: 'RE', valor: detalhes.re, mono: true });
    if (detalhes.ramal) pares.push({ rotulo: 'Ramal', valor: detalhes.ramal, mono: true });
    if (pares.length) blocos.push(construirChipsInfo(pares));
  }

  const blocoDiff = construirBlocoDiff(detalhes.campos_alterados);
  if (blocoDiff) blocos.push(blocoDiff);

  if (!blocos.length && detalhes.observacao) {
    blocos.push(`<span class="admin-log-observacao">${escapeHtml(detalhes.observacao)}</span>`);
  }

  return blocos.join('');
}

// Monta um conjunto de "chips" (rótulo + valor), lado a lado, com quebra de
// linha automática — usado para exibir Nome/Cargo/Departamento/RE/Ramal do login.
function construirChipsInfo(pares) {
  const chips = pares.map(({ rotulo, valor, mono }) => `
    <span class="admin-log-chip">
      <span class="admin-log-chip-rotulo">${escapeHtml(rotulo)}</span>
      <span class="admin-log-chip-valor${mono ? ' admin-log-chip-mono' : ''}">${escapeHtml(String(valor))}</span>
    </span>`).join('');
  return `<div class="admin-log-chips">${chips}</div>`;
}

// Monta o bloco destacado de alterações a partir de um diff
// { campo: { de, para } }, com "De" riscado e "Para" em destaque.
function construirBlocoDiff(alteracoes) {
  if (!alteracoes || typeof alteracoes !== 'object' || !Object.keys(alteracoes).length) return '';

  const linhas = Object.entries(alteracoes).map(([campo, valores]) => {
    const rotulo = MAPA_CAMPOS[campo] || campo;
    const de = valores?.de ?? '—';
    const para = valores?.para ?? '—';
    return `
      <div class="admin-log-diff-linha">
        <span class="admin-log-diff-rotulo">${escapeHtml(rotulo)}</span>
        <span class="admin-log-diff-de">${escapeHtml(String(de))}</span>
        <span class="admin-log-diff-seta">→</span>
        <span class="admin-log-diff-para">${escapeHtml(String(para))}</span>
      </div>`;
  }).join('');

  return `
    <div class="admin-log-diff-bloco">
      <span class="admin-log-diff-titulo">Alterações</span>
      ${linhas}
    </div>`;
}

// =========================================================
// Estilos da timeline de logs (chips + bloco de diff)
// Injetados dinamicamente para não depender de editar admin.css —
// respeitam o tema claro/escuro já usado no restante do painel.
// =========================================================
function injetarEstilosTimelineLogs() {
  if (document.getElementById('admin-log-estilos-dinamicos')) return;

  const estilo = document.createElement('style');
  estilo.id = 'admin-log-estilos-dinamicos';
  estilo.textContent = `
    .admin-timeline-linha3 {
      margin-top: 8px;
    }

    .admin-log-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .admin-log-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(99, 140, 255, 0.10);
      border: 1px solid rgba(99, 140, 255, 0.22);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 12px;
      line-height: 1.3;
      color: inherit;
    }

    .admin-log-chip-rotulo {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
      opacity: 0.65;
    }

    .admin-log-chip-valor {
      font-weight: 500;
    }

    .admin-log-chip-mono {
      font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
      letter-spacing: 0.03em;
    }

    .admin-log-diff-bloco {
      margin-top: 8px;
      padding: 8px 10px;
      border-left: 3px solid #d69a1f;
      background: rgba(214, 154, 31, 0.10);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .admin-log-diff-titulo {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
      opacity: 0.7;
      margin-bottom: 2px;
    }

    .admin-log-diff-linha {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      flex-wrap: wrap;
    }

    .admin-log-diff-rotulo {
      font-weight: 600;
      min-width: 70px;
      opacity: 0.8;
    }

    .admin-log-diff-de {
      text-decoration: line-through;
      opacity: 0.55;
    }

    .admin-log-diff-seta {
      opacity: 0.5;
    }

    .admin-log-diff-para {
      font-weight: 600;
      color: #3fae76;
    }

    .admin-log-observacao {
      font-size: 12px;
      opacity: 0.6;
      font-style: italic;
    }

    [data-theme="light"] .admin-log-chip {
      background: rgba(39, 68, 127, 0.06);
      border-color: rgba(39, 68, 127, 0.16);
    }

    [data-theme="light"] .admin-log-diff-bloco {
      background: rgba(214, 154, 31, 0.14);
    }
  `;
  document.head.appendChild(estilo);
}

function abrirDetalhesLog(id) {
  const log = TODOS_LOGS.find((l) => String(l.id) === String(id));
  if (!log) return;
  const meta = MAPA_ACOES[log.acao] || { rotulo: log.acao };
  document.getElementById('detalhes-log-resumo').innerHTML = `
    <strong>${escapeHtml(log.nome_no_momento)}</strong> · ${escapeHtml(meta.rotulo)} · ${formatarData(log.criado_em)}
  `;
  document.getElementById('conteudo-detalhes-log').textContent = JSON.stringify(log.detalhes, null, 2);
  abrirModal('modal-detalhes-log');
}

function formatarDataGrupo(iso) {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmoDia = (a, b) => a.toDateString() === b.toDateString();
  if (mesmoDia(data, hoje)) return 'Hoje';
  if (mesmoDia(data, ontem)) return 'Ontem';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatarHora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR');
}

function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// =========================================================
// Tabs
// =========================================================
function configurarTabs() {
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('ativo'));
      document.querySelectorAll('.admin-tab-content').forEach((c) => c.classList.remove('ativo'));
      tab.classList.add('ativo');
      document.getElementById(tab.dataset.tab)?.classList.add('ativo');
    });
  });
}

// =========================================================
// Toolbar: Colaboradores
// =========================================================
function configurarToolbarColaboradores() {
  const inputBusca = document.getElementById('filtro-nome');
  inputBusca?.addEventListener('input', debounce(() => {
    estadoColaboradores.termo = inputBusca.value.toLowerCase().trim();
    estadoColaboradores.pagina = 1;
    renderizarColaboradores();
  }, 200));

  document.querySelectorAll('#filtro-status-chips .admin-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filtro-status-chips .admin-chip').forEach((c) => c.classList.remove('ativo'));
      chip.classList.add('ativo');
      estadoColaboradores.status = chip.dataset.status;
      estadoColaboradores.pagina = 1;
      renderizarColaboradores();
    });
  });

  document.getElementById('filtro-departamento')?.addEventListener('change', (e) => {
    estadoColaboradores.departamentoId = e.target.value;
    estadoColaboradores.pagina = 1;
    renderizarColaboradores();
  });

  document.querySelectorAll('#tabela-colaboradores th.ordenavel').forEach((th) => {
    th.addEventListener('click', () => {
      const campo = th.dataset.campo;
      if (estadoColaboradores.ordenarPor === campo) {
        estadoColaboradores.ordenarDir = estadoColaboradores.ordenarDir === 'asc' ? 'desc' : 'asc';
      } else {
        estadoColaboradores.ordenarPor = campo;
        estadoColaboradores.ordenarDir = 'asc';
      }
      renderizarColaboradores();
    });
  });
}

// =========================================================
// Toolbar: Logs
// =========================================================
function configurarToolbarLogs() {
  const inputBusca = document.getElementById('filtro-log-nome');
  inputBusca?.addEventListener('input', debounce(() => {
    estadoLogs.termo = inputBusca.value.toLowerCase().trim();
    estadoLogs.pagina = 1;
    renderizarLogs();
  }, 200));

  document.getElementById('filtro-log-acao')?.addEventListener('change', (e) => {
    estadoLogs.acao = e.target.value;
    estadoLogs.pagina = 1;
    renderizarLogs();
  });
  document.getElementById('filtro-log-data-inicio')?.addEventListener('change', (e) => {
    estadoLogs.dataInicio = e.target.value;
    estadoLogs.pagina = 1;
    renderizarLogs();
  });
  document.getElementById('filtro-log-data-fim')?.addEventListener('change', (e) => {
    estadoLogs.dataFim = e.target.value;
    estadoLogs.pagina = 1;
    renderizarLogs();
  });

  document.getElementById('btn-exportar-csv')?.addEventListener('click', exportarLogsCSV);
}

function debounce(fn, atraso) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), atraso);
  };
}

// =========================================================
// Paginação (genérica para colaboradores e logs)
// =========================================================
function configurarPaginacao() {
  ligarPaginacao('colaboradores', estadoColaboradores, renderizarColaboradores);
  ligarPaginacao('logs', estadoLogs, renderizarLogs);
}

function ligarPaginacao(chave, estado, renderizar) {
  document.getElementById(`tamanho-pagina-${chave}`)?.addEventListener('change', (e) => {
    estado.tamanhoPagina = Number(e.target.value);
    estado.pagina = 1;
    renderizar();
  });
  document.getElementById(`pagina-anterior-${chave}`)?.addEventListener('click', () => {
    if (estado.pagina > 1) { estado.pagina -= 1; renderizar(); }
  });
  document.getElementById(`proxima-pagina-${chave}`)?.addEventListener('click', () => {
    estado.pagina += 1;
    renderizar();
  });
}

function atualizarPaginacaoUI(chave, totalItens, estado) {
  const totalPaginas = Math.max(1, Math.ceil(totalItens / estado.tamanhoPagina));
  const inicio = totalItens === 0 ? 0 : (estado.pagina - 1) * estado.tamanhoPagina + 1;
  const fim = Math.min(estado.pagina * estado.tamanhoPagina, totalItens);

  const info = document.getElementById(`paginacao-info-${chave}`);
  if (info) info.textContent = totalItens === 0 ? 'Nenhum resultado' : `Mostrando ${inicio}–${fim} de ${totalItens}`;

  const elPagina = document.getElementById(`pagina-atual-${chave}`);
  if (elPagina) elPagina.textContent = `${estado.pagina} / ${totalPaginas}`;

  const btnAnterior = document.getElementById(`pagina-anterior-${chave}`);
  if (btnAnterior) btnAnterior.disabled = estado.pagina <= 1;

  const btnProximo = document.getElementById(`proxima-pagina-${chave}`);
  if (btnProximo) btnProximo.disabled = estado.pagina >= totalPaginas;
}

// =========================================================
// Exportação CSV (respeita os filtros aplicados)
// =========================================================
function exportarLogsCSV() {
  const logs = obterLogsFiltrados();
  if (!logs.length) {
    mostrarToast('Não há eventos para exportar com os filtros atuais.', 'alerta');
    return;
  }

  const cabecalho = ['Data/Hora', 'Colaborador', 'Ação', 'Detalhes', 'Executado por'];
  const linhas = logs.map((l) => [
    formatarData(l.criado_em),
    l.nome_no_momento,
    (MAPA_ACOES[l.acao] || {}).rotulo || l.acao,
    l.detalhes ? JSON.stringify(l.detalhes) : '',
    l.executado_por || 'Próprio usuário',
  ]);

  const csv = [cabecalho, ...linhas]
    .map((linha) => linha.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `logs_assina_ai_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  mostrarToast(`${logs.length} evento(s) exportado(s).`, 'sucesso');
}

// =========================================================
// Ações de colaborador
// =========================================================
function tratarAcaoColaborador(acao, id, dataset) {
  const colaborador = TODOS_COLABORADORES.find((c) => c.id === id);
  if (!colaborador) return;

  switch (acao) {
    case 'editar':
      abrirModalEditar(colaborador);
      break;
    case 'reset':
      abrirConfirmacao(
        'Resetar senha',
        `Deseja gerar uma nova senha temporária para ${colaborador.nome_completo}? A senha atual deixará de funcionar.`,
        async () => {
          const resultado = await chamarAcaoAdmin('resetar_senha', id);
          document.getElementById('texto-senha-gerada').textContent = resultado.senhaTemporaria;
          abrirModal('modal-senha-gerada');
          mostrarToast('Senha temporária gerada com sucesso.', 'sucesso');
        }
      );
      break;
    case 'status': {
      const ativoAtual = dataset.ativo === 'true';
      const acaoTexto = ativoAtual ? 'desativar' : 'ativar';
      abrirConfirmacao(
        `${ativoAtual ? 'Desativar' : 'Ativar'} colaborador`,
        `Deseja ${acaoTexto} o acesso de ${colaborador.nome_completo}?`,
        async () => {
          await chamarAcaoAdmin('alternar_status', id, { ativo: !ativoAtual });

          // Log explícito de status, com o antes/depois, seguindo o mesmo padrão do
          // log de edição de perfil — não depende apenas da Edge Function registrar.
          await registrarLogDetalhado({
            usuarioId: id,
            nomeNoMomento: colaborador.nome_completo,
            acao: !ativoAtual ? 'ativado' : 'desativado',
            alteracoes: { ativo: { de: ativoAtual, para: !ativoAtual } },
          });

          // Fallback defensivo: Atualiza cache local caso Realtime falhe
          colaborador.ativo = !ativoAtual;
          atualizarCards();
          renderizarColaboradores();

          mostrarToast(`${colaborador.nome_completo} foi ${ativoAtual ? 'desativado' : 'ativado'}.`, 'sucesso');
        }
      );
      break;
    }
    case 'assinatura':
      sessionStorage.setItem('admin-gerar-para', JSON.stringify(colaborador));
      window.location.href = 'gerador.html?adminGerarPara=' + id;
      break;
  }
}

// =========================================================
// Modais
// =========================================================
function configurarModais() {
  document.querySelectorAll('.admin-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) fecharModal(overlay);
    });
    overlay.querySelectorAll('[data-fechar]').forEach((btn) =>
      btn.addEventListener('click', () => fecharModal(overlay))
    );
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.admin-overlay.visivel').forEach(fecharModal);
    }
  });

  document.getElementById('form-editar-colaborador')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const nome_completo = document.getElementById('edit-nome').value.trim();
    const cargo = document.getElementById('edit-cargo').value.trim();
    const ramal = document.getElementById('edit-ramal').value.trim();
    const departamentoId = document.getElementById('edit-departamento').value || null;
    const reValorBruto = document.getElementById('edit-re').value.trim();
    const re = reValorBruto ? Number(reValorBruto) : null;
    const btnSalvar = document.getElementById('btn-salvar-edicao');

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';
    try {
      // Guarda o estado ANTES da edição — é essa comparação que faltava para o
      // log mostrar exatamente o que mudou (nome antigo → novo, cargo antigo → novo,
      // departamento antigo → novo, RE antigo → novo, etc).
      const colaboradorAntes = TODOS_COLABORADORES.find((c) => c.id === id);
      const telefoneNovo = ramal ? `(11) 2829-${ramal}` : undefined;

      const novosDados = {
        nome_completo,
        cargo,
        telefone: telefoneNovo,
        departamento_id: departamentoId,
        re,
      };

      // IMPORTANTE: a Edge Function "atualizar_perfil" precisa aceitar e persistir
      // "departamento_id" e "re" em profiles para que a gravação funcione de fato.
      await chamarAcaoAdmin('atualizar_perfil', id, novosDados);

      // Monta o diff (somente os campos que de fato mudaram de valor)
      const alteracoes = {};
      if (colaboradorAntes) {
        if ((colaboradorAntes.nome_completo || '') !== nome_completo) {
          alteracoes.nome_completo = { de: colaboradorAntes.nome_completo || null, para: nome_completo };
        }
        if ((colaboradorAntes.cargo || '') !== cargo) {
          alteracoes.cargo = { de: colaboradorAntes.cargo || null, para: cargo };
        }
        if (telefoneNovo !== undefined && (colaboradorAntes.telefone || '') !== telefoneNovo) {
          alteracoes.telefone = { de: colaboradorAntes.telefone || null, para: telefoneNovo };
        }
        if ((colaboradorAntes.departamento_id || null) !== (departamentoId || null)) {
          alteracoes.departamento_id = {
            de: nomeDepartamento(colaboradorAntes.departamento_id) || 'Sem departamento',
            para: nomeDepartamento(departamentoId) || 'Sem departamento',
          };
        }
        const reAntes = colaboradorAntes.re ?? null;
        if (reAntes !== re) {
          alteracoes.re = { de: reAntes ?? '—', para: re ?? '—' };
        }
      }

      // Log explícito e detalhado, gravado diretamente pelo front-end — garante que
      // nome, cargo, departamento e RE sempre apareçam no log, independentemente do
      // que a Edge Function "atualizar_perfil" registra (ou deixa de registrar) por conta própria.
      await registrarLogDetalhado({
        usuarioId: id,
        nomeNoMomento: nome_completo,
        acao: 'atualizacao_perfil',
        alteracoes,
      });

      // Fallback defensivo: Atualiza cache local caso Realtime falhe
      if (colaboradorAntes) {
        Object.assign(colaboradorAntes, novosDados);
        colaboradorAntes.departamento_nome = nomeDepartamento(colaboradorAntes.departamento_id);
        renderizarColaboradores();
      }

      fecharModal(document.getElementById('modal-editar'));
      mostrarToast('Colaborador atualizado com sucesso.', 'sucesso');
    } catch (err) {
      mostrarToast('Erro ao salvar: ' + err.message, 'erro');
    } finally {
      btnSalvar.disabled = false;
      btnSalvar.textContent = 'Salvar alterações';
    }
  });

  document.getElementById('btn-copiar-senha')?.addEventListener('click', async () => {
    const senha = document.getElementById('texto-senha-gerada').textContent;
    try {
      await navigator.clipboard.writeText(senha);
      mostrarToast('Senha copiada para a área de transferência.', 'sucesso');
    } catch {
      mostrarToast('Não foi possível copiar automaticamente.', 'alerta');
    }
  });
}

// =========================================================
// Log detalhado — gravação direta em activity_logs
// =========================================================
// Centraliza a criação de eventos de log a partir do painel admin, sempre com um
// diff explícito (de/para) quando houver alterações. Insere direto na tabela e
// injeta o registro na timeline na hora (aplicarNovoLog), sem esperar o Realtime.
// Se não houver nenhum campo alterado, ainda assim registra o evento (com uma
// observação), para não mascarar ações que não resultaram em mudança real.
async function registrarLogDetalhado({ usuarioId, nomeNoMomento, acao, alteracoes }) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const executadoPor = session?.user?.id || ADMIN_ATUAL?.user?.id || null;

    const temAlteracoes = alteracoes && Object.keys(alteracoes).length > 0;
    const detalhes = temAlteracoes
      ? { campos_alterados: alteracoes }
      : { observacao: 'Ação executada sem alteração de valores.' };

    const { data: logInserido, error } = await supabaseClient
      .from('activity_logs')
      .insert({
        usuario_id: usuarioId,
        nome_no_momento: nomeNoMomento,
        acao,
        detalhes,
        executado_por: executadoPor,
      })
      .select()
      .single();

    if (error) throw error;

    if (logInserido) {
      aplicarNovoLog(logInserido);
    }
  } catch (erroLog) {
    // Não interrompe o fluxo principal (a ação em si já foi concluída) — apenas
    // avisa no console e via toast, para não deixar o problema passar despercebido.
    console.error('Erro ao registrar log detalhado:', erroLog);
    mostrarToast('A ação foi concluída, mas houve falha ao registrar o log.', 'alerta');
  }
}

// Corrigido typo interno ("mensaje" -> "mensagem")
function mostrarToast(mensagem, tipo = 'neutro') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visivel'));
  setTimeout(() => {
    toast.classList.remove('visivel');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function abrirModal(id) {
  document.getElementById(id)?.classList.add('visivel');
}

function fecharModal(overlay) {
  if (overlay) overlay.classList.remove('visivel');
}

function abrirModalEditar(colaborador) {
  document.getElementById('edit-id').value = colaborador.id;
  document.getElementById('edit-nome').value = colaborador.nome_completo || '';
  document.getElementById('edit-departamento').value = colaborador.departamento_id || '';
  document.getElementById('edit-re').value = colaborador.re ?? '';
  document.getElementById('edit-cargo').value = colaborador.cargo || '';
  document.getElementById('edit-ramal').value = (colaborador.telefone || '').replace(/\D/g, '').slice(-4);
  abrirModal('modal-editar');
}

let acaoConfirmadaCallback = null;

function abrirConfirmacao(titulo, texto, aoConfirmar) {
  document.getElementById('confirmar-titulo').textContent = titulo;
  document.getElementById('confirmar-texto').textContent = texto;
  acaoConfirmadaCallback = aoConfirmar;
  abrirModal('modal-confirmar');
}

document.getElementById('btn-confirmar-acao')?.addEventListener('click', async () => {
  if (acaoConfirmadaCallback) {
    const btn = document.getElementById('btn-confirmar-acao');
    btn.disabled = true;
    btn.textContent = 'Processando…';
    try {
      await acaoConfirmadaCallback();
    } catch (err) {
      mostrarToast('Erro: ' + err.message, 'erro');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar';
      fecharModal(document.getElementById('modal-confirmar'));
      acaoConfirmadaCallback = null;
    }
  }
});

// =========================================================
// Tempo real (Supabase Realtime)
// =========================================================
function configurarRealtime() {
  CANAL_REALTIME = supabaseClient
    .channel('admin-painel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
      aplicarMudancaColaborador(payload);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, (payload) => {
      aplicarNovoLog(payload.new);
    })
    .subscribe((status) => atualizarStatusConexao(status));
}

function aplicarMudancaColaborador(payload) {
  if (payload.eventType === 'INSERT') {
    if (!TODOS_COLABORADORES.some((c) => c.id === payload.new.id)) {
      TODOS_COLABORADORES.push(enriquecerColaborador(payload.new));
      mostrarToast(`Novo colaborador: ${payload.new.nome_completo}`, 'sucesso');
    }
  } else if (payload.eventType === 'UPDATE') {
    const idx = TODOS_COLABORADORES.findIndex((c) => c.id === payload.new.id);
    if (idx !== -1) {
      TODOS_COLABORADORES[idx] = enriquecerColaborador(payload.new);
    }
  } else if (payload.eventType === 'DELETE') {
    TODOS_COLABORADORES = TODOS_COLABORADORES.filter((c) => c.id !== payload.old.id);
  }
  atualizarCards();
  renderizarColaboradores();
}

function aplicarNovoLog(novoLog) {
  if (TODOS_LOGS.some((l) => l.id === novoLog.id)) return;
  TODOS_LOGS.unshift(novoLog);
  atualizarCards();
  renderizarLogs();
  piscarIndicadorAoVivo();
}

function piscarIndicadorAoVivo() {
  const indicador = document.getElementById('live-indicator');
  if (indicador) {
    indicador.classList.add('pulso');
    setTimeout(() => indicador.classList.remove('pulso'), 900);
  }
}

function atualizarStatusConexao(status) {
  const badge = document.getElementById('conexao-status');
  const texto = document.getElementById('conexao-texto');
  if (!badge || !texto) return;

  if (status === 'SUBSCRIBED') {
    badge.dataset.estado = 'conectado';
    texto.textContent = 'Tempo real ativo';
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    badge.dataset.estado = 'erro';
    texto.textContent = 'Reconectando…';
  } else if (status === 'CLOSED') {
    badge.dataset.estado = 'erro';
    texto.textContent = 'Desconectado';
  } else {
    badge.dataset.estado = 'conectando';
    texto.textContent = 'Conectando…';
  }
}

window.addEventListener('beforeunload', () => {
  if (CANAL_REALTIME) supabaseClient.removeChannel(CANAL_REALTIME);
});

// =========================================================
// Tema (mesmo padrão do gerador.html)
// =========================================================
function configurarTema() {
  const root = document.documentElement;
  const btn = document.getElementById('btn-tema');
  const label = document.getElementById('theme-toggle-label');
  if (!btn || !label) return;

  function temaAtual() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function atualizarLabel() {
    label.textContent = temaAtual() === 'light' ? 'Claro' : 'Escuro';
  }

  btn.addEventListener('click', () => {
    const novo = temaAtual() === 'light' ? 'dark' : 'light';
    if (novo === 'dark') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', 'light');
    try { localStorage.setItem('hemc-tema', novo); } catch (e) {}
    atualizarLabel();
  });

  atualizarLabel();
}