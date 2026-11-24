# EBK API

Base path `/api`. Interactive OpenAPI docs at `/api/docs` (non-production only).
All amounts are **decimal strings** (`{"amount":"253.49","currency":"GBP"}`), never numbers.
Authenticated routes take `Authorization: Bearer <access token>`. Browser calls also send
`X-EBK-Client: web` (required on cookie-based auth endpoints).

## Errors

```json
{ "code": "VALIDATION_FAILED", "message": "Some fields are invalid",
  "fields": [{ "path": "mobileNumber", "message": "This looks like an Airtel Money number, not MTN MoMo" }] }
```

Common codes: `UNAUTHENTICATED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `KYC_REQUIRED`,
`QUOTE_EXPIRED`, `QUOTE_USED`, `RATE_UNAVAILABLE`, `RATE_NOT_CONFIRMABLE`, `BELOW_MINIMUM`, `ABOVE_MAXIMUM`,
`IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS`, `INVALID_STATE`.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{email,password,firstName,lastName,countryOfResidence,phone?}` → `{accessToken,expiresIn}` + refresh cookie. 5/min. |
| POST | `/auth/login` | `{email,password}`. 10/min. Locks for 15 min after 5 failures. |
| POST | `/auth/refresh` | Uses `ebk_rt` cookie. Rotates; reuse of an old token revokes the whole session family. |
| POST | `/auth/logout` | Revokes the session family, clears cookie. |
| GET | `/auth/me` | Profile, KYC status. |

## Reference data

| GET | `/reference-data/corridors` | Public. Corridors, limits, payout methods, operators. |
|---|---|---|

## Quotes

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/quotes/estimate` | `{corridorId:"GB-ZM",payoutMethod:"MOBILE_MONEY",sendAmount:"250.00"}` | Indicative, not stored. |
| POST | `/quotes` | same | Locked quote (`id`, `expiresAt`). Refused for `ESTIMATED` rates, and for `SANDBOX` rates in production. |

Quote: `sendAmount`, `fee`, `totalPayable`, `recipientAmount`, `rate {value, kind: LIVE|ESTIMATED|SANDBOX, source, fetchedAt}`.

## Beneficiaries

| GET | `/beneficiaries` | List (masked numbers) |
|---|---|---|
| GET | `/beneficiaries/:id` | |
| POST | `/beneficiaries` | `{fullName,nickname?,countryCode:"ZM",payoutMethod:"MOBILE_MONEY",mobileOperatorCode:"MTN_ZM"|"AIRTEL_ZM",mobileNumber}` — number normalised to E.164 and checked against the operator's prefixes |
| PATCH | `/beneficiaries/:id` | same body |
| DELETE | `/beneficiaries/:id` | Soft delete; history keeps a snapshot |

## Transfers

| Method | Path | Notes |
|---|---|---|
| GET | `/transfers?status=&cursor=&limit=` | Cursor pagination |
| GET | `/transfers/:idOrReference` | Includes `timeline` and pending `payment.checkoutUrl` |
| GET | `/transfers/:id/receipt` | Receipt data (web renders/prints) |
| POST | `/transfers` | **Idempotency-Key required.** `{quoteId, beneficiaryId}` → `DRAFT`. Requires verified KYC. |
| POST | `/transfers/:id/confirm` | **Idempotency-Key required.** → `PENDING_PAYMENT`, returns `{checkoutUrl, paymentStatus, sandbox}` |
| POST | `/transfers/:id/cancel` | Only before funds are collected |

## Webhooks

`POST /webhooks/:providerCode` — raw body is signature-verified by the provider adapter, stored in
`provider_webhooks` (de-duplicated on event id) and processed. Invalid signatures → 401 and a
`REJECTED` record. Payout callbacks only trigger a status re-query (MTN callbacks are unsigned).

## Sandbox (non-production only)

`GET /sandbox/checkout/:attemptKey` — labelled test checkout page; its buttons generate a signed webhook
through the real pipeline. Not registered when `NODE_ENV=production`.

## Health

`GET /health` — DB connectivity, environment, whether sandbox providers are enabled.
