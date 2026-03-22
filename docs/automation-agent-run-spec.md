# Automation Agent Run Spec

## Context

- The control plane can already sync agent definitions into this repo.
- `gateway-api` will execute scheduled workflows and needs to call this service.
- The current `/api/chat` endpoint is interactive-chat oriented.
- We need a dedicated non-interactive automation endpoint for scheduled runs.
- A migrated assistant agent named `Bruvie-D` will be invoked this way.

## Goals

1. Add a first-class automation endpoint for running an agent from an external scheduler.
2. Support prompt-based runs without requiring a chat thread.
3. Prepare for optional delivery metadata.
4. Keep agent execution path aligned with the normal routing/provider logic.

## Required API

### `POST /api/agents/:id/run`

Request body:

```json
{
  "prompt": "string",
  "context": {
    "workflowId": "optional",
    "source": "optional",
    "metadata": {}
  },
  "delivery": {
    "mode": "optional",
    "channel": "optional",
    "to": "optional"
  }
}
```

Response body:

```json
{
  "agentId": "bruvie-d",
  "usedProvider": "lm-studio-a",
  "model": "qwen/qwen3-32b",
  "content": "response text",
  "latencyMs": 1234,
  "usage": {
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0
  }
}
```

## Behavior

1. Look up the agent by path param.
2. Build a single-turn prompt request using the existing routing/provider pipeline.
3. Reuse the same provider resolution and usage accounting style as `/api/chat`.
4. No thread persistence is required for v1 unless already trivial to reuse.
5. If `delivery` is present, include it in logs but do not implement outbound delivery yet unless it is already easy and clean.
6. Return clear `404` for unknown agent.
7. Return structured errors for execution failures.

## Also Add

### 1. File/context helpers for future automation

- Add a minimal internal helper layer for workflow-oriented context injection.
- For v1 this can just pass through the provided prompt.
- Structure it so file/context tools can be added next without redesigning the endpoint.

### 2. Tooling groundwork

- Expand the tool registry directionally, but do not overbuild.
- At minimum, add TODO-ready stubs or clearly designed extension points for:
  - HTTP health check
  - Telegram send
  - file read
- If you can add one real safe tool cleanly, file read is the most immediately useful.

### 3. Bruvie-D readiness

- Ensure the synced agent config path supports:
  - long system prompts
  - endpoint override pointing to LM Studio
  - enabled feature flags
- No schema redesign should be needed unless you discover a real mismatch.

### 4. Tests

- Add tests for:
  - successful `POST /api/agents/:id/run`
  - unknown agent
  - provider execution failure
  - response shape
- Mock provider registry calls consistently with existing tests.

### 5. Docs

- Update the main README with the new endpoint and example request/response.
- Briefly explain this endpoint is intended for scheduler/control-plane invocation.

## Implementation Notes

- Reuse existing Fastify patterns and routing/provider code.
- Avoid duplicating logic from `/api/chat`; extract shared execution code if useful.
- Keep this endpoint purpose-built for automation, not UI chat.

## Deliverables

- `POST /api/agents/:id/run`
- tests
- docs
- light extension points for future automation tooling
