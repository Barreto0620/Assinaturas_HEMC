import { supabaseClient } from './supabaseClient.js';

// Mapeamento de Elementos do DOM
const nomeTopo = document.getElementById("usuario-nome-topo");
const cargoTopo = document.getElementById("usuario-cargo-topo");
const btnLogout = document.getElementById("btn-logout");

const inputNome = document.getElementById("nome");
const inputCargo = document.getElementById("cargo");
const inputHospital = document.getElementById("hospital");
const inputEmail = document.getElementById("email");
const inputTelefone = document.getElementById("telefone");
const inputEndereco = document.getElementById("endereco");

const btnGerar = document.getElementById("btn-gerar");
const btnBaixar = document.getElementById("btn-baixar");
const areaAssinatura = document.getElementById("assinatura");

// =========================================================
// 0. MODO ADMIN — gerar assinatura em nome de outro colaborador
// Ativado via query string ?adminGerarPara=<id_do_colaborador>
// vinda do painel admin. Nesse modo, os dados carregados são
// os do colaborador-alvo, não os do admin logado.
// =========================================================
const parametrosUrl = new URLSearchParams(window.location.search);
const idColaboradorAlvo = parametrosUrl.get("adminGerarPara");
let modoAdminAtivo = false;
let colaboradorAlvoCache = null;

function exibirFaixaModoAdmin(nomeColaborador) {
  const faixa = document.createElement("div");
  faixa.id = "faixa-modo-admin";
  faixa.style.cssText = `
    background: linear-gradient(135deg, #d69a1f, #b5790f);
    color: #fff; text-align: center; padding: 10px 16px;
    font-size: 13px; font-weight: 600; position: sticky; top: 0; z-index: 500;
  `;
  faixa.innerHTML = `⚠️ Modo administrador: gerando assinatura em nome de <strong>${nomeColaborador}</strong>. &nbsp;
    <a href="admin.html" style="color:#fff; text-decoration: underline;">Voltar ao painel</a>`;
  document.body.prepend(faixa);
}

// =========================================================
// 1. VERIFICA SESSÃO E CARREGA DADOS DO PERFIL
// =========================================================
async function inicializarGerador() {
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError || !session) {
      window.location.href = "index.html";
      return;
    }

    const user = session.user;

    // ---------------------------------------------------------
    // Modo admin: se veio com ?adminGerarPara=ID, confirma que
    // quem está logado é admin e troca o alvo dos dados exibidos.
    // ---------------------------------------------------------
    if (idColaboradorAlvo) {
      const { data: perfilLogado } = await supabaseClient
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      if (perfilLogado?.is_admin) {
        const { data: alvo, error: erroAlvo } = await supabaseClient
          .from("profiles")
          .select("id, nome_completo, cargo, telefone, email")
          .eq("id", idColaboradorAlvo)
          .single();

        if (!erroAlvo && alvo) {
          modoAdminAtivo = true;
          colaboradorAlvoCache = alvo;
        }
      }
    }

    let nomeCompleto, cargo, telefone, email;
    let deveMostrarTour = false;

    if (modoAdminAtivo && colaboradorAlvoCache) {
      nomeCompleto = colaboradorAlvoCache.nome_completo || "Colaborador";
      cargo = colaboradorAlvoCache.cargo || "Colaborador";
      telefone = colaboradorAlvoCache.telefone || "(11) 2829-XXXX";
      email = colaboradorAlvoCache.email || "";

      exibirFaixaModoAdmin(nomeCompleto);
      // O tour é uma orientação para o PRÓPRIO dono da conta — não faz
      // sentido disparar quando um admin está gerando em nome de outra
      // pessoa, então é propositalmente ignorado neste modo.
    } else {
      // Busca os dados complementares do perfil na tabela pública
      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("nome_completo, cargo, telefone, is_admin, tour_concluido")
        .eq("id", user.id)
        .single();

      if (profileError) {
        console.warn("Perfil não encontrado na tabela pública, usando metadados adicionais.");
      }

      nomeCompleto = profile?.nome_completo || user.user_metadata?.nome_completo || "Usuário";
      cargo = profile?.cargo || user.user_metadata?.cargo || "Colaborador";
      telefone = profile?.telefone || user.user_metadata?.telefone || "(11) 2829-XXXX";
      email = user.email;

      // Exibe o botão de acesso ao painel administrativo somente para admins
      if (profile?.is_admin) {
        const btnPainelAdmin = document.getElementById("btn-painel-admin");
        if (btnPainelAdmin) btnPainelAdmin.style.display = "inline-flex";
      }

      // Só mostra o tour para quem realmente ainda não viu (coluna
      // "tour_concluido" false/null). Se a coluna ainda não existir no
      // banco (undefined), o optional chaining acima resulta em
      // "profile?.tour_concluido" undefined — tratamos isso como "ainda
      // não visto", já que é o comportamento mais seguro (o pior caso é
      // mostrar o tour de novo, nunca deixar de mostrar para quem precisa).
      deveMostrarTour = !profile?.tour_concluido;
    }

    if (nomeTopo) nomeTopo.textContent = nomeCompleto;
    if (cargoTopo) cargoTopo.textContent = cargo;

    if (inputNome) inputNome.value = nomeCompleto;
    if (inputCargo) inputCargo.value = cargo;
    if (inputEmail) inputEmail.value = email;
    if (inputTelefone) inputTelefone.value = telefone;

    if (deveMostrarTour) {
      // Pequeno atraso para garantir que o layout já foi totalmente
      // pintado (posições corretas para o spotlight) antes de iniciar.
      window.requestAnimationFrame(() => {
        setTimeout(() => iniciarTourPrimeiroAcesso(user.id), 250);
      });
    }

  } catch (err) {
    console.error("Erro ao inicializar aplicação:", err);
  }
}

inicializarGerador();

// =========================================================
// 2. LOGOUT (SAÍDA DO SISTEMA)
// =========================================================
if (btnLogout) {
  btnLogout.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });
}

// =========================================================
// 3. GERADOR DA ESTRUTURA VISUAL DA ASSINATURA
// =========================================================
btnGerar.addEventListener("click", async () => {
  const nome = inputNome.value;
  const cargo = inputCargo.value;
  const hospital = inputHospital.value;
  const email = inputEmail.value;
  const telefone = inputTelefone.value;
  const endereco = inputEndereco.value;

  const CORES = {
    azulPrincipal: "#27447F",
    azulEscuro: "#1B3358",
    azulClaro: "#4A72B5",
    cinzaTexto: "#2E2E2E",
    cinzaDisclaimer: "#6b6b6b"
  };

  const assinaturaHTML = `
    <div id="assinatura-content" style="width: 680px; font-family: Arial, sans-serif; font-size: 11px; color: ${CORES.cinzaTexto} !important; padding-bottom: 0; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;">
      <table style="width: 100%; table-layout: fixed; border-collapse: collapse;">
        <tr>
          <td style="width: 250px; height: auto; text-align: left; vertical-align: middle; padding: 0 16px 0 0;">
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAYIAAABvCAIAAABuNVA2AAAACXBIWXMAAA7EAAAOxAGVKw4bAAAFUGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLyc+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyc+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpBdHRyaWI9J2h0dHA6Ly9ucy5hdHRyaWJ1dGlvbi5jb20vYWRzLzEuMC8nPgogIDxBdHRyaWI6QWRzPgogICA8cmRmOlNlcT4KICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0nUmVzb3VyY2UnPgogICAgIDxBdHRyaWI6Q3JlYXRlZD4yMDI2LTA3LTAyPC9BdHRyaWI6Q3JlYXRlZD4KICAgICA8QXR0cmliOkRhdGE+eyZxdW90O2RvYyZxdW90OzomcXVvdDtEQUhPS2JWcTZKYyZxdW90OywmcXVvdDt1c2VyJnF1b3Q7OiZxdW90O1VBRnJOTmo4NE44JnF1b3Q7LCZxdW90O2JyYW5kJnF1b3Q7OiZxdW90O0JBRnJOTGMxdnVjJnF1b3Q7fTwvQXR0cmliOkRhdGE+CiAgICAgPEF0dHJpYjpFeHRJZD4zZjFhNGRjMi03YjgwLTRiYjQtOTM5Zi1kNjk4MDZlMmJlMTg8L0F0dHJpYjpFeHRJZD4KICAgICA8QXR0cmliOkZiSWQ+NTI1MjY1OTE0MTc5NTgwPC9BdHRyaWI6RmJJZD4KICAgICA8QXR0cmliOlRvdWNoVHlwZT4yPC9BdHRyaWI6VG91Y2hUeXBlPgogICAgPC9yZGY6bGk+CiAgIDwvcmRmOlNlcT4KICA8L0F0dHJpYjpBZHM+CiA8L3JkZjpEZXNjcmlwdGlvbj4KCiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJwogIHhtbG5zOmRjPSdodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4x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" style="max-width: 100%; image-rendering: -webkit-optimize-contrast;" crossorigin="anonymous"">
          </td>
          <td style="vertical-align: middle; padding-left: 10px; padding-top: 0; padding-bottom: 0; border-left: 2px solid ${CORES.azulPrincipal};">
            <p style="margin: 0 0 3px 0; font-size: 14px; color: ${CORES.azulEscuro} !important;"><strong style="color: ${CORES.azulEscuro} !important;">${nome}</strong></p>
            <p style="margin: 0 0 2px 0; font-size: 11px; color: ${CORES.azulPrincipal} !important; font-weight: bold;">${cargo}</p>
            <p style="margin: 0 0 2px 0; font-size: 11px; color: ${CORES.cinzaTexto} !important;">${hospital}</p>
            <div style="height:1px; background:${CORES.azulPrincipal}; opacity: 0.35; margin: 5px 0;"></div>
            <p style="margin: 0 0 2px 0; font-size: 11px; color: ${CORES.cinzaTexto} !important;">${email} | ${telefone}</p>
            <p style="margin: 0 0 0 0; font-size: 11px; color: ${CORES.cinzaTexto} !important;">${endereco}</p>
          </td>
        </tr>
      </table>
      <div style="height:8px; background:${CORES.azulPrincipal}; margin-top:10px; width: 680px; border-radius: 0 4px 4px 0;"></div>
      

      <p style="margin: 10px 0 0 0; width: 680px; font-size: 8px; line-height: 1.4; color: ${CORES.cinzaDisclaimer} !important; text-align: justify; font-family: Arial, sans-serif;">
        As informações contidas e as anexadas a esta comunicação podem ser confidenciais, legalmente privilegiadas, ou ter de outra forma protegida a sua divulgação, sendo exclusivamente para o uso do(s) seu(s) destinatário(s). Se você NÃO for o destinatário previsto desta comunicação, queira, por gentileza, excluir e destruir todas as cópias em seu poder. Notifique o remetente que você recebeu esta comunicação por engano e esteja ciente de que a leitura ou divulgação, bem como a adoção de qualquer ação baseada nesta comunicação, está expressamente proibida. Qualquer conteúdo que não esteja relacionado ao Hospital Estadual Mário Covas de Santo André reflete apenas as opiniões do remetente, não as da instituição. Obrigado pela leitura.
      </p>
    </div>`;

  areaAssinatura.innerHTML = assinaturaHTML;
  btnBaixar.disabled = false;

  // ---------------------------------------------------------
  // Log de geração de assinatura (tabela logs_assinatura, já
  // existente no schema). Se estiver em modo admin, registra
  // também um activity_log detalhado com quem gerou para quem.
  // ---------------------------------------------------------
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const usuarioAlvoId = modoAdminAtivo ? idColaboradorAlvo : session.user.id;

    await supabaseClient.from("logs_assinatura").insert({
      user_id: usuarioAlvoId,
      acao: "gerar_assinatura",
    });

    if (modoAdminAtivo) {
      await supabaseClient.from("activity_logs").insert({
        usuario_id: usuarioAlvoId,
        nome_no_momento: nome,
        acao: "assinatura_gerada",
        detalhes: { gerado_por_admin: true },
        executado_por: session.user.id,
      });
    }
  } catch (erroLog) {
    console.error("Erro ao registrar log de assinatura:", erroLog);
  }
});

// =========================================================
// 4. DOWNLOAD EM FORMATO PORTÁTIL PNG (HTML2CANVAS) — QUALIDADE PROFISSIONAL
// =========================================================
btnBaixar.addEventListener("click", () => {
  const conteudoReal = document.getElementById("assinatura-content") || areaAssinatura;

  const ESCALA_EXPORTACAO = 3;

  const configCanvas = {
    scale: ESCALA_EXPORTACAO,
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    imageTimeout: 15000,
    logging: false,
    letterRendering: true,
    removeContainer: true,
    onclone: (documentoClonado) => {
      const alvoClonado = documentoClonado.getElementById("assinatura-content");
      if (alvoClonado) {
        alvoClonado.style.transform = "scale(1)";
        alvoClonado.style.imageRendering = "-webkit-optimize-contrast";
      }
    }
  };

  html2canvas(conteudoReal, configCanvas).then((canvas) => {
    const contexto = canvas.getContext("2d");
    if (contexto) {
      contexto.imageSmoothingEnabled = true;
      contexto.imageSmoothingQuality = "high";
    }

    const imagemBase64 = canvas.toDataURL("image/png", 1.0);

    const linkPng = document.createElement("a");
    linkPng.download = `Assinatura_${inputNome.value.replace(/\s+/g, "_")}.png`;
    linkPng.href = imagemBase64;
    linkPng.click();
  }).catch((erro) => {
    console.error("Erro ao gerar imagem da assinatura:", erro);
    alert("Ocorreu um erro ao gerar a imagem. Tente novamente.");
  });
});

// =========================================================
// 5. TOUR INTERATIVO DE PRIMEIRO ACESSO
// =========================================================
// Guia o colaborador pelos principais pontos da tela na primeira vez que
// ele chega ao gerador (spotlight + tooltip, no estilo de onboarding de
// grandes aplicativos). Marca "tour_concluido" em profiles ao final ou ao
// pular, para nunca mais aparecer automaticamente depois disso.
// =========================================================

function iniciarTourPrimeiroAcesso(usuarioId) {
  // Evita duplicar o tour se por algum motivo a função for chamada 2x.
  if (document.getElementById("tour-spotlight")) return;

  const passos = construirPassosTour();
  let indiceAtual = 0;

  const spotlight = document.createElement("div");
  spotlight.id = "tour-spotlight";
  spotlight.className = "tour-spotlight";

  const tooltip = document.createElement("div");
  tooltip.id = "tour-tooltip";
  tooltip.className = "tour-tooltip";
  tooltip.innerHTML = `
    <button type="button" class="tour-pular" id="tour-btn-pular">Pular tour</button>
    <div class="tour-tooltip-passo" id="tour-passo-contador"></div>
    <h4 class="tour-tooltip-titulo" id="tour-titulo"></h4>
    <p class="tour-tooltip-texto" id="tour-texto"></p>
    <div class="tour-tooltip-rodape">
      <div class="tour-dots" id="tour-dots"></div>
      <div class="tour-tooltip-botoes">
        <button type="button" class="tour-btn tour-btn-texto" id="tour-btn-anterior">Voltar</button>
        <button type="button" class="tour-btn tour-btn-primario" id="tour-btn-proximo">Próximo</button>
      </div>
    </div>
  `;

  document.body.appendChild(spotlight);
  document.body.appendChild(tooltip);

  const elPassoContador = tooltip.querySelector("#tour-passo-contador");
  const elTitulo = tooltip.querySelector("#tour-titulo");
  const elTexto = tooltip.querySelector("#tour-texto");
  const elDots = tooltip.querySelector("#tour-dots");
  const btnAnterior = tooltip.querySelector("#tour-btn-anterior");
  const btnProximo = tooltip.querySelector("#tour-btn-proximo");
  const btnPular = tooltip.querySelector("#tour-btn-pular");

  // Constrói os pontinhos de progresso uma única vez
  passos.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "tour-dot";
    dot.dataset.indice = String(i);
    elDots.appendChild(dot);
  });

  function atualizarDots() {
    elDots.querySelectorAll(".tour-dot").forEach((dot, i) => {
      dot.classList.toggle("tour-dot-ativo", i === indiceAtual);
    });
  }

  function posicionarSpotlightCentralizado() {
    spotlight.classList.add("tour-sem-alvo");
    spotlight.style.width = "0px";
    spotlight.style.height = "0px";
    spotlight.style.top = "50%";
    spotlight.style.left = "50%";
  }

  function posicionarSpotlightNoAlvo(elAlvo) {
    const rect = elAlvo.getBoundingClientRect();
    const respiro = 8;
    spotlight.classList.remove("tour-sem-alvo");
    spotlight.style.top = `${rect.top - respiro}px`;
    spotlight.style.left = `${rect.left - respiro}px`;
    spotlight.style.width = `${rect.width + respiro * 2}px`;
    spotlight.style.height = `${rect.height + respiro * 2}px`;
  }

  function posicionarTooltip(elAlvo) {
    if (!elAlvo) {
      tooltip.classList.add("tour-centralizado");
      return;
    }
    tooltip.classList.remove("tour-centralizado");

    const rectAlvo = elAlvo.getBoundingClientRect();
    const larguraTooltip = tooltip.offsetWidth || 300;
    const alturaTooltip = tooltip.offsetHeight || 140;
    const margem = 16;

    let top = rectAlvo.bottom + margem;
    let left = rectAlvo.left;

    // Se não couber embaixo, posiciona acima do alvo
    if (top + alturaTooltip > window.innerHeight - 12) {
      top = rectAlvo.top - alturaTooltip - margem;
    }
    // Nunca deixa colar no topo da tela
    if (top < 12) top = 12;

    // Ajusta horizontalmente para não vazar da tela
    if (left + larguraTooltip > window.innerWidth - 12) {
      left = window.innerWidth - larguraTooltip - 12;
    }
    if (left < 12) left = 12;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function renderizarPasso() {
    const passo = passos[indiceAtual];
    const elAlvo = passo.seletor ? document.querySelector(passo.seletor) : null;

    if (elAlvo) {
      elAlvo.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Pequeno atraso para o scroll suave terminar antes de medir posições
    setTimeout(() => {
      if (elAlvo) {
        posicionarSpotlightNoAlvo(elAlvo);
      } else {
        posicionarSpotlightCentralizado();
      }
      posicionarTooltip(elAlvo);

      elPassoContador.textContent = `Passo ${indiceAtual + 1} de ${passos.length}`;
      elTitulo.textContent = passo.titulo;
      elTexto.textContent = passo.texto;
      atualizarDots();

      btnAnterior.style.visibility = indiceAtual === 0 ? "hidden" : "visible";
      btnProximo.textContent = indiceAtual === passos.length - 1 ? "Começar a usar" : "Próximo";

      spotlight.classList.add("tour-ativo");
      tooltip.classList.add("tour-ativo");
    }, elAlvo ? 220 : 0);
  }

  async function encerrarTour() {
    spotlight.remove();
    tooltip.remove();
    window.removeEventListener("resize", aoRedimensionar);

    try {
      await supabaseClient
        .from("profiles")
        .update({ tour_concluido: true })
        .eq("id", usuarioId);
    } catch (erro) {
      console.error("Erro ao marcar tour como concluído:", erro);
    }
  }

  function aoRedimensionar() {
    const passo = passos[indiceAtual];
    const elAlvo = passo.seletor ? document.querySelector(passo.seletor) : null;
    if (elAlvo) {
      posicionarSpotlightNoAlvo(elAlvo);
    } else {
      posicionarSpotlightCentralizado();
    }
    posicionarTooltip(elAlvo);
  }

  btnProximo.addEventListener("click", () => {
    if (indiceAtual === passos.length - 1) {
      encerrarTour();
      return;
    }
    indiceAtual += 1;
    renderizarPasso();
  });

  btnAnterior.addEventListener("click", () => {
    if (indiceAtual === 0) return;
    indiceAtual -= 1;
    renderizarPasso();
  });

  btnPular.addEventListener("click", encerrarTour);

  window.addEventListener("resize", aoRedimensionar);

  renderizarPasso();
}

function construirPassosTour() {
  return [
    {
      seletor: null,
      titulo: "Bem-vindo(a) ao Gerador de Assinatura! 👋",
      texto: "Vamos te mostrar rapidamente como montar e baixar sua assinatura oficial. Leva menos de um minuto.",
    },
    {
      seletor: "#nome",
      titulo: "Seu nome",
      texto: "Preenchido automaticamente com base no seu cadastro institucional. Não pode ser editado por aqui.",
    },
    {
      seletor: "#cargo",
      titulo: "Seu cargo",
      texto: "Também vem direto do seu cadastro. Se estiver incorreto, use o botão de ajuda na tela de login ou abra um chamado no GLPI.",
    },
    {
      seletor: "#hospital",
      titulo: "Hospital",
      texto: "Este campo já vem preenchido, mas pode ser ajustado se você atender em outra unidade.",
    },
    {
      seletor: "#email",
      titulo: "E-mail institucional",
      texto: "Vinculado à sua conta de acesso — sempre o mesmo que você usa para entrar no sistema.",
    },
    {
      seletor: "#telefone",
      titulo: "Ramal",
      texto: "Preenchido com o ramal do seu cadastro. Para corrigir, peça a um administrador para atualizar seu perfil.",
    },
    {
      seletor: "#endereco",
      titulo: "Endereço",
      texto: "Vem com o endereço padrão do hospital já preenchido, mas você pode personalizar se precisar.",
    },
    {
      seletor: ".painel-form-acoes",
      titulo: "Gerar e baixar",
      texto: "Clique em \"Gerar Assinatura\" para montar a pré-visualização e, depois, em \"Baixar PNG\" para salvar a imagem final.",
    },
    {
      seletor: ".cartao-preview",
      titulo: "Pré-visualização",
      texto: "Aqui você vê exatamente como sua assinatura vai ficar — é essa mesma imagem que será exportada.",
    },
    {
      seletor: ".hemc-ajuda-secao",
      titulo: "Vídeos de ajuda",
      texto: "Tem tutoriais em vídeo mostrando como aplicar a assinatura no Outlook e no Skymail. Pode assistir quando quiser.",
    },
    {
      seletor: null,
      titulo: "Prontinho! 🎉",
      texto: "Agora é só gerar sua assinatura e aplicar no seu e-mail. Este tour não vai aparecer de novo — mas os vídeos de ajuda continuam sempre disponíveis.",
    },
  ];
}