import { GainsClient } from '../src/services/gains/gainsClient';
import { AlertObject } from '../src/types';

function mkAlert(partial: Partial<AlertObject> = {}): AlertObject {
	return {
		exchange: 'gains',
		strategy: 'Aura',
		market: 'XAUUSD',
		sizeUsd: 1000,
		order: 'buy',
		price: 3000,
		position: 'long',
		reverse: false,
		...partial
	};
}

describe('GainsClient close-then-open behavior', () => {
	let client: GainsClient;

	beforeEach(() => {
		client = new GainsClient();
		(client as any).signer = { address: '0x0000000000000000000000000000000000000001' };
		(client as any).traderAddress = '0x0000000000000000000000000000000000000001';
		(client as any).exportOrder = jest.fn(async () => undefined);
	});

	test('closes existing position before opening new one', async () => {
		const order: string[] = [];
		(client as any).closeAllOpenTradesForPair = jest.fn(async () => {
			order.push('close');
			return { closedCount: 1, lastOrderId: '0xclose' };
		});
		(client as any).openMarket = jest.fn(async (_a: AlertObject, _c: unknown, targetLong: boolean) => {
			order.push('open');
			expect(targetLong).toBe(true);
			return { size: 1000, side: 'BUY', orderId: '0xopen' };
		});

		const result = await client.placeOrder(mkAlert({ order: 'buy', position: 'long' }));
		expect(result.success).toBe(true);
		expect(result.orderId).toBe('0xopen');
		expect(order).toEqual(['close', 'open']);
	});

	test('still opens when no position is currently open', async () => {
		(client as any).closeAllOpenTradesForPair = jest.fn(async () => ({
			closedCount: 0
		}));
		(client as any).openMarket = jest.fn(async () => ({
			size: 1000,
			side: 'SELL',
			orderId: '0xopen'
		}));

		const result = await client.placeOrder(mkAlert({ order: 'sell', position: 'short' }));
		expect(result.success).toBe(true);
		expect((client as any).openMarket).toHaveBeenCalledTimes(1);
	});

	test('does not open when close phase fails', async () => {
		(client as any).closeAllOpenTradesForPair = jest.fn(async () => {
			throw new Error('Close reconciliation pending for XAUUSD');
		});
		(client as any).openMarket = jest.fn(async () => ({
			size: 1000,
			side: 'BUY',
			orderId: '0xopen'
		}));

		const result = await client.placeOrder(mkAlert());
		expect(result.success).toBe(false);
		expect(result.message).toContain('Close reconciliation pending');
		expect((client as any).openMarket).not.toHaveBeenCalled();
	});

	test('fails when open phase fails after close phase', async () => {
		(client as any).closeAllOpenTradesForPair = jest.fn(async () => ({
			closedCount: 1,
			lastOrderId: '0xclose'
		}));
		(client as any).openMarket = jest.fn(async () => undefined);

		const result = await client.placeOrder(mkAlert());
		expect(result.success).toBe(false);
		expect(result.message).toContain('not submitted after close phase');
	});
});
