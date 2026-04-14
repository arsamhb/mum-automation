# TradingView Alert Connector

Execution microservice for TradingView/Gains alerts.

Another backend service (for example FastAPI) should call this service through HTTP:
- submit alert: `POST /alerts`
- poll result: `GET /alerts/:alertId`

Detailed contract: `docs/api.md`

## Deployment topology

Render topology (from `render.yaml`):
- **Staging / Sepolia**
  - `tv-alert-connector-api-staging` (web)
  - `tv-alert-connector-worker-staging` (worker)
  - `tv-alerts-redis-staging` (redis)
- **Production / Arbitrum mainnet**
  - `tv-alert-connector-api-prod` (web)
  - `tv-alert-connector-worker-prod` (worker)
  - `tv-alerts-redis-prod` (redis)

Local parity:
- `docker-compose.yml` runs `api + worker + redis`
- `docker-compose-dev.yml` runs watch-mode `api + worker + redis`

## Service env matrix

API service (`web`) minimum:
- `REDIS_URL`
- `GAINS_NETWORK_NAME` (`sepolia` for staging, `mainnet` for prod)
- `WEBHOOK_HMAC_SECRET` (required in production by runtime validation; can bypass with `ALLOW_INSECURE_WEBHOOK_IN_PROD=true`, not recommended)

Worker service minimum:
- `REDIS_URL`
- `GAINS_NETWORK_NAME`
- `GAINS_SIGNER_PRIVATE_KEY` (or legacy `GAINS_PRIVATE_KEY`)

Important:
- Keep signer keys on worker only.
- Do not set trading signer keys on API service.

## Quick start

1. Copy `.env.sample` to `.env`
2. Set required vars:
   - `REDIS_URL` (for compose: `redis://redis:6379`)
   - `GAINS_SIGNER_PRIVATE_KEY`
   - `GAINS_NETWORK_NAME` (`sepolia` or `mainnet`)
3. Run:

```bash
docker compose up --build
```

Dev mode:

```bash
docker compose -f docker-compose-dev.yml up --build
```

## API for other services

### POST `/alerts`

Accepts JSON body (or `text/plain` JSON payload) and returns `202 Accepted` when enqueued.

Request schema:

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
- `strategy`, `market`, `order`, `position`, `price`, `reverse`

Enums:
- `order`: `buy | sell`
- `position`: `long | short | flat`

Size fields (one of):
- `size`
- `sizeUsd`
- `sizeByLeverage`

Leverage aliases accepted:
- canonical: `leverage`
- backward compatible: `levrage`, `Levrage`

Success response (`202`):

```json
{
  "alertId": "uuid",
  "idempotencyKey": "sha256",
  "status": "RECEIVED"
}
```

Duplicate payload response (`202`):

```json
{
  "alertId": "existing-uuid",
  "idempotencyKey": "same-key",
  "status": "ENQUEUED",
  "deduplicated": true
}
```

Error responses:
- `400`: schema/validation error
- `401`: HMAC auth error (if configured)
- `500`: enqueue/internal failure

### GET `/alerts/:alertId`

Returns alert lifecycle state:

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
  "lastError": "optional"
}
```

Status values:
- `RECEIVED`, `VALIDATED`, `ENQUEUED`, `EXECUTING`, `SUBMITTED`, `MINED`, `RETRYING`, `CONFIRMED`, `FAILED`

### Ops endpoints

- `GET /health` -> process is alive
- `GET /ready` -> dependencies (Redis) ready
- `GET /metrics` -> Prometheus metrics

## Security

Optional signed webhook mode:
- `WEBHOOK_HMAC_SECRET`
- `WEBHOOK_REPLAY_WINDOW_MS`

Signature format:
- header timestamp: `x-webhook-timestamp`
- header signature: `x-webhook-signature`
- digest input: `${timestamp}.${rawBody}`
- algorithm: `sha256`

## Render notes

Use `render.yaml` blueprint to provision:
- Staging stack (`api + worker + redis` on Sepolia)
- Production stack (`api + worker + redis` on mainnet)

Set all secrets in Render dashboard (do not commit secrets in `.env`).

## Development quick flow

1. Start full development stack:
   ```bash
   docker compose -f docker-compose-dev.yml up --build
   ```
2. Start tunnel:
   ```bash
   npx ngrok http 3000
   ```
3. If you run app outside docker, use local redis URL:
   ```bash
   REDIS_URL=redis://127.0.0.1:6379 yarn start:watch
   ```

## Queue/DLQ runbook

- Retry behavior:
  - `ALERT_JOB_ATTEMPTS` controls max attempts.
  - `ALERT_JOB_BACKOFF_MS` controls exponential backoff base.
  - `ALERT_EXECUTION_LOCK_TTL_MS` controls execution lock hold time.
- Terminal failures:
  - failed jobs are copied to dead-letter queue `tv-alerts-dlq`.
  - alert state is marked `FAILED` with `lastError`.
- Operational checks:
  - API liveness: `GET /health`
  - dependency readiness: `GET /ready`
  - metrics: `GET /metrics`
