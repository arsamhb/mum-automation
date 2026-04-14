# API Contract

This service is designed to be called by another backend service.

Base URL example:
- local: `http://localhost:3000`
- render: `https://<your-api-service>.onrender.com`

## Deployment environments

- Staging (Sepolia): `tv-alert-connector-api-staging` + `tv-alert-connector-worker-staging`
- Production (Mainnet): `tv-alert-connector-api-prod` + `tv-alert-connector-worker-prod`

Env expectations:
- API service: `REDIS_URL`, `GAINS_NETWORK_NAME`, `WEBHOOK_HMAC_SECRET` (required in production by runtime validation)
- Worker service: `REDIS_URL`, `GAINS_NETWORK_NAME`, `GAINS_SIGNER_PRIVATE_KEY` (or legacy `GAINS_PRIVATE_KEY`)
- Keep signer/private key values on worker only.

## 1) Submit alert

`POST /alerts`

Content-Type:
- `application/json` (recommended)
- `text/plain` with JSON content (TradingView-compatible)

### Request schema

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

Required:
- `strategy` (string)
- `market` (string)
- `order` (`buy | sell`)
- `position` (`long | short | flat`)
- `price` (number)
- `reverse` (boolean)

Optional:
- `exchange` (default: `gains`)
- `size` (number)
- `sizeUsd` (number)
- `sizeByLeverage` (number)
- `leverage` (number; canonical)
- `levrage` / `Levrage` (legacy aliases)
- `collateral`, `passphrase`

### Success response

Status: `202 Accepted`

```json
{
  "alertId": "f5e4dcef-3c41-4900-95fe-c8bd94abef30",
  "idempotencyKey": "15a525c0c5a21d060eb0562da25a6694e4f1cd57a2281b8d0c3e5b7fd7d19bfb",
  "status": "RECEIVED"
}
```

Duplicate payloads return `202` with:

```json
{
  "alertId": "existing-alert-id",
  "idempotencyKey": "same-key",
  "status": "ENQUEUED",
  "deduplicated": true
}
```

### Error responses

- `400` validation/schema failure
- `401` signature/auth failure (if HMAC enabled)
- `500` internal enqueue/runtime failure

## 2) Check alert status

`GET /alerts/:alertId`

Status: `200 OK`

```json
{
  "alertId": "f5e4dcef-3c41-4900-95fe-c8bd94abef30",
  "idempotencyKey": "15a525c0c5a21d060eb0562da25a6694e4f1cd57a2281b8d0c3e5b7fd7d19bfb",
  "status": "CONFIRMED",
  "createdAt": "2026-04-14T08:00:00.000Z",
  "updatedAt": "2026-04-14T08:00:08.000Z",
  "exchange": "gains",
  "strategy": "Aura",
  "market": "XAUUSD",
  "order": "buy",
  "position": "long",
  "retryCount": 0,
  "txHash": "0x...",
  "lastError": "optional"
}
```

If alert does not exist: `404`.

### Status lifecycle

- `RECEIVED`
- `VALIDATED`
- `ENQUEUED`
- `EXECUTING`
- `SUBMITTED`
- `MINED`
- `RETRYING`
- `CONFIRMED`
- `FAILED`

## 3) Ops endpoints

- `GET /health`: liveness
- `GET /ready`: readiness (checks Redis)
- `GET /metrics`: Prometheus metrics

### Queue and dead-letter behavior

- Main queue: `tv-alerts`
- Dead-letter queue: `tv-alerts-dlq`
- On retryable failures, worker marks state `RETRYING` until attempts are exhausted.
- On terminal failure or exhausted retries:
  - alert state becomes `FAILED`
  - payload is pushed to DLQ

## 4) HMAC webhook auth (optional)

If enabled via `WEBHOOK_HMAC_SECRET`:

- `x-webhook-timestamp`: unix ms timestamp
- `x-webhook-signature`: `sha256=<hex>`
- message to sign: `${timestamp}.${rawBody}`

Requests outside `WEBHOOK_REPLAY_WINDOW_MS` are rejected.
