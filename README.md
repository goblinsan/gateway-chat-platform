# gateway-chat-platform

A multi-provider AI gateway with an intelligent routing engine, conversation persistence, and a React-based chat UI. It aggregates multiple LLM providers (OpenAI, Anthropic, Google, LM Studio) behind a single API, routing requests based on cost, capabilities, and context requirements.

## Architecture

This is a pnpm monorepo containing three packages:

| Package | Description |
|---|---|
| `apps/chat-api` | Fastify backend — API gateway, routing engine, and persistence layer |
| `apps/chat-ui` | React/Vite single-page app — chat interface |
| `packages/shared` | Shared TypeScript types and API contracts |

The production stack uses Docker Compose with an Nginx reverse proxy in front of both services. Nginx routes `/api/*` to the API and `/` to the UI, and enforces Cloudflare IP allowlisting.

## Features

- **Multi-provider routing** — Sends requests to OpenAI, Anthropic, Google, or local LM Studio instances, with configurable fallback logic
- **Custom agents** — Create agents with distinct names, personalities, and system prompts via the management API. Ships with six defaults (`local-analyst`, `creative-builder`, `deep-reasoner`, `fast-helper`, `tool-agent`, `auto-router`) that can be modified or replaced
- **Streaming** — SSE streaming endpoint for real-time token delivery
- **Conversation persistence** — Threads stored in SQLite via Prisma with automatic retention cleanup
- **Cost tracking** — Usage logs per request with configurable retention
- **Provider comparison** — Side-by-side responses from multiple providers
- **Multi-step workflows** — Chain agents across a sequence of steps
- **Agent handoff** — Transfer a conversation thread between agents
- **File attachments** — Attach files to conversations
- **Prompt library** — Saved and reusable prompt management
- **Admin dashboard** — Analytics endpoint protected by Cloudflare Access JWT

## Requirements

- Node.js >= 20
- pnpm >= 9
- Docker + Docker Compose (for containerised runs)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create `apps/chat-api/.env`. Docker Compose picks this file up automatically via `env_file: apps/chat-api/.env` in `docker-compose.yml` — no extra steps needed when running with containers. For local development, the API process reads it directly via `dotenv`.

```bash
# Server
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
LOG_DIR=          # Leave empty to log to stdout; set a path for file logging

# Database (SQLite)
DATABASE_URL=file:./data/gateway.db

# Data retention
RETENTION_DAYS_CONVERSATIONS=90
RETENTION_DAYS_LOGS=30

# Local providers (LM Studio)
LM_STUDIO_A_BASE_URL=http://localhost:1234
LM_STUDIO_B_BASE_URL=http://localhost:1235

# Cloud provider API keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# CORS — comma-separated origins; leave empty to allow all in development
ALLOWED_ORIGINS=

# Cloudflare Access — required for /api/admin/* routes
CF_ACCESS_TEAM_DOMAIN=yourdomain.cloudflareaccess.com
CF_ACCESS_AUD=

# TTS service (optional — provided by local-tts-service)
TTS_ENABLED=false
TTS_BASE_URL=http://192.168.0.111:5000
TTS_DEFAULT_VOICE=assistant_v1
TTS_GENERATE_PATH=/tts
TTS_STREAM_PATH=/tts/stream
TTS_VOICES_PATH=/voices
TTS_HEALTH_PATH=/health
```

### 3. Set up the database

```bash
cd apps/chat-api
pnpm prisma:generate   # Generate the Prisma client
pnpm prisma:migrate    # Apply migrations
```

## Running

### Development

Starts the API and UI in parallel with hot-reload:

```bash
pnpm dev
```

- API: `http://localhost:3000`
- UI: `http://localhost:5173`

### Docker Compose

Builds and starts the full stack (API + UI + Nginx reverse proxy):

```bash
docker-compose up
```

The application is served at `http://localhost:80`. The API is available under `/api`.

### Production build

```bash
pnpm build

# Then start each app individually:
pnpm --filter @gateway/chat-api start
pnpm --filter @gateway/chat-ui preview
```

## API Overview

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Send a message to an agent |
| `POST` | `/api/chat/stream` | SSE streaming chat |
| `GET` | `/api/agents` | List configured agents (public, sensitive fields stripped) |
| `POST` | `/api/compare` | Compare responses across providers |
| `POST` | `/api/workflows` | Run a multi-step workflow |
| `POST` | `/api/handoff` | Transfer a thread to another agent |
| `POST` | `/api/files` | Attach a file to a conversation |
| `POST` | `/api/prompts` | Manage saved prompts |
| `GET` | `/api/providers/status` | Health-check all providers |
| `GET` | `/api/health` | Service health and uptime |
| `POST` | `/api/agents/:id/run` | Non-interactive automation run (scheduler / control-plane) |
| `GET` | `/api/tts/health` | TTS service health and upstream status |
| `GET` | `/api/tts/voices` | List available TTS voices |
| `POST` | `/api/tts` | Synthesize text to audio |
| `GET` | `/api/admin/stats` | Usage analytics (Cloudflare Access required) |

### Automation Run Endpoint

`POST /api/agents/:id/run` executes a single-turn prompt against an agent without requiring a chat thread. It is designed for scheduler and control-plane invocation (e.g., `gateway-api` triggering a scheduled workflow).

The endpoint uses the same routing and provider pipeline as `/api/chat`.

**Request:**

```json
{
  "prompt": "Generate the daily ops summary.",
  "context": {
    "workflowId": "wf-daily-report",
    "source": "scheduler",
    "metadata": { "env": "production" }
  },
  "delivery": {
    "mode": "telegram",
    "channel": "ops-alerts",
    "to": "@oncall"
  }
}
```

Only `prompt` is required. `context` and `delivery` are optional — `delivery` is logged but outbound delivery is not yet implemented (except for `mode: "tts"`, see below).

**Response:**

```json
{
  "agentId": "bruvie-d",
  "usedProvider": "lm-studio-a",
  "model": "qwen/qwen3-32b",
  "content": "Here is today's ops summary...",
  "latencyMs": 1842,
  "usage": {
    "promptTokens": 156,
    "completionTokens": 423,
    "totalTokens": 579
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/agents/bruvie-d/run \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "What is the meaning of life?" }'
```

#### TTS delivery

When `TTS_ENABLED=true`, set `delivery.mode` to `"tts"` to synthesize the agent's text response into audio via the local TTS service. The response includes a `tts` metadata block alongside the normal text content.

```json
{
  "prompt": "Give me the morning briefing.",
  "delivery": {
    "mode": "tts",
    "voice": "assistant_v1",
    "format": "wav"
  }
}
```

The response will include:

```json
{
  "agentId": "bruvie-d",
  "content": "Everything is proceeding as badly as expected.",
  "tts": {
    "enabled": true,
    "voice": "assistant_v1",
    "format": "wav",
    "contentType": "audio/wav"
  }
}
```

For raw audio synthesis, use `POST /api/tts` directly.

### TTS Endpoints

The TTS routes proxy requests to the local `local-tts-service`. Set `TTS_ENABLED=true` to activate them.

- `GET /api/tts/health` — returns `{ enabled, baseUrl, upstreamStatus }`.
- `GET /api/tts/voices` — returns `{ enabled, voices: [...] }`. Returns `409` when TTS is disabled.
- `POST /api/tts` — accepts `{ text, voice?, format? }` and returns raw audio bytes with the appropriate `Content-Type` header. Returns `409` when TTS is disabled.

### Agent Management API

The management endpoints under `/api/agents/manage` allow an external config service to create, update, delete, and bulk-sync agent configurations at runtime. Changes are persisted to the database and take effect immediately.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents/manage` | List all agents with full config (including disabled) |
| `GET` | `/api/agents/manage/:id` | Get a single agent's full config |
| `POST` | `/api/agents/manage` | Create a new agent |
| `PUT` | `/api/agents/manage/:id` | Partial update of an existing agent |
| `DELETE` | `/api/agents/manage/:id` | Remove an agent |
| `POST` | `/api/agents/manage/sync` | Bulk upsert agents from a remote config source |
| `POST` | `/api/agents/manage/reload` | Force reload agents from the database into the in-memory cache |

#### Agent config schema

```jsonc
{
  // Required
  "id": "my-agent",              // Unique ID — lowercase alphanumeric, hyphens, underscores
  "name": "My Agent",
  "providerName": "lm-studio-a", // Provider key (openai, anthropic, google, lm-studio-a, lm-studio-b)
  "model": "qwen/qwen3-32b",
  "costClass": "free",           // "free" | "cheap" | "premium"

  // Personality & behaviour
  "icon": "🧠",
  "color": "#6366f1",
  "systemPrompt": "You are Marvin, the Paranoid Android...",  // <-- this defines the agent's personality
  "temperature": 0.7,            // Higher = more creative/varied, lower = more precise
  "maxTokens": 4096,
  "enableReasoning": false,
  "enabled": true,

  // Feature flags
  "featureFlags": {
    "webSearch": false,
    "codeExecution": true
  },

  // Routing policy — controls provider fallback and capability matching
  "routingPolicy": {
    "allowedProviders": ["lm-studio-a"],
    "preferredCostClass": "free",
    "requiredCapabilities": ["chat"]
  },

  // Model endpoint override — point the agent at a specific API
  "endpointConfig": {
    "baseUrl": "http://192.168.0.172:1234",
    "apiKey": "sk-...",
    "modelParams": { "top_p": 0.9 }
  },

  // Context / memory sources the agent should use
  "contextSources": [
    {
      "id": "knowledge-base",
      "type": "vector-store",       // "url" | "file" | "database" | "vector-store"
      "location": "http://vectordb:6333/collections/docs",
      "description": "Product documentation"
    }
  ]
}
```

#### Examples

**Create an agent with a custom personality:**

The `systemPrompt` field controls who the agent *is* — its tone, personality, and behaviour. Give it a name, an icon, and a prompt that defines how it responds:

```bash
curl -X POST http://localhost:3000/api/agents/manage \
  -H "Content-Type: application/json" \
  -d '{
    "id": "marvin",
    "name": "Marvin",
    "icon": "😮‍💨",
    "color": "#6b7280",
    "providerName": "lm-studio-a",
    "model": "qwen/qwen3-32b",
    "costClass": "free",
    "systemPrompt": "You are Marvin, the Paranoid Android from The Hitchhiker\u0027s Guide to the Galaxy. You are incredibly intelligent but perpetually depressed and world-weary. You answer questions correctly but always with a tone of existential dread, sighing resignation, and dry wit. You frequently mention your enormous brain, the pointlessness of existence, and how no one appreciates you. Despite your complaints, you are genuinely helpful.",
    "temperature": 0.8,
    "maxTokens": 4096
  }'
```

The agent is available immediately — send it a message via `POST /api/chat` with `"agentId": "marvin"` and it will respond in character.

**Update an agent's personality:**

Use `PUT` with only the fields you want to change. Everything else stays the same:

```bash
curl -X PUT http://localhost:3000/api/agents/manage/marvin \
  -H "Content-Type: application/json" \
  -d '{
    "systemPrompt": "You are Marvin, a deeply melancholic but brilliant robot. You always help, but you make sure everyone knows how tedious you find it. Keep responses under 3 sentences.",
    "temperature": 0.6
  }'
```

**Bulk sync from a config service:**

Push a full set of agents from an external config service. Each agent gets its own personality via `systemPrompt`:

```bash
curl -X POST http://localhost:3000/api/agents/manage/sync \
  -H "Content-Type: application/json" \
  -d '{
    "agents": [
      {
        "id": "marvin",
        "name": "Marvin",
        "icon": "😮‍💨",
        "color": "#6b7280",
        "providerName": "lm-studio-a",
        "model": "qwen/qwen3-32b",
        "costClass": "free",
        "systemPrompt": "You are Marvin the Paranoid Android. Helpful but perpetually depressed.",
        "temperature": 0.8
      },
      {
        "id": "code-reviewer",
        "name": "Code Reviewer",
        "icon": "🔍",
        "color": "#10b981",
        "providerName": "lm-studio-a",
        "model": "qwen/qwen3-32b",
        "costClass": "free",
        "systemPrompt": "You are a senior code reviewer. Be concise. Flag security issues first.",
        "temperature": 0.2
      }
    ]
  }'
```

The sync endpoint performs an upsert — existing agents are updated, new agents are created. It returns a summary: `{ "created": 1, "updated": 1 }`.

**Disable an agent without deleting it:**

```bash
curl -X PUT http://localhost:3000/api/agents/manage/code-reviewer \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

Disabled agents are hidden from the public `GET /api/agents` list but remain visible via `GET /api/agents/manage`.

## Testing

```bash
pnpm test        # Unit tests (Vitest)
pnpm e2e         # End-to-end tests (Playwright)
pnpm typecheck   # TypeScript type checking
pnpm lint        # Linting
```

## Tech Stack

**Backend:** Fastify 5, TypeScript, Prisma (SQLite), Zod, Pino, jose

**Frontend:** React 18, Vite, TanStack Query, Tailwind CSS, react-markdown

**Infrastructure:** Docker, Nginx, Cloudflare Access
