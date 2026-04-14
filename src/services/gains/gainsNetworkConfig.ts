export const GAINS_MAINNET = {
	chainId: 42161,
	rpc: 'https://arb1.arbitrum.io/rpc',
	backendUrl: 'https://backend-arbitrum.gains.trade'
} as const;

export const GAINS_SEPOLIA = {
	chainId: 421614,
	rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
	backendUrl: 'https://backend-sepolia.gains.trade'
} as const;

export type GainsYamlFallback = {
	chainId: number;
	rpc: string;
	backendUrl: string;
};

function defaultYamlFallback(): GainsYamlFallback {
	// Lazy require so tests can inject getYamlFallback without loading node-config.
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const config = require('config');
	return {
		chainId: config.get('Gains.Network.chainId') as number,
		rpc: config.get('Gains.Network.rpc') as string,
		backendUrl: (config.get('Gains.Backend.url') as string).replace(/\/$/, '')
	};
}

type ResolvedGainsNetwork = {
	chainId: number;
	rpc: string;
	backendUrl: string;
};

/** Narrow env shape so tests can pass partial objects (ProcessEnv may be augmented with required keys). */
type GainsEnvSource = Record<string, string | undefined>;

function readFirstEnv(env: GainsEnvSource, ...keys: string[]): string | undefined {
	for (const k of keys) {
		const v = env[k]?.trim();
		if (v) return v;
	}
	return undefined;
}

/**
 * Per-field resolution: explicit GAINS_* env, then GAINS_NETWORK preset, then config YAML (NODE_ENV).
 */
export function resolveGainsNetworkConfig(
	env: GainsEnvSource = process.env as GainsEnvSource,
	getYamlFallback: () => GainsYamlFallback = defaultYamlFallback
): ResolvedGainsNetwork {
	const raw = readFirstEnv(env, 'GAINS_NETWORK_NAME', 'GAINS_NETWORK')?.toLowerCase();
	if (raw && raw !== 'mainnet' && raw !== 'sepolia') {
		throw new Error(
			`GAINS_NETWORK_NAME (or legacy GAINS_NETWORK) must be "mainnet" or "sepolia", got "${raw}"`
		);
	}
	const preset =
		raw === 'mainnet'
			? GAINS_MAINNET
			: raw === 'sepolia'
				? GAINS_SEPOLIA
				: undefined;
	const yaml = getYamlFallback();

	const chainIdEnv = readFirstEnv(env, 'GAINS_CHAIN_ID_DECIMAL', 'GAINS_CHAIN_ID');
	const chainId = chainIdEnv
		? parseInt(chainIdEnv, 10)
		: preset?.chainId ?? yaml.chainId;

	const rpc =
		readFirstEnv(env, 'GAINS_RPC_HTTP_URL', 'GAINS_RPC_URL') ||
		(preset?.rpc ?? yaml.rpc);

	const backendUrl = (
		readFirstEnv(env, 'GAINS_BACKEND_HTTP_URL', 'GAINS_BACKEND_URL') ||
		preset?.backendUrl ||
		yaml.backendUrl
	).replace(/\/$/, '');

	return { chainId, rpc, backendUrl };
}
