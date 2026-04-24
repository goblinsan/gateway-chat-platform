# Agent-Service Integration

This document describes how `gateway-chat-platform` delegates execution to the internal
`agent-service` for orchestrated agents, covering environment variables, service
authentication, timeout tuning, and fallback behaviour during incremental rollout.

---

## Overview

Agents can be configured with two execution modes:

| `executionMode`    | Execution path                                                           |
| ------------------ | ------------------------------------------------------------------------ |
| `direct_provider`  | Request is sent directly to the provider registry (LM Studio, OpenAI …) |
| `orchestrated`     | Request is forwarded to the internal `agent-service` via HTTP            |
| *(absent)*         | Same as `direct_provider` — legacy agents are unaffected                 |

Only agents explicitly set to `executionMode: 'orchestrated'` in their agent config will
contact the `agent-service`. All other agents continue to use the direct provider path
unchanged. This makes the migration incremental and safe: you can opt in one agent at a
time without risk of disrupting existing flows.

---

## Environment Variables

Add the following variables to the `chat-api` environment (`.env` or deployment secrets).

### Required for orchestration

```env
# Base URL of the internal agent-service (no trailing slash).
# Must be set for any agent with executionMode='orchestrated'.
AGENT_SERVICE_URL=http://agent-service:8080
```

### Optional / tuning

```env
# Pre-shared bearer token used to authenticate gateway → agent-service calls.
# If absent, the Authorization header is omitted entirely.
AGENT_SERVICE_API_KEY=changeme

# Per-request timeout in milliseconds (default: 30000 — 30 s).
# Increase for long-running orchestration workflows.
AGENT_SERVICE_TIMEOUT_MS=30000

# Number of automatic retries on transient server errors (5xx / network failures).
# Retries use exponential back-off starting at 200 ms.
# 4xx client errors are never retried.
# Default: 2 (i.e. up to 3 total attempts).
AGENT_SERVICE_RETRY_COUNT=2
```

---

## Service Authentication

The gateway attaches the pre-shared key as a standard `Authorization: Bearer <key>` header
on every request to the agent-service.

**Requirements on the agent-service side:**

1. Validate the `Authorization` header on the `/run` endpoint.
2. Reject requests that are missing or carry an invalid key with HTTP **401**.
3. Do not expose the `/run` endpoint on a public network interface.

If `AGENT_SERVICE_API_KEY` is left unset (e.g. in a trusted private network), the header is
simply omitted. This is acceptable only when the network boundary itself provides sufficient
isolation.

---

## Request / Response Contract

### Request — `POST <AGENT_SERVICE_URL>/run`

```jsonc
{
  "agentId": "my-agent",
  "model": "local-model",
  "messages": [
    { "role": "system", "content": "You are …" },
    { "role": "user",   "content": "Hello" }
  ],
  "temperature": 0.5,          // optional
  "maxTokens": 2048,           // optional
  "modelParams": { … },        // optional — agent endpointConfig.modelParams
  "workflowId": "wf-123",      // optional — from automation context
  "workflowSource": "scheduler", // optional
  "deliveryMode": "inbox",     // optional
  "userId": "me",              // optional
  "channelId": "ops",          // optional
  "threadId": "thread-abc"     // optional — conversation attribution
}
```

### Response — success (HTTP 200)

```jsonc
{
  "agentId": "my-agent",
  "usedProvider": "lm-studio-a",
  "model": "local-model",
  "message": { "role": "assistant", "content": "…" },
  "usage": {
    "promptTokens": 120,
    "completionTokens": 45,
    "totalTokens": 165
  },
  "status": "completed",        // optional; absent or "completed" = normal
  "resultThreadId": "thread-abc" // optional — orchestrator-assigned thread
}
```

### Response — suspended run (HTTP 200 with non-terminal status)

When the orchestrator suspends the run for approval or an external event, `status` will be
`"approval_required"` or `"paused"`. The gateway forwards these as **HTTP 202** to the
caller and does **not** publish inbox messages for suspended runs.

```jsonc
{
  "agentId": "my-agent",
  "usedProvider": "agent-service",
  "model": "local-model",
  "message": { "role": "assistant", "content": "" },
  "status": "approval_required",
  "orchestrationState": {
    "checkpointId": "cp-001",
    "reason": "Requires manager sign-off",
    "requiredApprovers": ["manager@example.com"]
  }
}
```

---

## Timeout Tuning

| Scenario                              | Recommended `AGENT_SERVICE_TIMEOUT_MS` |
| ------------------------------------- | --------------------------------------- |
| Lightweight, single-step agents       | `10000` – `20000`                       |
| Multi-step / tool-use workflows       | `60000` – `120000`                      |
| Long-running background orchestration | `120000`+, or use the `/run` async path |

When the timeout is exceeded the gateway treats it like any other server-side failure: the
request is retried up to `AGENT_SERVICE_RETRY_COUNT` times and, if all attempts exhaust, the
caller receives **HTTP 502**.

---

## Fallback Behaviour and Rollout Safety

The gateway does **not** automatically fall back from `agent-service` to the direct provider
when the agent-service is unavailable. This is intentional:

- A silent fallback would mask outages and produce inconsistent results.
- The caller receives a clear **502** error so the issue can be diagnosed.

**Incremental migration strategy:**

1. Deploy the new `AGENT_SERVICE_URL` and `AGENT_SERVICE_API_KEY` env vars.
2. Set `executionMode: 'orchestrated'` on a single low-risk agent.
3. Validate the end-to-end flow using `/api/agents/<id>/run` or `/api/chat`.
4. Gradually opt additional agents into `orchestrated` mode.
5. Agents without an explicit `executionMode` always use the direct provider path — they
   are never affected by `agent-service` availability.

---

## Control-Plane Coordination

The following operational items are owned by `gateway-control-plane` and must be updated
in lockstep with any changes to this integration:

- `AGENT_SERVICE_URL` and `AGENT_SERVICE_API_KEY` values in the env file.
- Network routing / firewall rules between the gateway host and the agent-service host.
- Service-profile agent sync that sets `executionMode` on individual agents.

See the `gateway-control-plane` repository for deployment wiring details.
