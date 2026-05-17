# Cloudflare Access Configuration

This document describes how to protect the `chat.yourdomain.com` hostname using Cloudflare Access and how to lock down origin access so that only Cloudflare traffic can reach the servers.

## Prerequisites

- A Cloudflare account with a Zero Trust plan (free tier is sufficient for personal use).
- The domain `yourdomain.com` managed by Cloudflare DNS.
- The chat platform deployed and reachable from the Cloudflare network.

## 1. Create a Cloudflare Access Application

1. Log in to the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/).
2. Navigate to **Access → Applications → Add an application**.
3. Select **Self-hosted**.
4. Configure:
   - **Application name**: `Gateway Chat`
   - **Application domain**: `chat.yourdomain.com`
   - **Session duration**: `24h` (or your preferred TTL)
5. Click **Next**.

## 2. Configure an Access Policy

1. Add a policy named `Allow internal users`.
2. Set **Action** to `Allow`.
3. Add an **Include** rule with at least one of:
   - **Emails** — specific email addresses allowed to access the app.
   - **Email domain** — e.g. `yourdomain.com` for everyone at that domain.
   - **Identity provider group** — if using an external IdP (Google, Okta, GitHub).
4. Click **Save policy**.

## 3. Configure an Identity Provider

1. Go to **Settings → Authentication → Login methods**.
2. Add an identity provider (e.g. **Google**):
   - Create an OAuth 2.0 app in Google Cloud Console.
   - Set the redirect URI to `https://<team-domain>.cloudflareaccess.com/cdn-cgi/access/callback`.
   - Copy the **Client ID** and **Client Secret** back to Cloudflare.
3. Test the identity provider before enabling it for production.

## 4. Set Environment Variables

Add the following to your `chat-api` environment (`.env` or deployment secrets):

```env
CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CF_ACCESS_AUD=<Application Audience Tag from the Access application>

# Restrict CORS to your chat domain only (comma-separated for multiple origins)
ALLOWED_ORIGINS=https://chat.yourdomain.com
```

The `CF_ACCESS_AUD` (audience tag) is shown on the Access application overview page.

## 5. Token Validation (Backend)

When `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are configured the `chat-api` automatically
validates the `CF-Access-Jwt-Assertion` JWT header on all **admin** endpoints
(`/api/admin/*`) using the public JWKS endpoint:

```
https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs
```

Requests to admin routes that are missing or carry an invalid token receive a **401** response.

## 6. Origin IP Allowlisting (Nginx)

The `infra/nginx/nginx.conf` configuration restricts incoming connections to the published
[Cloudflare IP ranges](https://www.cloudflare.com/ips/). Any request that does not originate
from a Cloudflare edge node receives a **403** response before it reaches the application.

Keep the IP list up to date by periodically comparing it against:
- <https://www.cloudflare.com/ips-v4>
- <https://www.cloudflare.com/ips-v6>

## 7. Testing the Flow

1. Open an incognito/private browser window.
2. Navigate to `https://chat.yourdomain.com`.
3. You should be redirected to the Cloudflare Access login page.
4. Authenticate with the configured identity provider.
5. After successful login, you are redirected back to the chat UI.

## 8. Bypass for API Health Checks

If your load balancer health checks need to reach `/api/health` without authentication,
add a second Access policy with **Action = Bypass** scoped to the path `/api/health`.

## 9. Native iOS Clients

Cloudflare Access browser redirects do not work for the native iOS client in `apps/ios`.
If the client calls `https://chat.yourdomain.com/api/*` and Access intercepts the request,
the app receives HTML instead of JSON and setup fails.

To support the native client:

1. Add a dedicated **Bypass** policy for the mobile API paths the app uses:
   - `/api/health`
   - `/api/session/me`
   - `/api/session/mobile-devices/apns`
   - `/api/agents`
   - `/api/chat`
   - `/api/chat/stream`
   - `/api/mobile/*`
2. Configure a shared bearer token in the API environment:

```env
MOBILE_SHARED_TOKEN=<long-random-secret>
MOBILE_SHARED_USER_ID=<stable-user-id>
```

3. Enter that same token into the iOS app's `API Token` field.

The backend will then accept `Authorization: Bearer <MOBILE_SHARED_TOKEN>` for those
mobile requests even when `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` are enabled for the
rest of the platform.
