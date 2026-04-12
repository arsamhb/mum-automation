# Tradingview-Alert-Connector

Self-hosted service that receives TradingView strategy webhook alerts and executes trades on **[Gains Network (gTrade)](https://gains.trade/)** via wallet-signed transactions.

# Supported venue

| Exchange   | Network        | Type              |
| ---------- | -------------- | ----------------- |
| Gains gTrade | Arbitrum One / Sepolia (see config) | Perpetual futures |

Alert payloads use JSON (see `examples/tradingview-gains-alert.json`). The server accepts `text/plain` bodies from TradingView and parses JSON or plain `buy`/`sell` (see `captureWebhookBody` middleware).

# Docs

https://tv-connector.gitbook.io/docs/

# Prerequisites

- TradingView account with webhook-capable alerts
- A funded gTrade-compatible wallet and env vars (`GAINS_PRIVATE_KEY`, `GAINS_LEVERAGE`, etc. — see `.env.sample`)

# Installation

```bash
git clone https://github.com/junta/tradingview-alert-connector.git
cd tradingview-alert-connector
npm install
```

Configure `config/` for your `NODE_ENV` and copy `.env.sample` to `.env`.

# Run

```bash
npm run build
npm run start:prod
```

# Tests

```bash
npm test
```
