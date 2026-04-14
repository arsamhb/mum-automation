declare namespace NodeJS {
	interface ProcessEnv {
		readonly GAINS_SIGNER_PRIVATE_KEY: string;
		readonly GAINS_PRIVATE_KEY: string;
		readonly GAINS_TRADER_ADDRESS: string;
		readonly GAINS_TRADE_LEVERAGE: string;
		readonly GAINS_LEVERAGE: string;
		readonly GAINS_COLLATERAL_SYMBOL: string;
		readonly GAINS_COLLATERAL: string;
		readonly GAINS_NETWORK_NAME: string;
		readonly GAINS_NETWORK: string;
		readonly GAINS_RPC_HTTP_URL: string;
		readonly GAINS_RPC_URL: string;
		readonly GAINS_CHAIN_ID_DECIMAL: string;
		readonly GAINS_CHAIN_ID: string;
		readonly GAINS_BACKEND_HTTP_URL: string;
		readonly GAINS_BACKEND_URL: string;
		readonly GAINS_PRICE_SLIPPAGE_PCT: string;
		readonly GAINS_SLIPPAGE: string;
		readonly GAINS_REFERRER_ADDRESS: string;
		readonly GAINS_REFERRER: string;
		readonly GAINS_FILL_POLL_INTERVAL_MS: string;
		readonly GAINS_FILL_POLL_MS: string;
		readonly GAINS_FILL_WATCH_TIMEOUT_MS: string;
		readonly GAINS_FILL_WATCH_MS: string;
		readonly TRADINGVIEW_PASSPHRASE: string;
		readonly SENTRY_DNS: string;
		readonly WEBHOOK_SCHEMA_PROBE: string;
		readonly HTTP_LOGGING_ENABLED: string;
		readonly HTTP_LOG_BODY_ENABLED: string;
		/** Set to 1 or true to start an ngrok tunnel and print the public webhook URL (local dev). */
		readonly WEBHOOK_EXPOSE_NGROK: string;
		readonly NGROK_AUTHTOKEN: string;
		readonly WEBHOOK_HMAC_SECRET: string;
		readonly WEBHOOK_REPLAY_WINDOW_MS: string;
		readonly REDIS_URL: string;
		readonly ALERT_JOB_ATTEMPTS: string;
		readonly ALERT_JOB_BACKOFF_MS: string;
		readonly ALERT_WORKER_CONCURRENCY: string;
		readonly ALERT_EXECUTION_LOCK_TTL_MS: string;
		readonly METRICS_ENABLED: string;
		readonly PORT: string;
	}
}
