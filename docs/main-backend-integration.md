# Main-Backend Integration Contract

This document defines how the future `main-backend` service should integrate with this `tradingview-alert-connector` service.

## 1) Service Roles and Boundaries

### TradingView Alert Connector (this service)

- Publicly exposed webhook/API receiver.
- Validates alert format and security headers.
- Normalizes alerts and computes idempotency keys.
- Enqueues alerts to Redis/BullMQ.
- Executes trades asynchronously in a worker.
- Stores per-alert lifecycle state in Redis.

### Main-Backend (upcoming service)

- Owns business workflows and user/application context.
- Sends canonical trading intents to connector.
- Tracks `alertId` returned by connector.
- Polls connector status until terminal state.
- Handles retries at orchestration level only when connector request itself fails (network/5xx/timeout before acceptance).

## 2) Deployment and Network Topology

- `API service` and `Worker service` are separate processes.
- `Redis` is the shared queue + state backend.
- Main-backend should communicate only with connector API endpoints.
- Main-backend must never need worker private keys or direct blockchain access through this integration.

Environment split in connector:

- API requires: `REDIS_URL`, `GAINS_NETWORK_NAME`.
- Worker requires: `REDIS_URL`, `GAINS_NETWORK_NAME`, `GAINS_SIGNER_PRIVATE_KEY` (or legacy `GAINS_PRIVATE_KEY`).
- Production API requires `WEBHOOK_HMAC_SECRET` unless explicitly bypassed with `ALLOW_INSECURE_WEBHOOK_IN_PROD=true` (not recommended).

## 3) HTTP Interfaces Between Main-Backend and Connector

Base URL examples:

- local: `http://localhost:3000`
- hosted: `https://<connector-host>`

### 3.1 Submit alert

`POST /alerts`

Accepted content types:

- `application/json` (recommended for main-backend)
- `text/plain` containing JSON (TradingView compatibility path)

Request payload:

```json
{
  "exchange": "gains",
  "strategy": "Aura",
  "market": "XAUUSD",
  "order": "buy",
  "position": "long",
  "price": 4776.61,
  "reverse": false,
  "sizeUsd": 1000,
  "leverage": 10,
  "passphrase": "optional"
}
```

Required fields:

- `strategy` (string)
- `market` (string)
- `order` (`buy` | `sell`)
- `position` (`long` | `short` | `flat`)
- `price` (number)
- `reverse` (boolean)

Optional fields:

- `exchange` (defaults to `gains`; aliases accepted by service registry include `gtrade`, `gns`)
- `size`, `sizeUsd`, `sizeByLeverage` (at least one should be provided for open positions)
- `leverage` (preferred), also supports `levrage` and `Levrage`
- `collateral`, `passphrase`

Success response (`202 Accepted`):

```json
{
  "alertId": "uuid",
  "idempotencyKey": "sha256",
  "status": "RECEIVED"
}
```

Duplicate response (`202 Accepted`):

```json
{
  "alertId": "existing-uuid",
  "idempotencyKey": "same-key",
  "status": "ENQUEUED",
  "deduplicated": true
}
```

Error responses:

- `400`: payload invalid or unsupported exchange.
- `401`: HMAC signature/timestamp failure when HMAC mode is enabled.
- `500`: internal enqueue/runtime failure before acceptance is completed.

### 3.2 Read alert execution state

`GET /alerts/:alertId`

Success response (`200 OK`):

```json
{
  "alertId": "uuid",
  "idempotencyKey": "sha256",
  "status": "EXECUTING",
  "createdAt": "2026-04-14T08:00:00.000Z",
  "updatedAt": "2026-04-14T08:00:04.000Z",
  "exchange": "gains",
  "strategy": "Aura",
  "market": "XAUUSD",
  "order": "buy",
  "position": "long",
  "retryCount": 0,
  "txHash": "optional",
  "lastError": "optional",
  "jobId": "optional"
}
```

Not found:

- `404`: unknown `alertId` or expired state TTL.

### 3.3 Ops endpoints (for health monitoring, not trade workflow)

- `GET /health`: liveness.
- `GET /ready`: readiness (includes Redis ping).
- `GET /metrics`: Prometheus metrics text.

## 4) Security Contract (Main-Backend <-> Connector)

When `WEBHOOK_HMAC_SECRET` is configured on connector API, main-backend must send:

- `x-webhook-timestamp`: unix epoch milliseconds.
- `x-webhook-signature`: `sha256=<hex-hmac>`.

Signing algorithm:

- Message = `${timestamp}.${rawBody}`
- HMAC algorithm = `sha256`
- Key = shared secret from secure secret manager

Replay protection:

- Connector enforces `WEBHOOK_REPLAY_WINDOW_MS` (default 300000 ms).
- Main-backend clocks should be NTP-synchronized.

Also supported header aliases:

- `x-tv-timestamp`
- `x-tv-signature`

## 5) State Machine and Async Semantics

Connector states:

- `RECEIVED`
- `VALIDATED`
- `ENQUEUED`
- `EXECUTING`
- `SUBMITTED`
- `MINED`
- `RETRYING`
- `CONFIRMED`
- `FAILED`

Behavioral notes:

- `POST /alerts` is asynchronous acceptance, not execution completion.
- Worker transitions states after queue pickup and chain actions.
- `CONFIRMED` is terminal success.
- `FAILED` is terminal failure (includes `lastError`; payload copied to DLQ queue `tv-alerts-dlq`).
- Retry path increments `retryCount` and sets `RETRYING` before next attempt.

## 6) Idempotency and Deduplication Contract

Connector deduplicates accepted alerts by a generated SHA-256 key over canonical fields:

- exchange
- strategy
- market
- order
- position
- source timestamp minute-bucket
- size fields and leverage

Implications for main-backend:

- Same semantic payload in the same minute can return the same existing `alertId` (`deduplicated: true`).
- Always persist both `alertId` and `idempotencyKey`.
- Treat `202` + `deduplicated: true` as success, not an error.

## 7) Execution Ordering and Concurrency

- Queue-level retries use BullMQ attempts/backoff config.
- Worker uses a Redis execution lock per `exchange:strategy:market` to reduce concurrent conflicting executions.
- `ALERT_WORKER_CONCURRENCY` controls worker parallelism globally.

Main-backend recommendation:

- Do not send parallel contradictory intents for same `strategy + market`.
- If business logic emits rapid changes, coalesce intents before calling connector.

## 8) Trading Payload Rules for Main-Backend

Minimum recommended open-position payload:

- `exchange`: `gains`
- `strategy`: stable strategy identifier
- `market`: Gains pair key accepted by connector normalization (e.g. `XAUUSD`, `BTCUSD`)
- `order`: `buy` or `sell`
- `position`: `long` or `short`
- `price`: number
- `reverse`: boolean
- one sizing field: `sizeUsd` (recommended) or `size` or `sizeByLeverage`
- `leverage`: positive number

Close signal payload:

- Set `position: "flat"`.
- Keep strategy/market consistent with the position being closed.

## 9) Suggested Integration Sequence

1. Main-backend builds canonical payload and computes HMAC headers (if enabled).
2. Main-backend sends `POST /alerts`.
3. On `202`, store `{ alertId, idempotencyKey, submittedAt, sourceEventId }`.
4. Poll `GET /alerts/:alertId` every 1-2 seconds initially, then backoff to 3-5 seconds.
5. Stop polling on terminal states:
   - `CONFIRMED` => mark successful execution.
   - `FAILED` => mark failed execution and surface `lastError`.
6. If `POST` fails before receiving a response (timeout/network uncertainty), retry with the exact same payload to leverage connector deduplication safety.

## 10) Error Handling Matrix for Main-Backend

- `400` from POST: do not retry blindly; payload mapping bug or invalid value.
- `401` from POST: HMAC/signing/timestamp bug; treat as security/config incident.
- `500` from POST: safe to retry with same payload and request ID.
- `404` on GET immediately after `202`: short delayed retry (eventual consistency); persistent `404` indicates TTL expiry or wrong id.
- `FAILED` state: terminal from connector perspective; escalate to operator or automated recovery policy.

## 11) Observability and Correlation

Connector supports `x-request-id` correlation:

- Main-backend should always send `x-request-id` on POST and GET.
- Connector echoes it in response header and logs.

Useful metrics (`/metrics`):

- `tv_alerts_accepted_total`
- `tv_alerts_deduplicated_total`
- `tv_alerts_terminal_failed_total`
- `tv_alert_execution_duration_ms`
- `tv_alert_queue_lag_ms`

## 12) Interface Evolution Recommendations

For safer long-term integration between two backend services:

1. Version payloads explicitly (e.g., `schemaVersion` on request contract).
2. Publish an OpenAPI spec and generate shared typed clients.
3. Add callback/webhook-out from connector to main-backend as optional alternative to polling.
4. Return a stricter status in dedupe response (currently can show prior state like `ENQUEUED` while initial success returns `RECEIVED`).
5. Define retention/SLA for alert state TTL (currently Redis TTL is 14 days).

---

If needed, this contract can be split into:

- external API spec for main-backend developers,
- internal runbook for operations/reliability teams.
