declare namespace NodeJS {
	interface ProcessEnv {
		readonly GAINS_PRIVATE_KEY: string;
		readonly GAINS_LEVERAGE: string;
		readonly GAINS_COLLATERAL: string;
		readonly GAINS_RPC_URL: string;
		readonly GAINS_CHAIN_ID: string;
		readonly GAINS_BACKEND_URL: string;
		readonly GAINS_SLIPPAGE: string;
		readonly GAINS_REFERRER: string;
		readonly GAINS_FILL_POLL_MS: string;
		readonly GAINS_FILL_WATCH_MS: string;
		readonly TRADINGVIEW_PASSPHRASE: string;
		readonly SENTRY_DNS: string;
		readonly WEBHOOK_SCHEMA_PROBE: string;
	}
}
