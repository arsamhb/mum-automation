const mockData: Record<string, any> = {};
const mockAdapter = {
	getStrategy: jest.fn((strategy: string) => mockData[strategy]),
	ensureStrategy: jest.fn((strategy: string, reverse: boolean) => {
		if (!mockData[strategy]) {
			mockData[strategy] = {
				reverse,
				isFirstOrder: 'true',
				position: 0
			};
		}
	}),
	isFirstOrder: jest.fn((strategy: string) => mockData[strategy]?.isFirstOrder === 'true'),
	getPosition: jest.fn((strategy: string) => Number(mockData[strategy]?.position ?? 0)),
	markFirstOrderConsumed: jest.fn(),
	applyPositionDelta: jest.fn(),
	appendTradeHistory: jest.fn()
};

jest.mock('../src/state/strategyStateAdapter', () => ({
	getStrategyStateAdapter: jest.fn(() => mockAdapter)
}));

jest.mock('../src/services/dexRegistry', () => ({
	DexRegistry: jest.fn().mockImplementation(() => ({
		getAllDexKeys: jest.fn(() => ['gains', 'gtrade', 'gns'])
	}))
}));

import { validateAlert } from '../src/services/validateAlert';
import { AlertObject } from '../src/types';

describe('validateAlert', () => {
	const baseAlert: AlertObject = {
		exchange: 'gains',
		strategy: 'TestStrategy',
		market: 'BTC-USD',
		size: 0.1,
		order: 'buy',
		price: 50000,
		position: 'long',
		reverse: false
	};

	beforeEach(() => {
		Object.keys(mockData).forEach((key) => delete mockData[key]);
	});

	describe('exchange validation', () => {
		it('accepts "gains" as valid exchange', async () => {
			const result = await validateAlert({ ...baseAlert, exchange: 'gains' });
			expect(result).toBe(true);
		});

		it('accepts "gtrade" as valid exchange', async () => {
			const result = await validateAlert({
				...baseAlert,
				exchange: 'gtrade'
			});
			expect(result).toBe(true);
		});

		it('accepts "gns" as valid exchange', async () => {
			const result = await validateAlert({
				...baseAlert,
				exchange: 'gns'
			});
			expect(result).toBe(true);
		});

		it('rejects invalid exchange name', async () => {
			const result = await validateAlert({
				...baseAlert,
				exchange: 'binance'
			});
			expect(result).toBe(false);
		});
	});

	describe('passphrase validation', () => {
		const originalEnv = process.env;

		beforeEach(() => {
			process.env = { ...originalEnv };
		});

		afterEach(() => {
			process.env = originalEnv;
		});

		it('passes when no passphrase is configured', async () => {
			(process.env as any).TRADINGVIEW_PASSPHRASE = undefined;
			const result = await validateAlert(baseAlert);
			expect(result).toBe(true);
		});

		it('rejects when passphrase is configured but not in alert', async () => {
			(process.env as any).TRADINGVIEW_PASSPHRASE = 'secret';
			const alert = { ...baseAlert, passphrase: undefined };
			const result = await validateAlert(alert);
			expect(result).toBe(false);
		});

		it('rejects when passphrase does not match', async () => {
			(process.env as any).TRADINGVIEW_PASSPHRASE = 'secret';
			const result = await validateAlert({
				...baseAlert,
				passphrase: 'wrong'
			});
			expect(result).toBe(false);
		});

		it('accepts when passphrase matches', async () => {
			(process.env as any).TRADINGVIEW_PASSPHRASE = 'secret';
			const result = await validateAlert({
				...baseAlert,
				passphrase: 'secret'
			});
			expect(result).toBe(true);
		});
	});

	describe('field validation', () => {
		it('rejects empty strategy', async () => {
			const result = await validateAlert({
				...baseAlert,
				strategy: ''
			});
			expect(result).toBe(false);
		});

		it('rejects invalid order side', async () => {
			const result = await validateAlert({
				...baseAlert,
				order: 'long' as any
			});
			expect(result).toBe(false);
		});

		it('rejects invalid position', async () => {
			const result = await validateAlert({
				...baseAlert,
				position: 'buy' as any
			});
			expect(result).toBe(false);
		});

		it('accepts valid positions: long, short, flat', async () => {
			for (const pos of ['long', 'short', 'flat']) {
				const result = await validateAlert({
					...baseAlert,
					position: pos
				});
				if (pos !== 'flat') {
					expect(result).toBe(true);
				}
			}
		});

		it('rejects non-boolean reverse field', async () => {
			const result = await validateAlert({
				...baseAlert,
				reverse: 'true' as any
			});
			expect(result).toBe(false);
		});

		it('rejects empty JSON body', async () => {
			const result = await validateAlert({} as AlertObject);
			expect(result).toBe(false);
		});
	});
});
