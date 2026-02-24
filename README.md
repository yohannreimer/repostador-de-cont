# Authority Distribution Engine

Monorepo inicial do **Authority Distribution Engine** baseado no PRD técnico enviado, com foco em Sprint 1 + Sprint 2:

- `apps/api`: API Node.js (Express + TypeScript) com upload `.srt/.txt`, parser, timeline de jobs e geração textual Sprint 2.
- `apps/web`: Next.js App Router com fluxo de criação de projeto, upload, status e tabs de outputs.
- `packages/shared`: contratos de tipos compartilhados.
- `db/schema.sql`: modelo PostgreSQL alinhado ao PRD.

## Estrutura

```text
apps/
  api/
  web/
packages/
  shared/
db/
  schema.sql
```

## Requisitos

- Node.js 20+
- npm 10+
- (opcional nesta fase) Redis e PostgreSQL via `docker-compose`

## Setup

```bash
npm install
cp .env.example .env
```

Suba dependências opcionais:

```bash
docker compose up -d
```

## Rodar backend e frontend

```bash
npm run dev -w apps/api
npm run dev -w apps/web
```

- API: `http://localhost:4000`
- Web: `http://localhost:3000`

## Endpoints implementados (Sprint 1 + Sprint 2)

- `GET /health`
- `POST /projects`
- `GET /projects`
- `GET /projects/:id/history`
- `POST /projects/:id/srts` (multipart, campo `file`, aceita `.srt` e `.txt` com conteúdo SRT)
- `GET /srts/:id`
- `POST /srts/:id/run`
- `GET /srts/:id/jobs`
- `GET /srts/:id/assets`
- `GET /srts/:id/assets/:type` (`analysis|reels|newsletter|linkedin|x|carousel|covers`)
- `GET /ai/routing`
- `PATCH /ai/routing`
- `GET /ai/preferences`
- `PATCH /ai/preferences`
- `GET /ai/models?provider=openai|openrouter`
- `GET /ai/prompts`
- `POST /ai/prompts/:task/versions`
- `PATCH /ai/prompts/:task/activate`

## Exemplo rápido (curl)

```bash
curl -X POST http://localhost:4000/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Authority Sprint 1"}'

curl -X POST http://localhost:4000/projects/<PROJECT_ID>/srts \
  -F 'file=@/caminho/arquivo.srt'
```

## Observações de arquitetura atual

- Fila: implementação local assíncrona (`setImmediate`) para destravar desenvolvimento inicial.
- Persistência de IA: `memory` por padrão, com opção de `postgres` para roteamento, prompts e preferências.
- Histórico de runs: store em memória com snapshot persistido em `app_store_snapshots` quando `AI_PERSISTENCE_BACKEND=postgres` (hidrata no boot e sobrevive restart).
- Roteamento por etapa para IA (`analysis`, `reels`, `newsletter`, `linkedin`, `x`) com `OpenAI`, `OpenRouter` ou fallback `heuristic`.
- Schema Postgres já está definido em `db/schema.sql` para migração no Sprint 2.

## Controle de provider/modelo por etapa

O pipeline aceita configuração por `.env` e também em runtime:

```bash
curl -X PATCH http://localhost:4000/ai/routing \
  -H 'Content-Type: application/json' \
  -d '{
    "analysis": { "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.2 },
    "reels": { "provider": "openrouter", "model": "anthropic/claude-3.5-sonnet", "temperature": 0.4 }
  }'
```

Consulta atual:

```bash
curl http://localhost:4000/ai/routing
```

O frontend inclui painel para editar roteamento por tarefa.
Ao selecionar `openai` ou `openrouter`, o campo de modelo recebe lista dinâmica (autocomplete) com catálogo do provider.

## Versionamento de prompts por tarefa

Cada tarefa (`analysis`, `reels`, `newsletter`, `linkedin`, `x`) possui versões de prompt (`systemPrompt` + `userPromptTemplate`) com ativação de versão.

Consultar catálogo atual:

```bash
curl http://localhost:4000/ai/prompts
```

Criar nova versão e ativar:

```bash
curl -X POST http://localhost:4000/ai/prompts/analysis/versions \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "analysis-v2",
    "systemPrompt": "Voce e estrategista senior de conteudo B2B. Responda apenas JSON.",
    "userPromptTemplate": "Analise a transcricao: {{transcript_excerpt}}",
    "activate": true
  }'
```

Ativar versão específica:

```bash
curl -X PATCH http://localhost:4000/ai/prompts/analysis/activate \
  -H 'Content-Type: application/json' \
  -d '{"version":1}'
```

O frontend também inclui painel para listar versões, criar nova versão e ativar.

## Persistência em Postgres (roteamento + prompts + preferências + histórico)

Por padrão, o modo é em memória. Para persistir em Postgres:

1. Configure `DATABASE_URL` válido.
2. Defina `AI_PERSISTENCE_BACKEND=postgres`.
3. Reinicie a API.

Se o Postgres estiver indisponível, o backend mantém fallback em memória sem derrubar o pipeline.

## Deploy no Portainer (stack completo)

Arquivos prontos para deploy:

- `Dockerfile` (targets `api` e `web`)
- `docker-compose.portainer.yml`
- `.dockerignore`

### 1. Pré-requisitos

1. Suba seu código para um repositório Git (GitHub/GitLab).
2. Garanta que `.env` no servidor tenha as chaves reais:
   - `OPENAI_API_KEY` e/ou `OPENROUTER_API_KEY`
   - `NEXT_PUBLIC_API_URL` apontando para a URL pública da API (ex.: `https://api.seudominio.com`)
   - `AI_PERSISTENCE_BACKEND=postgres`

### 2. Criar stack no Portainer

1. Abra Portainer -> `Stacks` -> `Add stack`.
2. Nome: `authority-engine`.
3. Escolha `Repository` e aponte para seu repositório.
4. Em `Compose path`, use `docker-compose.portainer.yml`.
5. Em `Environment variables`, sobrescreva se necessário:
   - `NEXT_PUBLIC_API_URL`
   - `OPENROUTER_HTTP_REFERER`
   - `OPENAI_API_KEY`
   - `OPENROUTER_API_KEY`
6. Clique `Deploy the stack`.

### 3. Portas e serviços

- Web: `3000`
- API: `4000`
- Postgres: volume `pgdata`
- Redis: volume `redisdata`
- Uploads/exports API: volumes `api_uploads` e `api_exports`

### 4. Pós deploy

1. Health API: `GET /health`
2. Teste rápido:
   - criar projeto
   - upload de SRT/TXT
   - validar aba `Historico` após reiniciar stack (dados devem continuar)

## Próximos passos sugeridos

1. Trocar store in-memory por repositórios Postgres reais.
2. Integrar BullMQ + Redis como executor real de jobs.
3. Evoluir avaliação de qualidade por canal (A/B por versão de prompt e provider).
4. Incluir autenticação (`/auth/login`, `/me`) e multi-tenant por usuário.
