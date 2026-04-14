import { resolveGainsNetworkConfig } from '../services/gains/gainsNetworkConfig';

type RuntimeRole = 'api' | 'worker';
type RuntimeEnvOptions = { requireQueue: boolean; role: RuntimeRole };

const REQUIRED_WHEN_QUEUE_ENABLED = ['REDIS_URL'];
const WORKER_SIGNER_KEYS = ['GAINS_SIGNER_PRIVATE_KEY', 'GAINS_PRIVATE_KEY'];
const NETWORK_SELECTOR_KEYS = ['GAINS_NETWORK_NAME', 'GAINS_NETWORK'];
const NETWORK_OVERRIDE_KEYS = [
	'GAINS_CHAIN_ID_DECIMAL',
	'GAINS_CHAIN_ID',
	'GAINS_RPC_HTTP_URL',
	'GAINS_RPC_URL',
	'GAINS_BACKEND_HTTP_URL',
	'GAINS_BACKEND_URL'
];

function hasAny(keys: string[]): boolean {
	return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function assertNetworkConfigIsValid(): void {
	// Resolves and validates selector values (throws on invalid value).
	resolveGainsNetworkConfig();

	const hasSelector = hasAny(NETWORK_SELECTOR_KEYS);
	const overridesProvided = NETWORK_OVERRIDE_KEYS.filter((key) =>
		Boolean(process.env[key]?.trim())
	);
	if (!hasSelector || overridesProvided.length === 0) return;

	const hasChainOverride = hasAny(['GAINS_CHAIN_ID_DECIMAL', 'GAINS_CHAIN_ID']);
	const hasRpcOverride = hasAny(['GAINS_RPC_HTTP_URL', 'GAINS_RPC_URL']);
	const hasBackendOverride = hasAny([
		'GAINS_BACKEND_HTTP_URL',
		'GAINS_BACKEND_URL'
	]);
	if (hasChainOverride && hasRpcOverride && hasBackendOverride) return;

	throw new Error(
		'When GAINS_NETWORK_NAME is set, network overrides must provide chainId + rpc + backend together to avoid mixed-network config.'
	);
}

function assertApiSecurityInProduction(): void {
	const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
	if (nodeEnv !== 'production') return;
	if (process.env.ALLOW_INSECURE_WEBHOOK_IN_PROD === 'true') return;
	if (process.env.WEBHOOK_HMAC_SECRET?.trim()) return;
	throw new Error(
		'Missing required env var WEBHOOK_HMAC_SECRET for production API. Set ALLOW_INSECURE_WEBHOOK_IN_PROD=true to bypass (not recommended).'
	);
}

function assertWorkerTradingEnv(): void {
	if (!hasAny(WORKER_SIGNER_KEYS)) {
		throw new Error(
			'Missing required worker signer key: set GAINS_SIGNER_PRIVATE_KEY (or legacy GAINS_PRIVATE_KEY).'
		);
	}
}

export function validateRuntimeEnv(options: RuntimeEnvOptions): void {
	const missing: string[] = [];
	if (options.requireQueue) {
		for (const key of REQUIRED_WHEN_QUEUE_ENABLED) {
			if (!process.env[key]?.trim()) missing.push(key);
		}
	}
	if (missing.length > 0) {
		throw new Error(`Missing required env vars: ${missing.join(', ')}`);
	}

	assertNetworkConfigIsValid();
	if (options.role === 'api') {
		assertApiSecurityInProduction();
	} else {
		assertWorkerTradingEnv();
	}
}
