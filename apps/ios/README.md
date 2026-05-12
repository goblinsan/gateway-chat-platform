# iOS app

Swift foundation scaffolding for the native Gateway client now lives here.

## Included in this step

- `GatewayAppRootView` setup gate (shows setup until configuration and token are present)
- Setup form for Gateway URL, API token, and device name
- Secure token storage abstraction with Keychain-backed implementation (`KeychainTokenStore`)
- `/api/health` connectivity check via `GatewayHealthClient`
- Main tab shell with Chat, Alerts, Approvals, and Settings sections
- Settings actions for token replacement, connection retest, and clearing local data

## Control-plane contract notes

The iOS foundation currently depends on these server endpoints remaining stable:

- `GET /api/health`
- `GET /api/session/me`

If route mounting, base paths, or response shapes for these endpoints change, update
`gateway-control-plane` and this iOS client in lockstep.

## Local validation

```bash
cd apps/ios
swift test
```
