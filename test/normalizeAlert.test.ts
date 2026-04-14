import { normalizeAlert } from '../src/alerts/normalizeAlert';
import { AlertObject } from '../src/types';

describe('normalizeAlert', () => {
	test('canonicalizes leverage aliases', () => {
		const payload: AlertObject = {
			exchange: 'Gtrade',
			strategy: 'Aura',
			market: 'XAUUSD',
			sizeUsd: 1000,
			levrage: 10,
			order: 'buy',
			position: 'long',
			price: 1234,
			reverse: false
		};
		const normalized = normalizeAlert(payload);
		expect(normalized.exchange).toBe('gtrade');
		expect(normalized.leverage).toBe(10);
		expect(typeof normalized.alertId).toBe('string');
		expect(normalized.schemaVersion).toBe('1.0.0');
	});

	test('coerces number-like fields', () => {
		const payload = {
			exchange: 'gains',
			strategy: 'Aura',
			market: 'XAUUSD',
			size: '2' as unknown as number,
			price: '1234.5' as unknown as number,
			order: 'buy',
			position: 'long',
			reverse: false
		} as AlertObject;
		const normalized = normalizeAlert(payload);
		expect(normalized.size).toBe(2);
		expect(normalized.price).toBe(1234.5);
	});
});
