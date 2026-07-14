# Política de Segurança — Assina.ai (HEMC)

Este documento descreve as práticas de segurança adotadas no Assina.ai, os dados tratados pelo sistema, como segredos e credenciais são gerenciados, e como reportar uma vulnerabilidade.

> Este é um sistema institucional em produção, usado por colaboradores reais do Hospital Estadual Mário Covas. Qualquer suspeita de vulnerabilidade deve ser tratada com prioridade — veja [Como reportar uma vulnerabilidade](#como-reportar-uma-vulnerabilidade).

---

## Índice

- [Dados tratados e LGPD](#dados-tratados-e-lgpd)
- [Autenticação e controle de acesso](#autenticação-e-controle-de-acesso)
- [Gestão de segredos](#gestão-de-segredos)
- [Segurança de rede e transporte](#segurança-de-rede-e-transporte)
- [Row Level Security (RLS)](#row-level-security-rls)
- [Auditoria](#auditoria)
- [Boas práticas de desenvolvimento](#boas-práticas-de-desenvolvimento)
- [Limitações conhecidas](#limitações-conhecidas)
- [Como reportar uma vulnerabilidade](#como-reportar-uma-vulnerabilidade)

---

## Dados tratados e LGPD

O sistema coleta e armazena os seguintes dados pessoais de colaboradores do HEMC, sempre com finalidade exclusiva de autenticação e geração de assinatura institucional:

| Dado | Finalidade | Onde fica armazenado |
|---|---|---|
| Nome completo | Identificação, assinatura de e-mail | `profiles`, `colaboradores_referencia` |
| Cargo | Assinatura de e-mail, validação de acesso | `profiles`, `colaboradores_referencia` |
| Setor / Departamento | Organização interna, filtros administrativos | `profiles`, `colaboradores_referencia` |
| RE (matrícula) | Identificador único institucional | `profiles`, `colaboradores_referencia` |
| E-mail institucional | Autenticação | `auth.users`, `profiles` |
| Ramal telefônico | Assinatura de e-mail | `profiles` |
| Senha | Autenticação | `auth.users` (hash gerenciado pelo Supabase Auth — nunca armazenada em texto plano, nunca acessível pela aplicação) |

**Base legal e transparência (LGPD):** o sistema exibe, na tela de login, um aviso explícito de que dados institucionais são coletados e armazenados exclusivamente para autenticação e geração de assinatura, e que preferências de interface (tema) ficam salvas localmente no navegador (`localStorage`). O colaborador confirma ciência antes de prosseguir.

**Não são coletados:** dados sensíveis (saúde, biometria, dados de terceiros pacientes), nem qualquer dado além do necessário para o funcionamento do sistema.

**Retenção:** os dados permanecem enquanto o colaborador mantiver vínculo ativo com a instituição. Desativação de acesso (`ativo: false`) revoga o uso do sistema sem apagar o histórico de auditoria, necessário para rastreabilidade administrativa.

---

## Autenticação e controle de acesso

- Autenticação via **Supabase Auth** (e-mail + senha). Nenhuma senha é manipulada, vista ou armazenada pelo código da aplicação — todo o fluxo de hash e verificação é interno ao Supabase.
- **Redefinição obrigatória de senha** no primeiro acesso: toda conta criada por um administrador (seja em cadastro completo ou reset de senha) é marcada com `senha_redefinida: false`, forçando o colaborador a definir uma senha própria antes de acessar qualquer funcionalidade.
- **Distinção clara de papéis**: colaboradores comuns só acessam `gerador.html`; administradores (`is_admin: true` em `profiles`) acessam também `admin.html`. Toda Edge Function que executa ações privilegiadas **revalida `is_admin` no servidor** a cada chamada — nunca confia em uma flag vinda do front-end.
- **Validação de nome contra a base institucional**: o login do colaborador exige que o nome digitado corresponda exatamente (via normalização de acentos/maiúsculas) a um registro em `colaboradores_referencia`, prevenindo que alguém se autentique com identidade divergente do cadastro de RH.

---

## Gestão de segredos

| Segredo | Onde vive | Exposto ao front-end? |
|---|---|---|
| `SUPABASE_ANON_KEY` | `js/supabaseClient.js` | Sim — é uma chave **pública por design**, protegida por RLS no banco. Não concede nenhum privilégio além do que as políticas de RLS permitem. |
| `SUPABASE_SERVICE_ROLE_KEY` | Variável de ambiente das Edge Functions (gerenciada automaticamente pelo Supabase) | **Nunca**. Essa chave bypassa RLS e só existe no runtime isolado das Edge Functions — jamais deve ser copiada para código de front-end, commitada em repositório, ou logada. |
| Senhas de colaboradores | `auth.users` (hash interno do Supabase) | Nunca — nem em texto plano, nem em log, nem em trânsito além do necessário para autenticação. |

**Regra permanente:** qualquer operação que exija `service_role` (criar usuário, resetar senha, escrever em `colaboradores_referencia`) só pode acontecer dentro de uma Edge Function, nunca diretamente do navegador.

---

## Segurança de rede e transporte

Configurados em `vercel.json`, aplicados a todas as páginas:

- **HTTPS obrigatório** via `Strict-Transport-Security` (HSTS, 2 anos, incluindo subdomínios).
- **Content-Security-Policy** restringindo origens de script, estilo, conexão, imagem e mídia às estritamente necessárias (Supabase, `cdnjs.cloudflare.com` para `html2canvas`, e o próprio domínio).
- **X-Frame-Options: DENY** e `frame-ancestors 'none'` — impede que o site seja embutido em iframe de terceiros (proteção contra clickjacking).
- **X-Content-Type-Options: nosniff** — impede que o navegador reinterprete o tipo de arquivos servidos.
- **Referrer-Policy** e **Permissions-Policy** restritivas, desabilitando APIs sensíveis não usadas (câmera, microfone, geolocalização).
- Cache diferenciado: HTML sempre revalidado (`no-cache`), assets estáticos (`css/`, `js/`, `img/`) com cache curto e revalidação — evitando tanto conteúdo desatualizado quanto sobrecarga desnecessária.

> **Nota conhecida:** o CSP atual permite `'unsafe-inline'` em `script-src`/`style-src`, necessário porque partes do front-end usam scripts e estilos inline sem nonce. Isso reduz parcialmente a proteção do CSP contra XSS. Recomenda-se, como evolução futura, migrar esse código inline para arquivos externos e remover `'unsafe-inline'`.

---

## Row Level Security (RLS)

Todas as tabelas com dados de colaboradores têm RLS habilitado no Postgres. Em particular:

- `colaboradores_referencia` **não tem política de escrita para usuários autenticados comuns** — só é gravável via `service_role` (dentro de Edge Functions) ou por funções `SECURITY DEFINER` explicitamente controladas (`buscar_cargo_por_nome`, `atualizar_referencia_por_nome`).
- `profiles` permite que o próprio colaborador leia/atualize seus dados básicos, e que administradores tenham acesso mais amplo, validado a cada operação sensível pelas Edge Functions.
- `activity_logs` é somente-inserção pelo fluxo normal da aplicação, preservando a integridade do histórico de auditoria.

---

## Auditoria

Toda ação relevante do sistema é registrada em `activity_logs`, incluindo:

- Login (com diff de quaisquer dados que mudaram desde o acesso anterior)
- Cadastro de novo colaborador
- Atualização de perfil (com valores "de" e "para" de cada campo alterado)
- Reset de senha
- Ativação/desativação de conta
- Conclusão do primeiro acesso

Cada registro guarda **quem executou a ação** (`executado_por`) e **quando**, viabilizando rastreabilidade completa para investigação de incidentes.

---

## Boas práticas de desenvolvimento

- **Nunca** commitar chaves, senhas ou tokens no repositório.
- **Nunca** copiar `SUPABASE_SERVICE_ROLE_KEY` para código de front-end.
- Toda nova Edge Function deve revalidar `is_admin` (ou a permissão equivalente) no próprio servidor, independentemente do que o front-end já tenha verificado.
- Erros vindos de Edge Functions devem ser tratados extraindo a mensagem real do corpo da resposta (não confiar apenas em `error.message` do client do Supabase, que costuma ser genérico) — evita mascarar falhas de segurança ou de negócio durante o debug.
- Ao adicionar campos que armazenam dados pessoais, avaliar se isso exige atualização do aviso de consentimento (LGPD) exibido no login.

---

## Limitações conhecidas

- CSP com `'unsafe-inline'` (ver seção de rede acima).
- Ausência de autenticação multifator (MFA) — recomendável para contas administrativas, como evolução futura.
- Ausência de rate limiting customizado além do que o Supabase Auth já aplica nativamente contra força bruta.

---

## Como reportar uma vulnerabilidade

Se você identificar uma vulnerabilidade de segurança neste sistema:

1. **Não** abra uma issue pública no repositório.
2. Reporte diretamente ao responsável técnico: Gabriel Victor Barreto de Oliveira, pelos canais internos da instituição.
3. Descreva o problema com o máximo de detalhe possível (passos para reproduzir, impacto potencial, dados que poderiam ser expostos).
4. Aguarde confirmação de recebimento antes de divulgar a informação por qualquer outro canal.

Dado que este é um sistema em produção usado por colaboradores de um hospital, vulnerabilidades que envolvam exposição de dados pessoais ou acesso não autorizado devem ser tratadas como **prioridade máxima**.

---

*Hospital Estadual Mário Covas — Fundação do ABC*
