# Local TTS Integration Spec

Add first-class integration with the `local-tts-service` so `gateway-chat-platform` can use the TTS service configured by `gateway-control-plane`.

## Context

- A separate service is already running on the LAN at `http://192.168.0.111:5000`.
- Its contract is documented in `local-tts-service/README.md`.
- `gateway-control-plane` now renders these env vars into the chat-platform runtime config:
  - `TTS_ENABLED`
  - `TTS_BASE_URL`
  - `TTS_DEFAULT_VOICE`
  - `TTS_GENERATE_PATH`
  - `TTS_STREAM_PATH`
  - `TTS_VOICES_PATH`
  - `TTS_HEALTH_PATH`
- The control plane can already edit and validate those values.
- This repo now needs to consume them.

## Goals

1. Add a typed server-side TTS client.
2. Expose API routes for TTS health, voice discovery, and synthesis.
3. Allow automation agent runs to optionally produce TTS output.
4. Keep the initial implementation small and production-usable.

## Required Config

Add typed config parsing for these env vars:

- `TTS_ENABLED` default `false`
- `TTS_BASE_URL` default `http://192.168.0.111:5000`
- `TTS_DEFAULT_VOICE` default `assistant_v1`
- `TTS_GENERATE_PATH` default `/tts`
- `TTS_STREAM_PATH` default `/tts/stream`
- `TTS_VOICES_PATH` default `/voices`
- `TTS_HEALTH_PATH` default `/health`

Implementation requirements:
- Centralize parsing in one config module.
- Normalize base URL and relative paths.
- If `TTS_ENABLED=false`, TTS routes should return a clear disabled response rather than failing opaquely.

## Server-Side TTS Client

Add a small service module, for example `apps/chat-api/src/services/ttsClient.ts`, that can:

- `getHealth()`
- `listVoices()`
- `synthesize({ text, voice, format })`
- optionally `streamSynthesize(...)` if that is clean to support in v1

Behavior:
- Call the external service over HTTP.
- Respect configured paths from env.
- Return structured results.
- On non-2xx responses, return clear errors with status and trimmed body text.
- Add a timeout.

## API Endpoints

Add these routes under `apps/chat-api`:

### `GET /api/tts/health`
Returns:
```json
{
  "enabled": true,
  "baseUrl": "http://192.168.0.111:5000",
  "upstreamStatus": 200
}
```

### `GET /api/tts/voices`
Returns upstream voice data in a stable wrapper, for example:
```json
{
  "enabled": true,
  "voices": [ ... ]
}
```

### `POST /api/tts`
Request body:
```json
{
  "text": "Hello from Bruvie-D.",
  "voice": "assistant_v1",
  "format": "wav"
}
```

Behavior:
- If TTS disabled, return `409` with clear JSON error.
- If enabled, proxy synthesis request to local TTS service.
- Return either:
  - audio bytes directly with correct content type, or
  - a JSON wrapper with generated file metadata if that fits the existing service better.

Pick one consistent shape and document it.

## Automation Run Integration

Extend `POST /api/agents/:id/run` so `delivery` can optionally request TTS output.

Support this request shape:
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

Required behavior:
- Keep current text response behavior as the default.
- If `delivery.mode !== 'tts'`, behavior stays unchanged.
- If `delivery.mode === 'tts'` and TTS is enabled:
  1. run the agent normally
  2. send the final text content to the local TTS service
  3. include TTS result metadata in the response

Example response shape:
```json
{
  "agentId": "bruvie-d",
  "usedProvider": "lm-studio-a",
  "model": "qwen/qwen3-32b",
  "content": "Everything is proceeding as badly as expected.",
  "latencyMs": 1842,
  "usage": {
    "promptTokens": 100,
    "completionTokens": 60,
    "totalTokens": 160
  },
  "tts": {
    "enabled": true,
    "voice": "assistant_v1",
    "format": "wav",
    "contentType": "audio/wav",
    "audioPath": "...optional if upstream provides it..."
  }
}
```

V1 constraints:
- Do not try to inline huge base64 audio blobs into the JSON response.
- Prefer returning metadata or a retrievable asset reference if available.
- If the upstream TTS service only returns raw audio, add a separate explicit `POST /api/tts` route and keep `/api/agents/:id/run` metadata-only for now.

## UI Considerations

If the chat UI is in scope, add a minimal TTS control later. Not required for v1.

If you do touch the UI, keep it small:
- button to synthesize the latest assistant message
- voice selector populated from `/api/tts/voices`
- audio player for returned result

Do not block server-side TTS support on UI work.

## Logging and Safety

- Log upstream TTS failures with status and endpoint.
- Do not log full generated text for sensitive agent runs unless the repo already does so consistently.
- Add a synthesis timeout.
- Add input size guardrails for TTS requests.

## Tests

Add tests for:
- config parsing of `TTS_*` env vars
- `GET /api/tts/health`
- `GET /api/tts/voices`
- `POST /api/tts` success and disabled cases
- `POST /api/agents/:id/run` with `delivery.mode = 'tts'`
- upstream failure handling

Use mocked upstream HTTP calls.

## Docs

Update the main README to include:
- required env vars
- new TTS endpoints
- how TTS delivery works for automation runs

## Deliverables

- typed TTS config
- `ttsClient` service
- `GET /api/tts/health`
- `GET /api/tts/voices`
- `POST /api/tts`
- `POST /api/agents/:id/run` TTS integration
- tests
- docs
