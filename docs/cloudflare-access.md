# Cloudflare Access Configuration

This document describes how to protect the `chat.yourdomain.com` hostname using Cloudflare Access.

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
```

The `CF_ACCESS_AUD` (audience tag) is shown on the Access application overview page.

## 5. Token Validation (Backend)

The `chat-api` can validate the `CF_Authorization` JWT sent by Cloudflare Access using the
public JWKS endpoint:

```
https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs
```

Use a library such as `jose` (Node.js) to verify the token on protected endpoints.

## 6. Testing the Flow

1. Open an incognito/private browser window.
2. Navigate to `https://chat.yourdomain.com`.
3. You should be redirected to the Cloudflare Access login page.
4. Authenticate with the configured identity provider.
5. After successful login, you are redirected back to the chat UI.

## 7. Bypass for API Health Checks

If your load balancer health checks need to reach `/api/health` without authentication,
add a second Access policy with **Action = Bypass** scoped to the path `/api/health`.
