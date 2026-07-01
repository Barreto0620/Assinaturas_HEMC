import { supabaseClient } from './supabaseClient.js';

// =========================================================
// Lógica da tela de login / cadastro
// =========================================================

const camposCadastro = document.getElementById("campos-cadastro");
const linkAlternarModo = document.getElementById("alternar-modo-link");
const tituloForm = document.getElementById("titulo-form");
const subtituloForm = document.getElementById("subtitulo-form");
const btnSubmit = document.getElementById("btn-submit");
const msgErro = document.getElementById("msg-erro");
const msgSucesso = document.getElementById("msg-sucesso");

let modoCadastro = false;

// -------- Utilidades de UI --------
function mostrarErro(texto) {
  msgSucesso.classList.remove("visivel");
  msgErro.textContent = texto;
  msgErro.classList.add("visivel");
}

function mostrarSucesso(texto) {
  msgErro.classList.remove("visivel");
  msgSucesso.textContent = texto;
  msgSucesso.classList.add("visivel");
}

function limparMensagens() {
  msgErro.classList.remove("visivel");
  msgSucesso.classList.remove("visivel");
}

function alternarModo(paraCadastro) {
  modoCadastro = paraCadastro;
  limparMensagens();

  // Inputs para alternar obrigatoriedade dinamicamente
  const inputNome = document.getElementById("nome-completo");
  const inputCargo = document.getElementById("cargo");
  const inputTelefone = document.getElementById("telefone");

  if (modoCadastro) {
    camposCadastro.classList.add("visivel");
    tituloForm.textContent = "Criar conta";
    subtituloForm.textContent = "Cadastre-se com seu e-mail institucional";
    btnSubmit.textContent = "Cadastrar";
    linkAlternarModo.textContent = "Já tenho conta. Entrar";

    if (inputNome) inputNome.required = true;
    if (inputCargo) inputCargo.required = true;
    if (inputTelefone) inputTelefone.required = true;
  } else {
    camposCadastro.classList.remove("visivel");
    tituloForm.textContent = "Entrar";
    subtituloForm.textContent = "Acesse com seu e-mail institucional";
    btnSubmit.textContent = "Entrar";
    linkAlternarModo.textContent = "Não tenho conta. Cadastrar";

    if (inputNome) inputNome.required = false;
    if (inputCargo) inputCargo.required = false;
    if (inputTelefone) inputTelefone.required = false;
  }
}

linkAlternarModo.addEventListener("click", (e) => {
  e.preventDefault();
  alternarModo(!modoCadastro);
});

// -------- Envio do formulário (login OU cadastro) --------
const formAuth = document.getElementById("form-auth");
if (formAuth) {
  formAuth.addEventListener("submit", async (e) => {
    e.preventDefault();
    limparMensagens();
    btnSubmit.disabled = true;

    // Recupera o prefixo digitado e monta o e-mail corporativo completo profissionalmente
    const emailPrefixo = document.getElementById("email").value.trim();
    const email = emailPrefixo ? `${emailPrefixo}@hemc.fuabc.org.br` : "";
    const senha = document.getElementById("senha").value;

    if (!emailPrefixo) {
      mostrarErro("Por favor, insira o seu e-mail institucional.");
      btnSubmit.disabled = false;
      return;
    }

    try {
      if (modoCadastro) {
        const nomeCompleto = document.getElementById("nome-completo").value.trim();
        const cargo = document.getElementById("cargo").value.trim();
        const ramalDigitado = document.getElementById("telefone").value.trim();

        if (!nomeCompleto || !cargo || !ramalDigitado) {
          mostrarErro("Preencha todos os campos obrigatórios.");
          btnSubmit.disabled = false;
          return;
        }

        // Formata o ramal juntando o prefixo visual fixo do seu HTML
        const telefoneFinal = `(11) 2829-${ramalDigitado}`;

        // 1. Cria o usuário na autenticação do Supabase com o e-mail completo formatado
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password: senha,
          options: {
            data: {
              nome_completo: nomeCompleto,
              cargo: cargo,
              telefone: telefoneFinal,
            },
          },
        });

        if (error) throw error;

        // 2. Insere os dados complementares na tabela pública 'profiles'
        if (data?.user) {
          const { error: profileError } = await supabaseClient
            .from("profiles")
            .insert({
              id: data.user.id, // Vincula com o UUID gerado no Auth
              nome_completo: nomeCompleto,
              cargo: cargo,
              telefone: telefoneFinal
            });

          if (profileError) {
            console.error("Erro ao salvar perfil na tabela pública:", profileError.message);
          }
        }

        // Como a confirmação de e-mail está desativada, exibe o sucesso e joga pra dentro
        mostrarSucesso("Cadastro realizado com sucesso! Entrando...");
        setTimeout(() => {
          window.location.href = "gerador.html";
        }, 1500);

      } else {
        // --- MODO LOGIN ---
        // Realiza a autenticação utilizando o e-mail corporativo completo montado
        const { error } = await supabaseClient.auth.signInWithPassword({
          email,
          password: senha,
        });

        if (error) throw error;

        mostrarSucesso("Login efetuado! Entrando...");
        setTimeout(() => {
          window.location.href = "gerador.html";
        }, 1000);
      }
    } catch (err) {
      mostrarErro(traduzirErro(err.message));
    } finally {
      btnSubmit.disabled = false;
    }
  });
}

function traduzirErro(msg) {
  const mapa = {
    "Invalid login credentials": "E-mail ou senha inválidos.",
    "User already registered": "Este e-mail já está cadastrado.",
    "Password should be at least 6 characters": "A senha deve ter pelo menos 6 caracteres.",
    "Email not confirmed": "Confirme seu e-mail antes de entrar.",
  };
  return mapa[msg] || msg;
}

// -------- Se já estiver logado, vai direto pro gerador --------
(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    window.location.href = "gerador.html";
  }
})();