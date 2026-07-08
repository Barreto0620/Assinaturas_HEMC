import { supabaseClient, exigirSessaoAdmin, chamarAcaoAdmin, fazerLogout } from './supabaseClient.js';

// =========================================================
// Estado
// =========================================================
let TODOS_COLABORADORES = [];
let TODOS_LOGS = [];
let ADMIN_ATUAL = null;
let CANAL_REALTIME = null;

// Lista de setores distintos, derivada diretamente dos colaboradores
// carregados (o setor agora é um campo de texto direto em "profiles",
// preenchido a partir da planilha de RH — não existe mais uma tabela
// separada de departamentos para resolver por id).
let SETORES = [];

const estadoColaboradores = {
  status: 'todos',
  setor: 'todos',
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
  somenteUltimas24h: false,
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
  setor: 'Setor',
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
  configurarCardsFiltro();
  injetarEstilosTimelineLogs();
  configurarToolbarColaboradores();
  configurarToolbarLogs();
  configurarPaginacao();
  configurarModais();
  configurarTema();

  await carregarTudo();
  configurarRealtime();
})();

document.getElementById('btn-logout')?.addEventListener('click', fazerLogout);
document.getElementById('erro-banner-retry')?.addEventListener('click', carregarTudo);

// =========================================================
// Setores (derivados dos colaboradores carregados)
// =========================================================
function recalcularSetores() {
  const unicos = new Set();
  TODOS_COLABORADORES.forEach((c) => {
    if (c.setor) unicos.add(c.setor);
  });
  SETORES = Array.from(unicos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  popularFiltroSetores();
  popularDatalistSetores();
}

function popularFiltroSetores() {
  const select = document.getElementById('filtro-setor');
  if (!select) return;
  const valorAtual = select.value || 'todos';
  select.querySelectorAll('option:not([value="todos"])').forEach((op) => op.remove());
  SETORES.forEach((setor) => {
    const opt = document.createElement('option');
    opt.value = setor;
    opt.textContent = setor;
    select.appendChild(opt);
  });
  // Preserva a seleção do usuário caso o setor ainda exista na lista atualizada
  if (SETORES.includes(valorAtual) || valorAtual === 'todos') {
    select.value = valorAtual;
  }
}

function popularDatalistSetores() {
  const datalist = document.getElementById('lista-setores');
  if (!datalist) return;
  datalist.innerHTML = SETORES.map((setor) => `<option value="${escapeHtml(setor)}"></option>`).join('');
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
    recalcularSetores();
    atualizarCards();
    renderizarColaboradores();
    renderizarLogs();
  } catch (erro) {
    console.error('Erro ao carregar painel:', erro);
    mostrarErro('Não foi possível carregar os dados do painel. Verifique as permissões de acesso ou sua conexão.');
  }
}

async function buscarColaboradores() {
  // Busca através da Edge Function ("listar_colaboradores"), que cruza o
  // Supabase Auth (fonte de verdade de quem já tem e-mail cadastrado) com a
  // tabela "profiles" (dados preenchidos no 1º acesso, incluindo o setor).
  // Isso garante que TODO e-mail já criado no Auth apareça na lista —
  // inclusive quem ainda nunca fez login — e não só quem já tem perfil.
  const resposta = await chamarAcaoAdmin('listar_colaboradores', null, { pagina: 1, limite: 5000 });
  return resposta?.colaboradores || [];
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
  const ativos = TODOS_COLABORADORES.filter((c) => calcularStatus(c) === 'ativo').length;
  const pendentes = TODOS_COLABORADORES.filter((c) => calcularStatus(c) === 'pendente').length;
  const inativos = TODOS_COLABORADORES.filter((c) => calcularStatus(c) === 'inativo').length;

  const ha24h = Date.now() - 24 * 60 * 60 * 1000;
  const atividade24h = TODOS_LOGS.filter((l) => new Date(l.criado_em).getTime() >= ha24h).length;

  setValorCard('card-total', total);
  setValorCard('card-ativos', ativos);
  setValorCard('card-inativos', inativos);
  setValorCard('card-atividade-24h', atividade24h);

  const cardPendentes = document.getElementById('card-nunca-acessaram');
  if (cardPendentes) {
    cardPendentes.textContent = pendentes;
    cardPendentes.classList.remove('skeleton-valor');
  }
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
// Status unificado do colaborador
// =========================================================
// Três estados, sem ambiguidade:
// - "inativo": conta desabilitada pelo admin (prevalece sobre tudo)
// - "pendente": habilitada, mas nunca fez login (aguardando 1º acesso)
// - "ativo": habilitada e já fez pelo menos um login
function calcularStatus(c) {
  if (!c.ativo) return 'inativo';
  if (!c.ultimo_login) return 'pendente';
  return 'ativo';
}

const META_STATUS = {
  ativo: { rotulo: 'Ativo', classe: 'admin-badge-ativo' },
  pendente: { rotulo: 'Pendente', classe: 'admin-badge-pendente' },
  inativo: { rotulo: 'Inativo', classe: 'admin-badge-inativo' },
};

function renderizarBadgeStatus(c) {
  const meta = META_STATUS[calcularStatus(c)];
  return `<span class="admin-badge ${meta.classe}"><i></i>${meta.rotulo}</span>`;
}

// =========================================================
// Colaboradores: filtro + ordenação + paginação
// =========================================================
function obterColaboradoresFiltrados() {
  const termo = estadoColaboradores.termo;
  const status = estadoColaboradores.status;
  const setor = estadoColaboradores.setor;

  let lista = TODOS_COLABORADORES.filter((c) => {
    const bateTermo = !termo ||
      c.nome_completo?.toLowerCase().includes(termo) ||
      c.email?.toLowerCase().includes(termo) ||
      String(c.re ?? '').includes(termo);
    const bateStatus =
      status === 'todos' ||
      status === calcularStatus(c);
    const bateSetor =
      setor === 'todos' || c.setor === setor;
    return bateTermo && bateStatus && bateSetor;
  });

  const { ordenarPor, ordenarDir } = estadoColaboradores;
  lista = lista.slice().sort((a, b) => {
    let va = a[ordenarPor];
    let vb = b[ordenarPor];

    // Tratamento robusto para valores nulos ou indefinidos
    if (va === null || va === undefined) va = '';
    if (vb === null || vb === undefined) vb = '';

    if (ordenarPor === 'ativo') {
      const ordem = { inativo: 0, pendente: 1, ativo: 2 };
      va = ordem[calcularStatus(a)];
      vb = ordem[calcularStatus(b)];
    }
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
    corpo.innerHTML = `<tr><td colspan="8" class="admin-tabela-vazia">
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
            <span>${c.nome_completo ? escapeHtml(c.nome_completo) : '<span class="admin-cel-muted">Aguardando 1º acesso</span>'}</span>
          </div>
        </td>
        <td class="admin-cel-muted admin-cel-mono">${c.email ? escapeHtml(c.email) : '—'}</td>
        <td>${c.setor ? escapeHtml(c.setor) : '<span class="admin-cel-muted">Não definido</span>'}</td>
        <td class="admin-cel-mono">${c.re ?? '<span class="admin-cel-muted">—</span>'}</td>
        <td>${escapeHtml(c.cargo || '—')}</td>
        <td>${renderizarBadgeStatus(c)}</td>
        <td class="admin-cel-mono">${c.ultimo_login ? formatarData(c.ultimo_login) : '<span class="admin-cel-muted">Nunca acessou</span>'}</td>
        <td class="admin-tabela-acoes">
          <button class="admin-icon-btn" data-acao="editar" data-id="${c.id}" title="Editar" aria-label="Editar ${escapeHtml(c.nome_completo || c.email || '')}">✎</button>
          <button class="admin-icon-btn" data-acao="reset" data-id="${c.id}" title="Resetar senha" aria-label="Resetar senha de ${escapeHtml(c.nome_completo || c.email || '')}">⟳</button>
          <button class="admin-icon-btn" data-acao="assinatura" data-id="${c.id}" title="Gerar assinatura" aria-label="Gerar assinatura para ${escapeHtml(c.nome_completo || c.email || '')}">✒</button>
          <button class="admin-icon-btn ${c.ativo ? 'admin-icon-btn-perigo' : 'admin-icon-btn-sucesso'}" data-acao="status" data-id="${c.id}" data-ativo="${c.ativo}" title="${c.ativo ? 'Desativar' : 'Ativar'}" aria-label="${c.ativo ? 'Desativar' : 'Ativar'} ${escapeHtml(c.nome_completo || c.email || '')}">
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
  const { termo, acao, dataInicio, dataFim, somenteUltimas24h } = estadoLogs;
  return TODOS_LOGS.filter((l) => {
    const bateTermo = !termo || l.nome_no_momento?.toLowerCase().includes(termo);
    const bateAcao = acao === 'todas' || l.acao === acao;
    const dataLog = new Date(l.criado_em);

    if (somenteUltimas24h) {
      const ha24h = Date.now() - 24 * 60 * 60 * 1000;
      return bateTermo && bateAcao && dataLog.getTime() >= ha24h;
    }

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

  // Mapas auxiliares para enriquecer cada evento com nome e setor de quem
  // sofreu a ação (usuario_id) e de quem a executou (executado_por), sem
  // precisar de nenhuma consulta adicional — os dados já estão carregados
  // em TODOS_COLABORADORES.
  const nomesPorId = Object.fromEntries(TODOS_COLABORADORES.map((c) => [c.id, c.nome_completo]));
  const setoresPorId = Object.fromEntries(TODOS_COLABORADORES.map((c) => [c.id, c.setor]));

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
    const setorAlvo = setoresPorId[l.usuario_id] || null;
    const setorExecutor = l.executado_por ? (setoresPorId[l.executado_por] || null) : null;
    const temDetalhes = l.detalhes && Object.keys(l.detalhes).length > 0;
    const resumo = resumoDetalhesLog(l);

    html += `
      <div class="admin-timeline-item">
        <span class="admin-timeline-icone tom-${meta.tom}">${meta.icone}</span>
        <div class="admin-timeline-corpo">
          <div class="admin-timeline-linha1">
            <span class="admin-timeline-nome">${escapeHtml(l.nome_no_momento)}</span>
            <span class="admin-badge admin-badge-acao tom-${meta.tom}">${meta.rotulo}</span>
            ${setorAlvo ? `<span class="admin-badge admin-badge-setor" title="Setor do colaborador afetado">${escapeHtml(setorAlvo)}</span>` : ''}
          </div>
          <div class="admin-timeline-linha2">
            <span class="admin-cel-mono">${formatarHora(l.criado_em)}</span>
            <span class="admin-timeline-ponto">·</span>
            <span>por ${escapeHtml(executor)}${setorExecutor ? ` <span class="admin-timeline-setor-executor">(${escapeHtml(setorExecutor)})</span>` : ''}</span>
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
function resumoDetalhesLog(log) {
  const detalhes = log?.detalhes;
  if (!detalhes || typeof detalhes !== 'object') return '';

  const blocos = [];

  if (log.acao === 'login') {
    const pares = [];
    if (detalhes.nome_completo) pares.push({ rotulo: 'Nome', valor: detalhes.nome_completo });
    if (detalhes.cargo) pares.push({ rotulo: 'Cargo', valor: detalhes.cargo });
    if (detalhes.setor) pares.push({ rotulo: 'Setor', valor: detalhes.setor });
    if (detalhes.re) pares.push({ rotulo: 'RE', valor: detalhes.re, mono: true });
    if (detalhes.ramal) pares.push({ rotulo: 'Ramal', valor: detalhes.ramal, mono: true });
    if (pares.length) blocos.push(construirChipsInfo(pares));
  }

  if (log.acao === 'cadastro') {
    const pares = [];
    if (detalhes.nome_completo) pares.push({ rotulo: 'Nome', valor: detalhes.nome_completo });
    if (detalhes.cargo) pares.push({ rotulo: 'Cargo', valor: detalhes.cargo });
    if (detalhes.setor) pares.push({ rotulo: 'Setor', valor: detalhes.setor });
    if (detalhes.re) pares.push({ rotulo: 'RE', valor: detalhes.re, mono: true });
    if (detalhes.email) pares.push({ rotulo: 'E-mail', valor: detalhes.email, mono: true });
    if (pares.length) blocos.push(construirChipsInfo(pares));
  }

  const blocoDiff = construirBlocoDiff(detalhes.campos_alterados);
  if (blocoDiff) blocos.push(blocoDiff);

  if (!blocos.length && detalhes.observacao) {
    blocos.push(`<span class="admin-log-observacao">${escapeHtml(detalhes.observacao)}</span>`);
  }

  return blocos.join('');
}

function construirChipsInfo(pares) {
  const chips = pares.map(({ rotulo, valor, mono }) => `
    <span class="admin-log-chip">
      <span class="admin-log-chip-rotulo">${escapeHtml(rotulo)}</span>
      <span class="admin-log-chip-valor${mono ? ' admin-log-chip-mono' : ''}">${escapeHtml(String(valor))}</span>
    </span>`).join('');
  return `<div class="admin-log-chips">${chips}</div>`;
}

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
// Estilos da timeline de logs (chips + bloco de diff) + badge "nunca acessou"
// + badge de setor (colaborador afetado / executor) + modal de cadastro
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

    .admin-badge-nunca-acessou {
      background: rgba(255, 99, 99, 0.12);
      color: #ff6b6b;
      border: 1px solid rgba(255, 99, 99, 0.28);
    }

    /* Badge de Setor na timeline — identifica de forma discreta e elegante
       a qual setor pertence o colaborador afetado pelo evento. Tom azul-
       violeta para se diferenciar dos badges de ação (verde/vermelho/âmbar). */
    .admin-badge-setor {
      background: rgba(129, 140, 248, 0.12);
      color: #9099f5;
      border: 1px solid rgba(129, 140, 248, 0.3);
      font-weight: 600;
      text-transform: none;
      letter-spacing: 0;
    }

    /* Setor do executor da ação — texto discreto entre parênteses, ao
       lado do nome de quem executou, sem competir visualmente com o
       badge principal do colaborador afetado. */
    .admin-timeline-setor-executor {
      opacity: 0.65;
      font-size: 11.5px;
    }

    [data-theme="light"] .admin-log-chip {
      background: rgba(39, 68, 127, 0.06);
      border-color: rgba(39, 68, 127, 0.16);
    }

    [data-theme="light"] .admin-log-diff-bloco {
      background: rgba(214, 154, 31, 0.14);
    }

    [data-theme="light"] .admin-badge-nunca-acessou {
      background: rgba(220, 38, 38, 0.08);
      color: #dc2626;
      border-color: rgba(220, 38, 38, 0.22);
    }

    [data-theme="light"] .admin-badge-setor {
      background: rgba(79, 70, 229, 0.08);
      color: #4f46e5;
      border-color: rgba(79, 70, 229, 0.22);
    }

    /* Correção da linha divisória horizontal entre as linhas da tabela:
       força a borda a existir de forma consistente em TODAS as células
       (inclusive a coluna de Ações), com a mesma largura/cor, evitando o
       efeito de "degrau" onde a borda parece parar antes dos ícones. */
    #tabela-colaboradores {
      width: 100%;
      border-collapse: collapse;
    }
    #tabela-colaboradores tbody tr td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      box-sizing: border-box;
    }
    [data-theme="light"] #tabela-colaboradores tbody tr td {
      border-bottom-color: rgba(0, 0, 0, 0.07);
    }
    .admin-tabela-wrap {
      overflow-x: auto;
    }

    /* Correção de alinhamento da coluna de Ações: os botões ficam num grupo
       flex com espaçamento fixo, ancorados à direita da célula — elimina o
       desalinhamento entre a linha divisória da coluna e os ícones. */
    .admin-tabela-acoes {
      display: flex !important;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      white-space: nowrap;
    }
    .admin-tabela-acoes .admin-icon-btn {
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    th.admin-th-acoes {
      text-align: right;
    }

    /* Lista de e-mails pendentes */
    .admin-pendentes-toolbar {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .admin-pendentes-lista {
      max-height: 420px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .admin-pendente-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
    }
    .admin-pendente-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .admin-pendente-email {
      font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .admin-pendente-nome {
      font-size: 12px;
      opacity: 0.75;
    }
    .admin-pendente-data {
      font-size: 11.5px;
      opacity: 0.55;
      white-space: nowrap;
      flex-shrink: 0;
    }
    [data-theme="light"] .admin-pendente-item {
      border-color: rgba(0, 0, 0, 0.08);
      background: rgba(0, 0, 0, 0.02);
    }

    /* Campo de definição de senha nos modais de reset/cadastro — input +
       botão de sugestão lado a lado, com texto de ajuda discreto abaixo. */
    .admin-senha-input-wrap {
      display: flex;
      gap: 8px;
    }
    .admin-senha-input-wrap input {
      flex: 1;
    }
    .admin-senha-input-wrap .btn-copiar {
      flex-shrink: 0;
      padding: 0 14px;
    }
    .admin-campo-ajuda {
      display: block;
      margin-top: 6px;
      font-size: 11.5px;
      color: var(--assina-text-muted);
    }
    .admin-campo-opcional {
      font-weight: 400;
      opacity: 0.6;
      text-transform: none;
      letter-spacing: 0;
    }

    /* =========================================================
       Modal de Cadastro de Colaborador — alternador de modo
       ========================================================= */
    .admin-campo-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    @media (max-width: 520px) {
      .admin-campo-grid-2 {
        grid-template-columns: 1fr;
      }
    }

    .admin-modo-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }
    .admin-modo-opcao {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      text-align: left;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1.5px solid var(--assina-border);
      background: var(--assina-bg-1);
      cursor: pointer;
      transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
    }
    .admin-modo-opcao:hover {
      transform: translateY(-1px);
    }
    .admin-modo-titulo {
      font-size: 13px;
      font-weight: 700;
      color: var(--assina-text);
    }
    .admin-modo-desc {
      font-size: 11px;
      line-height: 1.4;
      color: var(--assina-text-muted);
    }

    .admin-modo-azul.ativo {
      border-color: var(--assina-blue-500);
      background: rgba(79, 109, 245, 0.10);
      box-shadow: 0 0 0 1px var(--assina-blue-500) inset;
    }
    .admin-modo-azul.ativo .admin-modo-titulo {
      color: var(--assina-blue-400);
    }

    .admin-modo-vermelho.ativo {
      border-color: var(--assina-erro-border);
      background: var(--assina-erro-bg);
      box-shadow: 0 0 0 1px var(--assina-erro) inset;
    }
    .admin-modo-vermelho.ativo .admin-modo-titulo {
      color: var(--assina-erro);
    }

    .admin-campos-condicionais {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-top: 4px;
      border-top: 1px dashed var(--assina-border);
      margin-top: 4px;
    }
    .admin-campos-condicionais[hidden] {
      display: none;
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
// Função central de troca de aba, reaproveitada tanto pelos cliques diretos
// nas abas quanto pela navegação programática (ex.: cards de filtro), para
// que o comportamento seja sempre idêntico e consistente em todo o painel.
function ativarAba(tabId) {
  document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('ativo'));
  document.querySelectorAll('.admin-tab-content').forEach((c) => c.classList.remove('ativo'));
  document.querySelector(`.admin-tab[data-tab="${tabId}"]`)?.classList.add('ativo');
  document.getElementById(tabId)?.classList.add('ativo');
}

function configurarTabs() {
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => ativarAba(tab.dataset.tab));
  });
}

// =========================================================
// Cards como filtro (substituem os antigos chips de status)
// =========================================================
// Os 4 primeiros cards (Total/Ativos/Inativos/Pendentes) funcionam como um
// grupo de seleção única — clicar aplica o filtro na tabela de Colaboradores
// e destaca visualmente o card ativo. O card de "Ações nas últimas 24h" tem
// outro papel: leva direto para a aba Atividades já filtrada nesse período.
//
// Correção: como "Ações nas últimas 24h" muda a aba ativa para "Atividades",
// a aba "Colaboradores" fica oculta (display: none). Se depois disso o
// usuário clicasse em outro card de status, o filtro era aplicado por baixo
// dos panos, mas nada aparecia na tela — dando a impressão de que os cards
// "travaram". Por isso, selecionar qualquer card de status agora também
// garante o retorno à aba Colaboradores.
function configurarCardsFiltro() {
  const cardsDeStatus = [
    { id: 'card-filtro-total', status: 'todos' },
    { id: 'card-filtro-ativo', status: 'ativo' },
    { id: 'card-filtro-inativo', status: 'inativo' },
    { id: 'card-filtro-pendente', status: 'pendente' },
  ];

  cardsDeStatus.forEach(({ id, status }) => {
    const card = document.getElementById(id);
    if (!card) return;
    card.addEventListener('click', () => selecionarCardStatus(status));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selecionarCardStatus(status);
      }
    });
  });

  const cardAtividades = document.getElementById('card-ir-atividades-24h');
  cardAtividades?.addEventListener('click', irParaAtividades24h);
  cardAtividades?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      irParaAtividades24h();
    }
  });
}

// Remove a marcação visual de "selecionado" de TODOS os cards (os 4 de
// status + o de Ações nas últimas 24h), já que só um card por vez deve
// aparecer como ativo — os dois grupos são mutuamente exclusivos.
function limparSelecaoCards() {
  document.querySelectorAll('.admin-card-clicavel').forEach((card) => {
    card.classList.remove('admin-card-selecionado');
  });
}

function selecionarCardStatus(status) {
  estadoColaboradores.status = status;
  estadoColaboradores.pagina = 1;

  limparSelecaoCards();
  document.querySelectorAll('.admin-card-clicavel[data-status]').forEach((card) => {
    card.classList.toggle('admin-card-selecionado', card.dataset.status === status);
  });

  // Garante que a aba Colaboradores esteja visível para que o filtro
  // aplicado seja imediatamente perceptível ao usuário.
  ativarAba('tab-colaboradores');

  renderizarColaboradores();
}

function irParaAtividades24h() {
  ativarAba('tab-logs');

  limparSelecaoCards();
  document.getElementById('card-ir-atividades-24h')?.classList.add('admin-card-selecionado');

  // Filtro exato das últimas 24h (janela contínua, não por dia de calendário).
  // Limpa os campos de data manual, já que os dois filtros são mutuamente exclusivos.
  estadoLogs.somenteUltimas24h = true;
  estadoLogs.dataInicio = '';
  estadoLogs.dataFim = '';
  estadoLogs.pagina = 1;

  const inputInicio = document.getElementById('filtro-log-data-inicio');
  const inputFim = document.getElementById('filtro-log-data-fim');
  if (inputInicio) inputInicio.value = '';
  if (inputFim) inputFim.value = '';

  renderizarLogs();
}

// Se o usuário mudar manualmente qualquer filtro da aba Atividades (ação ou
// datas), o recorte "últimas 24h" deixa de valer — o card correspondente
// deve perder a seleção para não ficar destacado incorretamente.
function desmarcarCard24hSeAtivo() {
  if (!estadoLogs.somenteUltimas24h) return;
  estadoLogs.somenteUltimas24h = false;
  document.getElementById('card-ir-atividades-24h')?.classList.remove('admin-card-selecionado');
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

  document.getElementById('filtro-setor')?.addEventListener('change', (e) => {
    estadoColaboradores.setor = e.target.value;
    estadoColaboradores.pagina = 1;
    renderizarColaboradores();
  });

  document.getElementById('btn-emails-pendentes')?.addEventListener('click', abrirModalEmailsPendentes);

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
    desmarcarCard24hSeAtivo();
    estadoLogs.pagina = 1;
    renderizarLogs();
  });
  document.getElementById('filtro-log-data-fim')?.addEventListener('change', (e) => {
    estadoLogs.dataFim = e.target.value;
    desmarcarCard24hSeAtivo();
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
      abrirModalDefinirSenha(colaborador);
      break;
    case 'status': {
      const ativoAtual = dataset.ativo === 'true';
      const acaoTexto = ativoAtual ? 'desativar' : 'ativar';
      abrirConfirmacao(
        `${ativoAtual ? 'Desativar' : 'Ativar'} colaborador`,
        `Deseja ${acaoTexto} o acesso de ${colaborador.nome_completo || colaborador.email}?`,
        async () => {
          await chamarAcaoAdmin('alternar_status', id, { ativo: !ativoAtual });

          await registrarLogDetalhado({
            usuarioId: id,
            nomeNoMomento: colaborador.nome_completo || colaborador.email,
            acao: !ativoAtual ? 'ativado' : 'desativado',
            alteracoes: { ativo: { de: ativoAtual, para: !ativoAtual } },
          });

          // Fallback defensivo: Atualiza cache local caso Realtime falhe
          colaborador.ativo = !ativoAtual;
          atualizarCards();
          renderizarColaboradores();

          mostrarToast(`${colaborador.nome_completo || colaborador.email} foi ${ativoAtual ? 'desativado' : 'ativado'}.`, 'sucesso');
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
// Redefinição de senha — o admin define a senha manualmente (não é mais
// gerada aleatoriamente por padrão), para poder informar ao colaborador
// uma senha de sua escolha. O botão "Gerar" continua disponível como
// atalho opcional, caso o admin prefira uma sugestão aleatória.
// =========================================================
function gerarSugestaoSenha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let senha = '';
  for (let i = 0; i < 10; i++) senha += chars[Math.floor(Math.random() * chars.length)];
  return senha;
}

function abrirModalDefinirSenha(colaborador) {
  document.getElementById('definir-senha-id').value = colaborador.id;
  document.getElementById('definir-senha-valor').value = '';
  document.getElementById('definir-senha-texto').textContent =
    `Defina a nova senha para ${colaborador.nome_completo || colaborador.email}. A senha atual dele deixará de funcionar.`;
  document.getElementById('msg-erro-definir-senha').classList.remove('visivel');
  abrirModal('modal-definir-senha');
}

function configurarModalDefinirSenha() {
  document.getElementById('btn-gerar-senha-sugestao')?.addEventListener('click', () => {
    document.getElementById('definir-senha-valor').value = gerarSugestaoSenha();
  });

  document.getElementById('form-definir-senha')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('definir-senha-id').value;
    const novaSenha = document.getElementById('definir-senha-valor').value;
    const msgErro = document.getElementById('msg-erro-definir-senha');
    const btnConfirmar = document.getElementById('btn-confirmar-definir-senha');

    msgErro.classList.remove('visivel');

    if (!novaSenha || novaSenha.length < 6) {
      msgErro.textContent = 'A senha deve ter no mínimo 6 caracteres.';
      msgErro.classList.add('visivel');
      return;
    }

    const colaborador = TODOS_COLABORADORES.find((c) => c.id === id);

    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Salvando…';
    try {
      const resultado = await chamarAcaoAdmin('resetar_senha', id, { novaSenha });

      fecharModal(document.getElementById('modal-definir-senha'));
      abrirModalSenhaGerada(
        resultado.senhaTemporaria || novaSenha,
        `Informe esta senha a ${colaborador?.nome_completo || colaborador?.email || 'o colaborador'}. Ele deverá trocá-la no próximo acesso.`
      );
      mostrarToast(`Senha redefinida para ${colaborador?.nome_completo || colaborador?.email || 'o colaborador'}.`, 'sucesso');
    } catch (err) {
      msgErro.textContent = 'Erro ao redefinir: ' + err.message;
      msgErro.classList.add('visivel');
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar redefinição';
    }
  });
}

// Modal de revelação de senha — reaproveitado tanto pelo reset de senha
// quanto pelo cadastro em "Acesso Completo", com um texto de introdução
// customizável para cada contexto.
function abrirModalSenhaGerada(senha, textoIntro) {
  const elTexto = document.getElementById('senha-gerada-texto');
  if (elTexto) {
    elTexto.textContent = textoIntro || 'Informe esta senha ao colaborador. Ele deverá trocá-la no próximo acesso.';
  }
  document.getElementById('texto-senha-gerada').textContent = senha;
  abrirModal('modal-senha-gerada');
}

// =========================================================
// Cadastro de colaborador — dois modos:
//  "referencia": só grava em colaboradores_referencia (RE/cargo/setor).
//  "completo":   também cria e-mail + senha inicial no Supabase Auth.
// =========================================================
function abrirModalCadastro() {
  document.getElementById('form-cadastrar-colaborador')?.reset();
  document.getElementById('msg-erro-cadastro')?.classList.remove('visivel');
  alternarModoCadastro('referencia');
  abrirModal('modal-cadastrar-colaborador');
}

function alternarModoCadastro(modo) {
  document.getElementById('cadastro-modo').value = modo;

  const btnReferencia = document.getElementById('btn-modo-referencia');
  const btnCompleto = document.getElementById('btn-modo-completo');
  btnReferencia?.classList.toggle('ativo', modo === 'referencia');
  btnReferencia?.setAttribute('aria-selected', String(modo === 'referencia'));
  btnCompleto?.classList.toggle('ativo', modo === 'completo');
  btnCompleto?.setAttribute('aria-selected', String(modo === 'completo'));

  const camposAcesso = document.getElementById('cadastro-campos-acesso');
  const inputEmail = document.getElementById('cadastro-email');
  const inputSenha = document.getElementById('cadastro-senha');
  const btnConfirmar = document.getElementById('btn-confirmar-cadastro');

  if (modo === 'completo') {
    camposAcesso.hidden = false;
    inputEmail?.setAttribute('required', 'required');
    inputSenha?.setAttribute('required', 'required');
    if (btnConfirmar) btnConfirmar.textContent = 'Cadastrar e criar acesso';
  } else {
    camposAcesso.hidden = true;
    inputEmail?.removeAttribute('required');
    inputSenha?.removeAttribute('required');
    if (btnConfirmar) btnConfirmar.textContent = 'Cadastrar na base de referência';
  }
}

function configurarModalCadastro() {
  document.getElementById('btn-cadastrar-colaborador')?.addEventListener('click', abrirModalCadastro);

  document.getElementById('btn-modo-referencia')?.addEventListener('click', () => alternarModoCadastro('referencia'));
  document.getElementById('btn-modo-completo')?.addEventListener('click', () => alternarModoCadastro('completo'));

  document.getElementById('btn-gerar-senha-cadastro')?.addEventListener('click', () => {
    document.getElementById('cadastro-senha').value = gerarSugestaoSenha();
  });

  document.getElementById('form-cadastrar-colaborador')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const msgErro = document.getElementById('msg-erro-cadastro');
    const btnConfirmar = document.getElementById('btn-confirmar-cadastro');
    msgErro.classList.remove('visivel');

    const modo = document.getElementById('cadastro-modo').value;
    const nome_completo = document.getElementById('cadastro-nome').value.trim();
    const reValorBruto = document.getElementById('cadastro-re').value.trim();
    const cargo = document.getElementById('cadastro-cargo').value.trim();
    const setor = document.getElementById('cadastro-setor').value.trim();
    const departamento_nome = document.getElementById('cadastro-departamento').value.trim();
    const email_prefixo = document.getElementById('cadastro-email').value.trim();
    const senha = document.getElementById('cadastro-senha').value;

    if (nome_completo.length < 3) {
      msgErro.textContent = 'Informe o nome completo do colaborador.';
      msgErro.classList.add('visivel');
      return;
    }
    if (!reValorBruto || Number(reValorBruto) <= 0) {
      msgErro.textContent = 'Informe um RE (matrícula) válido.';
      msgErro.classList.add('visivel');
      return;
    }
    if (!cargo) {
      msgErro.textContent = 'Informe o cargo do colaborador.';
      msgErro.classList.add('visivel');
      return;
    }
    if (!setor) {
      msgErro.textContent = 'Informe o setor do colaborador.';
      msgErro.classList.add('visivel');
      return;
    }
    if (modo === 'completo') {
      if (!email_prefixo) {
        msgErro.textContent = 'Informe o e-mail institucional do colaborador.';
        msgErro.classList.add('visivel');
        return;
      }
      if (!senha || senha.length < 6) {
        msgErro.textContent = 'A senha inicial deve ter no mínimo 6 caracteres.';
        msgErro.classList.add('visivel');
        return;
      }
    }

    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Cadastrando…';

    try {
      const { data: resultado, error } = await supabaseClient.functions.invoke('admin-cadastrar-colaborador', {
        body: {
          modo,
          re: Number(reValorBruto),
          nome_completo,
          cargo,
          setor,
          departamento_nome,
          email_prefixo,
          senha,
        },
      });

      if (error) throw error;

      fecharModal(document.getElementById('modal-cadastrar-colaborador'));

      if (modo === 'completo') {
        mostrarToast(`${nome_completo} cadastrado com acesso completo.`, 'sucesso');
        abrirModalSenhaGerada(
          senha,
          `Conta criada para ${resultado.email}. Informe esta senha ao colaborador — ele deverá trocá-la no primeiro acesso.`
        );
        // Recarrega a lista para trazer o novo colaborador (aparecerá como
        // "Pendente", já com setor/RE preenchidos, até o 1º login.
        await carregarTudo();
      } else {
        mostrarToast(`${nome_completo} adicionado à base de referência (RE ${resultado.re}). Ele já pode se cadastrar na tela de login.`, 'sucesso');
      }
    } catch (err) {
      msgErro.textContent = 'Erro ao cadastrar: ' + (err.message || 'falha inesperada.');
      msgErro.classList.add('visivel');
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = modo === 'completo' ? 'Cadastrar e criar acesso' : 'Cadastrar na base de referência';
    }
  });
}

// =========================================================
// Lista dedicada: e-mails aguardando 1º acesso
// =========================================================
// Visão focada e profissional, separada da tabela principal, feita
// especificamente para responder "quais e-mails ainda faltam entrar
// pela primeira vez". Usa a mesma fonte de verdade do badge (ultimo_login
// nulo), então está sempre consistente com o que aparece na tabela.
function obterColaboradoresPendentes() {
  return TODOS_COLABORADORES
    .filter((c) => calcularStatus(c) === 'pendente')
    .slice()
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));
}

function abrirModalEmailsPendentes() {
  renderizarListaEmailsPendentes();
  abrirModal('modal-emails-pendentes');
}

function renderizarListaEmailsPendentes(termo = '') {
  const pendentes = obterColaboradoresPendentes();
  const termoBusca = termo.toLowerCase().trim();

  const filtrados = termoBusca
    ? pendentes.filter((c) =>
        c.email?.toLowerCase().includes(termoBusca) ||
        c.nome_completo?.toLowerCase().includes(termoBusca))
    : pendentes;

  const titulo = document.getElementById('emails-pendentes-titulo');
  if (titulo) {
    titulo.textContent = `${pendentes.length} e-mail${pendentes.length === 1 ? '' : 's'} aguardando 1º acesso`;
  }

  const lista = document.getElementById('emails-pendentes-lista');
  if (!lista) return;

  if (!filtrados.length) {
    lista.innerHTML = `<div class="admin-tabela-vazia">
      ${pendentes.length === 0
        ? 'Nenhum e-mail pendente — todos os colaboradores já acessaram o sistema.'
        : 'Nenhum e-mail corresponde à busca.'}
    </div>`;
    return;
  }

  lista.innerHTML = filtrados.map((c) => `
    <div class="admin-pendente-item">
      <div class="admin-pendente-info">
        <span class="admin-pendente-email">${escapeHtml(c.email || 'Sem e-mail no Auth')}</span>
        ${c.nome_completo ? `<span class="admin-pendente-nome">${escapeHtml(c.nome_completo)}</span>` : '<span class="admin-pendente-nome admin-cel-muted">Perfil ainda não preenchido</span>'}
      </div>
      <span class="admin-pendente-data">Criado em ${formatarDataCurta(c.criado_em_auth)}</span>
    </div>
  `).join('');
}

function formatarDataCurta(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

async function copiarEmailsPendentes() {
  const emails = obterColaboradoresPendentes().map((c) => c.email).filter(Boolean);
  if (!emails.length) {
    mostrarToast('Não há e-mails pendentes para copiar.', 'alerta');
    return;
  }
  try {
    await navigator.clipboard.writeText(emails.join('\n'));
    mostrarToast(`${emails.length} e-mail(s) copiado(s) para a área de transferência.`, 'sucesso');
  } catch {
    mostrarToast('Não foi possível copiar automaticamente.', 'alerta');
  }
}

function exportarEmailsPendentesCSV() {
  const pendentes = obterColaboradoresPendentes();
  if (!pendentes.length) {
    mostrarToast('Não há e-mails pendentes para exportar.', 'alerta');
    return;
  }

  const cabecalho = ['E-mail', 'Nome', 'Setor', 'Criado em (Auth)'];
  const linhas = pendentes.map((c) => [
    c.email || '',
    c.nome_completo || '',
    c.setor || '',
    c.criado_em_auth ? formatarData(c.criado_em_auth) : '',
  ]);

  const csv = [cabecalho, ...linhas]
    .map((linha) => linha.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `emails_pendentes_assina_ai_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  mostrarToast(`${pendentes.length} e-mail(s) exportado(s).`, 'sucesso');
}

// =========================================================
// Modais
// =========================================================
function configurarModais() {
  configurarModalDefinirSenha();
  configurarModalCadastro();

  document.getElementById('busca-emails-pendentes')?.addEventListener('input', debounce((e) => {
    renderizarListaEmailsPendentes(e.target.value);
  }, 150));
  document.getElementById('btn-copiar-emails-pendentes')?.addEventListener('click', copiarEmailsPendentes);
  document.getElementById('btn-exportar-emails-pendentes')?.addEventListener('click', exportarEmailsPendentesCSV);

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
    const setor = document.getElementById('edit-setor').value.trim() || null;
    const reValorBruto = document.getElementById('edit-re').value.trim();
    const re = reValorBruto ? Number(reValorBruto) : null;
    const btnSalvar = document.getElementById('btn-salvar-edicao');

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';
    try {
      const colaboradorAntes = TODOS_COLABORADORES.find((c) => c.id === id);
      const telefoneNovo = ramal ? `(11) 2829-${ramal}` : undefined;

      const novosDados = {
        nome_completo,
        cargo,
        telefone: telefoneNovo,
        setor,
        re,
      };

      await chamarAcaoAdmin('atualizar_perfil', id, novosDados);

      // ---------------------------------------------------------
      // Sincroniza cargo/setor com colaboradores_referencia (base
      // consultada pelo login para validar nome e preencher o Cargo
      // automaticamente). Isolado numa function própria para não
      // arriscar o fluxo principal de "atualizar_perfil" — se essa
      // sincronização falhar, o perfil já foi salvo normalmente, só
      // avisamos o admin que a base institucional pode ficar desatualizada.
      // ---------------------------------------------------------
      const cargoOuSetorMudou =
        (colaboradorAntes?.cargo || '') !== cargo ||
        (colaboradorAntes?.setor || null) !== (setor || null);

      if (cargoOuSetorMudou) {
        try {
          const { error: erroSync } = await supabaseClient.functions.invoke('admin-sync-referencia', {
            body: { usuario_id: id },
          });
          if (erroSync) throw erroSync;
        } catch (erroSync) {
          console.error('Erro ao sincronizar com colaboradores_referencia:', erroSync);
          mostrarToast('Perfil salvo, mas a sincronização com a base institucional falhou. Avise o time de TI.', 'alerta');
        }
      }


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
        if ((colaboradorAntes.setor || null) !== (setor || null)) {
          alteracoes.setor = { de: colaboradorAntes.setor || 'Sem setor', para: setor || 'Sem setor' };
        }
        const reAntes = colaboradorAntes.re ?? null;
        if (reAntes !== re) {
          alteracoes.re = { de: reAntes ?? '—', para: re ?? '—' };
        }
      }

      await registrarLogDetalhado({
        usuarioId: id,
        nomeNoMomento: nome_completo,
        acao: 'atualizacao_perfil',
        alteracoes,
      });

      if (colaboradorAntes) {
        Object.assign(colaboradorAntes, novosDados);
        colaboradorAntes.possui_perfil = true;
        recalcularSetores();
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
    console.error('Erro ao registrar log detalhado:', erroLog);
    mostrarToast('A ação foi concluída, mas houve falha ao registrar o log.', 'alerta');
  }
}

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
  document.getElementById('edit-setor').value = colaborador.setor || '';
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
    const existente = TODOS_COLABORADORES.find((c) => c.id === payload.new.id);
    if (existente) {
      // Já existia na lista (vindo do Auth, sem perfil ainda) — agora ganhou perfil.
      Object.assign(existente, payload.new, { possui_perfil: true });
      mostrarToast(`${payload.new.nome_completo} concluiu o 1º acesso.`, 'sucesso');
    } else {
      TODOS_COLABORADORES.push({ ...payload.new, possui_perfil: true });
      mostrarToast(`Novo colaborador: ${payload.new.nome_completo}`, 'sucesso');
    }
  } else if (payload.eventType === 'UPDATE') {
    const idx = TODOS_COLABORADORES.findIndex((c) => c.id === payload.new.id);
    if (idx !== -1) {
      TODOS_COLABORADORES[idx] = { ...payload.new, possui_perfil: true };
    }
  } else if (payload.eventType === 'DELETE') {
    // O perfil foi apagado, mas o usuário pode continuar existindo no Auth —
    // não removemos da lista, só marcamos que ficou sem perfil novamente.
    const existente = TODOS_COLABORADORES.find((c) => c.id === payload.old.id);
    if (existente) {
      existente.possui_perfil = false;
      existente.primeiro_acesso = true;
    }
  }
  recalcularSetores();
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