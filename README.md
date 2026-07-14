# Assina.ai — HEMC

Sistema institucional de geração e gestão de assinaturas de e-mail do **Hospital Estadual Mário Covas (HEMC)**, mantido pela FUABC. Permite que colaboradores gerem sua própria assinatura oficial em segundos, com identidade visual padronizada, e oferece a administradores um painel completo de gestão de acessos, cadastros e auditoria.

> **Status:** em produção. Este projeto atende usuários reais do hospital — qualquer alteração em produção deve ser testada localmente antes do deploy (veja [Ambiente local](#ambiente-local)).

---

## Índice

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Stack técnica](#stack-técnica)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Pré-requisitos](#pré-requisitos)
- [Como clonar e configurar](#como-clonar-e-configurar)
- [Banco de dados (Supabase)](#banco-de-dados-supabase)
- [Edge Functions](#edge-functions)
- [Ambiente local](#ambiente-local)
- [Deploy (Vercel)](#deploy-vercel)
- [Versionamento](#versionamento)
- [Segurança](#segurança)
- [Suporte](#suporte)

---

## Visão geral

O Assina.ai resolve um problema simples e recorrente em qualquer instituição grande: garantir que **todo colaborador use a mesma identidade visual de e-mail**, sem depender de cada pessoa montar sua própria assinatura manualmente (e errar fonte, cor, cargo ou logo).

O sistema tem duas frentes:

- **Colaborador**: faz login com e-mail institucional, tem nome/cargo/setor/e-mail/ramal preenchidos automaticamente a partir do cadastro de RH, e gera sua assinatura em PNG pronta para colar no Outlook ou Skymail.
- **Administrador**: gerencia todos os colaboradores (ativar/desativar, resetar senha, editar dados, cadastrar novos), acompanha um log de auditoria completo de tudo que acontece no sistema, e cadastra colaboradores que ainda não têm acesso.

---

## Funcionalidades

### Colaborador (`index.html` → `gerador.html`)
- Login com e-mail institucional (`@hemc.fuabc.org.br`) e validação automática de nome/cargo contra a base de RH.
- Redefinição de senha obrigatória no primeiro acesso.
- Tour interativo guiado no primeiro uso do gerador (spotlight + tooltips), marcado como concluído permanentemente após visto.
- Geração de assinatura em PNG de alta resolução (via `html2canvas`), com campos fixos (nome, cargo, e-mail, ramal — vindos do cadastro) e campos editáveis (hospital, endereço).
- Central de ajuda com vídeos tutoriais (Outlook, Skymail), catálogo de contatos institucional para importar no Outlook, e guia de configuração IMAP para celular.
- Vídeo de abertura institucional (uma única vez, com opção de pular) e transição animada ("cofre") ao entrar no sistema.
- Banner de consentimento de uso de dados (LGPD) e alternância de tema claro/escuro.

### Administrador (`login-admin.html` → `admin.html`)
- Dashboard com cards de status (Total, Ativos, Inativos, Pendentes de 1º acesso, Ações nas últimas 24h) que funcionam como filtros clicáveis.
- Tabela de colaboradores com busca, filtro por setor, ordenação por coluna e paginação.
- Ações por colaborador: editar dados, resetar senha (com senha definida manualmente pelo admin), ativar/desativar, gerar assinatura em nome do colaborador.
- Cadastro de novos colaboradores em dois modos: **Base de Referência** (só habilita o autocadastro do colaborador) ou **Acesso Completo** (já cria e-mail + senha inicial).
- Linha do tempo de atividades (login, cadastro, alterações de perfil, resets de senha, ativações/desativações) com diffs detalhados de cada alteração e exportação em CSV.
- Sincronização automática de cargo/setor com a base de referência da planilha de RH sempre que um admin corrige esses dados.
- Tempo real (Supabase Realtime): mudanças em outros dispositivos aparecem sem precisar recarregar a página.

---

## Arquitetura

```
┌─────────────────┐        ┌──────────────────────┐        ┌────────────────────┐
│   Navegador      │        │   Vercel (estático)   │        │  Supabase (backend)  │
│  (colaborador/   │◄──────►│  index.html            │        │                      │
│   administrador) │        │  login-admin.html      │        │  Auth (usuários)     │
│                  │        │  admin.html            │◄──────►│  Postgres (dados)    │
│                  │        │  gerador.html           │        │  Edge Functions      │
│                  │        │  css/ js/ img/          │        │  Realtime            │
└─────────────────┘        └──────────────────────┘        └────────────────────┘
```

- **Front-end**: HTML/CSS/JS puro (sem framework, sem bundler) — cada página é um arquivo `.html` autocontido, com seu próprio `<script type="module">`.
- **Autenticação**: Supabase Auth (e-mail + senha). O front-end nunca vê a senha de outros usuários; resets e cadastros passam por Edge Functions com `service_role`.
- **Dados**: Postgres gerenciado pelo Supabase, com Row Level Security (RLS) habilitado nas tabelas sensíveis.
- **Lógica privilegiada**: isolada em três Edge Functions independentes (ver [Edge Functions](#edge-functions)) — cada uma com responsabilidade única, para que uma alteração numa não arrisque quebrar as outras.
- **Hospedagem**: Vercel, com cabeçalhos de segurança (CSP, HSTS, X-Frame-Options) e política de cache configurados via `vercel.json`.

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Front-end | HTML5, CSS3, JavaScript (ES Modules, sem framework) |
| Geração de imagem | [html2canvas](https://html2canvas.hertzen.com/) (via CDN) |
| Backend / Auth / DB | [Supabase](https://supabase.com) (Postgres + Auth + Edge Functions + Realtime) |
| Edge Functions | Deno (TypeScript) |
| Hospedagem | [Vercel](https://vercel.com) |
| Controle de versão | Git |

---

## Estrutura do projeto

```
assinaturas-hemc/
├── index.html                  # Login do colaborador
├── login-admin.html            # Login do administrador
├── admin.html                  # Painel administrativo
├── gerador.html                # Gerador de assinatura
├── vercel.json                 # Headers de segurança, cache e rewrites
│
├── css/
│   ├── base.css                 # Variáveis de tema, componentes globais (btn, toggle)
│   ├── login.css                # Telas de login (colaborador + admin)
│   ├── admin.css                # Painel administrativo
│   └── gerador.css              # Gerador de assinatura
│
├── js/
│   ├── supabaseClient.js        # Cliente Supabase + helpers de sessão/autenticação
│   ├── auth.js                  # Lógica de login do colaborador
│   ├── admin.js                 # Lógica do painel administrativo
│   └── gerador.js               # Lógica do gerador de assinatura + tour
│
├── img/
│   ├── logo_assina.png
│   ├── background.png                            # Imagem de fundo do login
│   ├── video_background.mp4                      # Vídeo de abertura
│   ├── configuracao_assinatura_outlook.mp4        # Tutorial Outlook
│   ├── configuracao_assinatura_skymail.mp4        # Tutorial Skymail
│   └── catalogo_outlook.csv                       # Catálogo de contatos (gerado via SQL)
│
└── supabase/
    └── functions/
        ├── admin-manage-user/           # Listagem, reset de senha, ativar/desativar, editar perfil
        ├── admin-sync-referencia/       # Sincroniza cargo/setor com a base de RH
        └── admin-cadastrar-colaborador/ # Cadastro de novos colaboradores
```

---

## Pré-requisitos

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 18+ (necessário apenas para rodar a CLI da Vercel/Supabase localmente)
- Conta no [Supabase](https://supabase.com) com acesso ao projeto do HEMC
- Conta na [Vercel](https://vercel.com) com acesso ao projeto do HEMC
- (Opcional, recomendado) [Vercel CLI](https://vercel.com/docs/cli) e [Supabase CLI](https://supabase.com/docs/guides/cli) instaladas

---

## Como clonar e configurar

### 1. Clonar o repositório

```bash
git clone https://github.com/Barreto0620/Assinaturas_HEMC.git
cd Assinaturas_HEMC
```

### 2. Configurar o cliente Supabase

O projeto não usa variáveis de ambiente no front-end (é HTML/JS estático, sem build step) — a URL e a chave pública (`anon key`) do Supabase ficam diretamente em `js/supabaseClient.js`. Confirme que esse arquivo aponta para o projeto Supabase correto:

```javascript
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "sua-anon-key-publica";
```

> A `anon key` é uma chave **pública** por design (protegida por Row Level Security no banco) — não é um segredo. A chave sensível (`service_role`) nunca aparece no front-end; ela só existe dentro das Edge Functions.

### 3. Instalar as CLIs (se ainda não tiver)

```bash
# Vercel CLI
npm install -g vercel

# Supabase CLI (via Scoop no Windows)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

### 4. Autenticar e vincular os projetos

```bash
vercel login
vercel link

supabase login
supabase link --project-ref SEU_PROJECT_REF
```

---

## Banco de dados (Supabase)

Tabelas principais:

| Tabela | Descrição |
|---|---|
| `auth.users` | Gerenciada pelo Supabase Auth — fonte de verdade de quem tem conta criada. |
| `profiles` | Dados do colaborador após o 1º acesso: nome, cargo, setor, RE, telefone, status (`ativo`), controle de primeiro acesso e senha. |
| `colaboradores_referencia` | Base de RH (planilha institucional): RE, nome, cargo, setor, departamento — usada para validar nome/cargo no login. |
| `activity_logs` | Auditoria de todas as ações do sistema (login, cadastro, edições, resets, ativações). |
| `logs_assinatura` | Registro de cada geração de assinatura. |

Funções e triggers relevantes (Postgres):
- `buscar_cargo_por_nome(nome)` — valida o nome digitado no login contra `colaboradores_referencia` e retorna cargo, setor e RE. `SECURITY DEFINER`, com permissão de execução para `anon` (necessário, pois roda antes do login).
- `atualizar_referencia_por_nome(...)` — usada pela Edge Function de sincronização como *fallback* quando o colaborador não tem RE preenchido.
- `titulo_pt(texto)` — normaliza texto para Title Case em português (usada na padronização do campo "setor").

> As migrações SQL aplicadas ao longo do desenvolvimento não estão versionadas num diretório `migrations/` formal neste projeto — recomenda-se criar um a partir daqui para novas alterações de schema, usando `supabase migration new <nome>`.

---

## Edge Functions

Cada Edge Function tem responsabilidade única e é publicada de forma independente — isso é proposital, para que uma alteração numa nunca arrisque derrubar as outras.

| Function | Responsabilidade |
|---|---|
| `admin-manage-user` | Listar colaboradores (cruzando Auth + profiles), resetar senha, ativar/desativar, atualizar perfil. |
| `admin-sync-referencia` | Propaga cargo/setor corrigidos no painel de volta para `colaboradores_referencia`, para refletir no login. |
| `admin-cadastrar-colaborador` | Cadastra novos colaboradores (base de referência apenas, ou acesso completo com conta criada). |

### Deploy de uma Edge Function

```bash
supabase functions deploy admin-manage-user
supabase functions deploy admin-sync-referencia
supabase functions deploy admin-cadastrar-colaborador
```

### Variáveis de ambiente necessárias (definidas automaticamente pelo Supabase em cada função)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Não é necessário configurar nada manualmente — essas variáveis já ficam disponíveis para qualquer Edge Function do projeto.

---

## Ambiente local

Como o projeto é 100% estático (sem build step), rodar localmente é simples:

```bash
vercel dev
```

Isso sobe o site em `http://localhost:3000`, aplicando os mesmos headers definidos em `vercel.json` — importante para testar mudanças de CSP/cache antes de publicar em produção.

Para testar Edge Functions localmente:

```bash
supabase functions serve admin-manage-user
```

---

## Deploy (Vercel)

O deploy é automático a cada push na branch principal (configuração padrão da Vercel via integração com o Git). Para publicar manualmente:

```bash
vercel --prod
```

**Antes de qualquer deploy em produção:**
1. Teste localmente com `vercel dev`.
2. Confirme que nenhuma Edge Function foi alterada sem deploy correspondente (`supabase functions deploy <nome>`).
3. Verifique no console do navegador se não há erros de CSP, 404 de assets ou falhas de autenticação.

---

## Versionamento

Este projeto ainda não segue [Versionamento Semântico](https://semver.org/lang/pt-BR/) formal, mas recomenda-se adotar a partir daqui, já que o sistema está em produção com usuários reais:

- **MAJOR**: mudanças que quebram compatibilidade (ex.: nova estrutura de tabela sem migração automática).
- **MINOR**: novas funcionalidades retrocompatíveis (ex.: novo card de ajuda, novo modo de cadastro).
- **PATCH**: correções de bugs (ex.: ajuste de CSS, correção de mensagem de erro).

Recomenda-se manter um `CHANGELOG.md` a partir da próxima alteração relevante, registrando o que mudou, por quê, e se exigiu migração de banco ou deploy de Edge Function.

---

## Segurança

Consulte o arquivo [`SECURITY.md`](./SECURITY.md) para a política completa de segurança, dados tratados, gestão de segredos e conformidade com a LGPD.

---

## Suporte

- **Chamados de TI (colaboradores)**: [GLPI](http://chamados.fuabc.local/glpi)
- **Desenvolvimento**: Gabriel Victor Barreto de Oliveira ([GitHub](https://github.com/Barreto0620))

---

*Hospital Estadual Mário Covas — Fundação do ABC*
