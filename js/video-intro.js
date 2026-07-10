// =========================================================
// Vídeo de abertura institucional — Assina.ai / HEMC
// =========================================================
// Tela cheia, autoplay mudo, com botão de pular no canto inferior
// direito. Reproduzido apenas UMA VEZ, para sempre (localStorage): se a
// pessoa já assistiu — nesta sessão, ontem, na semana passada, tanto faz
// — o script nem injeta comportamento. A marcação "sem-intro", já
// colocada no <html> pelo script síncrono do <head> (mesmo padrão usado
// para evitar flash de tema), esconde o overlay via CSS antes mesmo
// deste arquivo rodar.
//
// Este arquivo NUNCA pode travar o acesso ao site: qualquer falha no
// carregamento/reprodução do vídeo encerra a intro imediatamente.
// =========================================================

(function () {
  const CHAVE_ARMAZENAMENTO = "hemc-intro-assistido";
  const ATRASO_BOTAO_MS = 1200;
  const DURACAO_FADE_MS = 500;

  function jaAssistiu() {
    try {
      return localStorage.getItem(CHAVE_ARMAZENAMENTO) === "1";
    } catch (e) {
      // Sem acesso a localStorage (modo privado restrito, por exemplo):
      // não há como lembrar, mas também não vale a pena travar por isso.
      return false;
    }
  }

  function marcarComoAssistido() {
    try {
      localStorage.setItem(CHAVE_ARMAZENAMENTO, "1");
    } catch (e) {
      /* ignora — pior caso, a intro reaparece na próxima visita */
    }
  }

  if (jaAssistiu()) return;

  const overlay = document.getElementById("intro-video-overlay");
  const video = document.getElementById("intro-video");
  const btnPular = document.getElementById("intro-video-skip");

  // Se o markup não estiver presente na página (ex.: alguém remove o
  // bloco do HTML sem remover este script), simplesmente não faz nada.
  if (!overlay || !video || !btnPular) return;

  document.body.style.overflow = "hidden";

  const timeoutBotao = setTimeout(() => {
    btnPular.classList.add("intro-skip-visivel");
  }, ATRASO_BOTAO_MS);

  let encerrado = false;

  function encerrarIntro() {
    if (encerrado) return;
    encerrado = true;

    clearTimeout(timeoutBotao);
    marcarComoAssistido();

    overlay.classList.add("intro-saindo");
    document.body.style.overflow = "";

    setTimeout(() => {
      overlay.remove();
    }, DURACAO_FADE_MS);
  }

  btnPular.addEventListener("click", encerrarIntro);
  video.addEventListener("ended", encerrarIntro);

  // Autoplay bloqueado pelo navegador ou arquivo de vídeo ausente/corrompido
  // — em qualquer um desses casos, libera o acesso ao site na hora.
  video.addEventListener("error", encerrarIntro);

  const promessaReproducao = video.play();
  if (promessaReproducao && typeof promessaReproducao.catch === "function") {
    promessaReproducao.catch(encerrarIntro);
  }
})();