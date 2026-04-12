import {
	normalizeGainsPairKey,
	PRICE_PRECISION,
	LEVERAGE_PRECISION
} from '../src/services/gains/constants';

describe('gains constants', () => {
	test('normalizeGainsPairKey maps common TV tickers', () => {
		expect(normalizeGainsPairKey('BTCUSDT')).toBe('BTC/USD');
		expect(normalizeGainsPairKey('ETHUSD')).toBe('ETH/USD');
		expect(normalizeGainsPairKey('ETH/USD')).toBe('ETH/USD');
		expect(normalizeGainsPairKey('SOL-USDT')).toBe('SOL/USD');
	});

	test('precision constants match gTrade SDK', () => {
		expect(PRICE_PRECISION).toBe(1e10);
		expect(LEVERAGE_PRECISION).toBe(1000);
	});
});
