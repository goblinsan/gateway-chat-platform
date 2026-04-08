# Quota and Rate Configuration

This document clarifies which quota and rate settings are **repo-managed defaults**
and which are **operator-managed runtime config**, so that operators and contributors
understand the correct configuration boundary.

---

## Repo-managed defaults

The following are committed to this repository and form the baseline behavior.
Changes here require a pull request and redeploy.

### Model pricing table (`apps/chat-api/src/services/costEstimator.ts`)

`MODEL_RATES` is a static map from model identifier to input/output price per 1 million tokens.
It is used to compute the `estimatedCostUsd` column on every `UsageLog` row and is served as-is
from `GET /api/usage/rates`.

```
MODEL_RATES = {
  'gpt-4o':            { input: 5.00,  output: 15.00 },
  'gpt-4o-mini':       { input: 0.15,  output: 0.60  },
  'gpt-4-turbo':       { input: 10.00, output: 30.00 },
  ...
}
```

> **Note:** These prices are reference estimates from public provider pricing pages.
> Operators who negotiate private rates or use reseller accounts must not rely on these
> figures for billing — they are indicative only.

### Provider capability profiles (`apps/chat-api/src/routing/capabilities.ts`)

`PROVIDER_CAPABILITIES` assigns a `costClass` (`free` | `cheap` | `premium`) to each
known provider. This feeds into routing-engine cost filters but does **not** enforce
spend limits.

---

## Operator-managed runtime config

The following are **not** committed to this repository.  Operators control them
through the database or environment and can change them without a code deploy.

### Per-model quotas (`ModelQuota` table)

Each row in the `ModelQuota` table defines a rolling-window limit for a
`(userId, model)` pair:

| Column        | Meaning                                                        |
|---------------|----------------------------------------------------------------|
| `userId`      | The user the rule applies to. Use `"*"` for all users.        |
| `model`       | The model the rule applies to. Use `"*"` for all models.      |
| `windowHours` | Size of the rolling time window (default: `24`).              |
| `maxTokens`   | Maximum total tokens in the window, or `null` for no limit.   |
| `maxRequests` | Maximum requests in the window, or `null` for no limit.       |
| `maxCostUsd`  | Maximum spend in USD in the window, or `null` for no limit.   |
| `enabled`     | `true` to enforce the rule; `false` to temporarily disable.   |

**Precedence** (most specific wins):

1. `userId = <user>` + `model = <model>`
2. `userId = "*"` + `model = <model>`
3. `userId = <user>` + `model = "*"`
4. `userId = "*"` + `model = "*"`

Rules are not committed to this repository. Populate them directly via a database
migration, a seed script, or an operator admin tool.

#### Example: global 100k-token daily limit on gpt-4o

```sql
INSERT INTO ModelQuota (id, userId, model, windowHours, maxTokens, enabled, createdAt, updatedAt)
VALUES (lower(hex(randomblob(16))), '*', 'gpt-4o', 24, 100000, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

#### Example: per-user 500-request weekly cap on all models

```sql
INSERT INTO ModelQuota (id, userId, model, windowHours, maxRequests, enabled, createdAt, updatedAt)
VALUES (lower(hex(randomblob(16))), 'user-alice', '*', 168, 500, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

---

## Enforcement behavior

When a quota is exceeded, the chat API returns HTTP **429** with a JSON body:

```json
{
  "error": "Quota exceeded",
  "message": "Your usage quota for model 'gpt-4o' has been reached for the current 24-hour window.",
  "quota": {
    "model": "gpt-4o",
    "windowHours": 24,
    "usedTokens": 100000,
    "maxTokens": 100000,
    "usedRequests": 42,
    "maxRequests": null,
    "usedCostUsd": 0.5,
    "maxCostUsd": null
  }
}
```

The check happens **before** the provider is called, so no tokens are consumed when
a quota is hit.

---

## Usage transparency endpoints

| Endpoint              | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| `GET /api/usage/summary?hours=N` | Per-model usage + quota status for the signed-in user. Default window: 24 h, max: 720 h. |
| `GET /api/usage/rates`           | Static pricing table (repo-managed `MODEL_RATES`). |

The **Usage & Quotas** panel in the chat UI reads these endpoints and shows:

- Total requests, tokens, and spend for the selected period.
- Per-model breakdown with quota progress bars.
- "Exceeded" / "Near limit" badges when a model is at ≥ 80 % or 100 % of its quota.
- A **Pricing Rates** tab showing input/output price per 1 M tokens for all metered models.

---

## What NOT to configure here

The following are owned by `gateway-control-plane` and must **not** be changed in this
repository without a coordinated control-plane update:

- Public hostname and route exposure.
- Blue/green slot selection.
- Environment file paths and shared data directory paths.
- Deploy start/stop commands and smoke-test endpoints.
- Service-profile agent sync definitions.
