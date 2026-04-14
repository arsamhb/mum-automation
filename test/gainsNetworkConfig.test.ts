import {
	GAINS_MAINNET,
	GAINS_SEPOLIA,
	GainsYamlFallback,
	resolveGainsNetworkConfig
} from '../src/services/gains/gainsNetworkConfig';

const yamlProd: GainsYamlFallback = {
	chainId: 42161,
	rpc: 'https://arb1.arbitrum.io/rpc',
	backendUrl: 'https://backend-arbitrum.gains.trade'
};

const yamlDev: GainsYamlFallback = {
	chainId: 421614,
	rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
	backendUrl: 'https://backend-sepolia.gains.trade'
};

describe('resolveGainsNetworkConfig', () => {
	test('yaml fallback when GAINS_NETWORK unset and no explicit env', () => {
		const r = resolveGainsNetworkConfig(
			{},
			() => yamlProd
		);
		expect(r).toEqual({
			chainId: 42161,
			rpc: 'https://arb1.arbitrum.io/rpc',
			backendUrl: 'https://backend-arbitrum.gains.trade'
		});
	});

	test('GAINS_NETWORK=sepolia selects Sepolia preset', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_NETWORK: 'sepolia' },
			() => yamlProd
		);
		expect(r.chainId).toBe(GAINS_SEPOLIA.chainId);
		expect(r.rpc).toBe(GAINS_SEPOLIA.rpc);
		expect(r.backendUrl).toBe(GAINS_SEPOLIA.backendUrl);
	});

	test('GAINS_NETWORK=mainnet selects mainnet preset even if yaml is dev', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_NETWORK: 'mainnet' },
			() => yamlDev
		);
		expect(r.chainId).toBe(GAINS_MAINNET.chainId);
		expect(r.rpc).toBe(GAINS_MAINNET.rpc);
		expect(r.backendUrl).toBe(GAINS_MAINNET.backendUrl);
	});

	test('explicit GAINS_CHAIN_ID overrides preset', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_NETWORK: 'sepolia', GAINS_CHAIN_ID: '42161' },
			() => yamlDev
		);
		expect(r.chainId).toBe(42161);
		expect(r.rpc).toBe(GAINS_SEPOLIA.rpc);
		expect(r.backendUrl).toBe(GAINS_SEPOLIA.backendUrl);
	});

	test('explicit GAINS_RPC_URL overrides preset', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_NETWORK: 'mainnet', GAINS_RPC_URL: 'https://custom.rpc/example' },
			() => yamlProd
		);
		expect(r.rpc).toBe('https://custom.rpc/example');
		expect(r.chainId).toBe(GAINS_MAINNET.chainId);
	});

	test('explicit GAINS_BACKEND_URL overrides preset', () => {
		const r = resolveGainsNetworkConfig(
			{
				GAINS_NETWORK: 'sepolia',
				GAINS_BACKEND_URL: 'https://custom.backend/'
			},
			() => yamlProd
		);
		expect(r.backendUrl).toBe('https://custom.backend');
	});

	test('trims trailing slash from backend URL', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_BACKEND_URL: 'https://backend-arbitrum.gains.trade/' },
			() => yamlProd
		);
		expect(r.backendUrl).toBe('https://backend-arbitrum.gains.trade');
	});

	test('invalid GAINS_NETWORK throws', () => {
		expect(() =>
			resolveGainsNetworkConfig({ GAINS_NETWORK: 'goerli' }, () => yamlProd)
		).toThrow(/must be "mainnet" or "sepolia"/);
	});

	test('case-insensitive GAINS_NETWORK', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_NETWORK: 'MAINNET' },
			() => yamlDev
		);
		expect(r.chainId).toBe(GAINS_MAINNET.chainId);
	});

	test('new GAINS_NETWORK_NAME alias is supported', () => {
		const r = resolveGainsNetworkConfig(
			{ GAINS_NETWORK_NAME: 'sepolia' },
			() => yamlProd
		);
		expect(r.chainId).toBe(GAINS_SEPOLIA.chainId);
	});

	test('new per-field aliases override selected preset', () => {
		const r = resolveGainsNetworkConfig(
			{
				GAINS_NETWORK_NAME: 'mainnet',
				GAINS_CHAIN_ID_DECIMAL: '421614',
				GAINS_RPC_HTTP_URL: 'https://example.rpc',
				GAINS_BACKEND_HTTP_URL: 'https://example.backend/'
			},
			() => yamlProd
		);
		expect(r.chainId).toBe(421614);
		expect(r.rpc).toBe('https://example.rpc');
		expect(r.backendUrl).toBe('https://example.backend');
	});
});
