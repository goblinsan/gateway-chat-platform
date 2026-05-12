# iOS app

Swift foundation scaffolding for the native Gateway client now lives here.

## Included in this step

- `GatewayAppRootView` setup gate (shows setup until configuration and token are present)
- Setup form for Gateway URL, API token, and device name
- Secure token storage abstraction with Keychain-backed implementation (`KeychainTokenStore`)
- `/api/health` connectivity check via `GatewayHealthClient`
- Main tab shell with Chat, Alerts, Approvals, and Settings sections
- Native Chat tab with typed prompts, optional agent picker, in-session conversation state, copy response action, and inline error/loading states
- Settings actions for token replacement, connection retest, and clearing local data

## Control-plane contract notes

The iOS foundation currently depends on these server endpoints remaining stable:

- `GET /api/health`
- `GET /api/session/me`
- `GET /api/agents`
- `POST /api/chat`
- `POST /api/chat/stream` (SSE; used as primary; falls back to `/api/chat` on failure)

If route mounting, base paths, or response shapes for these endpoints change, update
`gateway-control-plane` and this iOS client in lockstep.

## Voice prompt input

The `SpeechRecognitionController` in `Core/` enables push-to-talk speech capture
using the Apple Speech framework. Users tap the mic button to start recording; the
final transcript is placed into the prompt text field for review before sending.
No transcript is ever auto-sent.

The consuming Xcode application target **must** declare the following keys in its
`Info.plist` (or the target's `Privacy – …` build settings), otherwise the iOS
runtime will terminate the app when the permission dialogs are triggered:

| Key | Purpose |
|---|---|
| `NSMicrophoneUsageDescription` | Explains why the app needs microphone access. |
| `NSSpeechRecognitionUsageDescription` | Explains why the app needs speech recognition access. |

Example values (customise to your app):
```xml
<key>NSMicrophoneUsageDescription</key>
<string>Speak your prompt and review it before sending to the Gateway.</string>
<key>NSSpeechRecognitionUsageDescription</key>
<string>Your voice is transcribed on-device to fill the chat prompt.</string>
```

## Local validation

```bash
cd apps/ios
swift test
```
