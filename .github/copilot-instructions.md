# Copilot Instructions For gateway-chat-platform

## Control-plane ownership

This repo does **not** own its full production runtime contract. The source of truth for deployment wiring is the `gateway-control-plane` repo and the live `gateway.config.json` on the gateway host.

When making changes here, assume the following are controlled externally by `gateway-control-plane`:

- public hostname and route exposure
- blue/green slot selection and promotion
- generated host nginx config
- env file paths and shared data directory paths
- deploy roots plus docker start/stop commands
- service-profile agent sync from the control-plane admin UI
- GitHub Actions deploy execution on the self-hosted gateway runner

Do not make silent production topology changes here without coordinating a matching control-plane update.

## Current production shape

The production stack is a blue/green Docker deployment containing:

- `chat-api`
- `chat-ui`
- internal nginx for `/api/*` and `/`

Operational assumptions currently used by `gateway-control-plane`:

- The app is mounted publicly either at a dedicated hostname root like `chat.luli-gateway` or at the shared fallback route `/chat/`.
- Control-plane service-profile calls target the chat API through the gateway host.
- The deploy smoke test currently relies on a stable, cheap endpoint and may use `/api/agents` as readiness.
- `CHAT_API_ENV_FILE` and `CHAT_API_DATA_DIR` are part of the deploy contract.

## Agent ownership rules

Configured agents are owned by `gateway-control-plane`.

Important expectations:

- Do not seed example/default agents in production startup.
- The control-plane's configured agents should be the only agents visible after sync unless someone intentionally creates agents through the management API.
- Bulk sync from the control-plane is expected to reconcile the full configured agent set.
- Agent schema changes must be coordinated with the control-plane admin UI and config validation.

## Endpoints the control-plane depends on

Keep these stable unless `gateway-control-plane` is updated in lockstep:

- `GET /api/providers/status`
- `GET /api/providers/:name/models`
- `GET /api/agents`
- `POST /api/agents/:id/run`
- `GET /api/agents/manage`
- `GET /api/agents/manage/:id`
- `POST /api/agents/manage`
- `PUT /api/agents/manage/:id`
- `DELETE /api/agents/manage/:id`
- `POST /api/agents/manage/sync`
- any endpoint used as deploy readiness/health

## Changes that require a control-plane follow-up

If you change any of the following, update `gateway-control-plane` config/docs/admin UI in the same change set or note it explicitly in the PR:

- agent config schema
- provider config names or model listing behavior
- management API request/response shapes
- readiness or health endpoint behavior
- Dockerfile or docker-compose startup contract
- env var names or required files
- nginx path behavior or root/base-path assumptions
- UI hosting assumptions for hostname-root vs `/chat/` path mounting

## Development guidance

Prefer changes that preserve both:

- clean local development (`pnpm dev`, local API/UI ports)
- the production control-plane deploy contract

If you change something operational, document exactly what `gateway-control-plane` must change to stay compatible.
