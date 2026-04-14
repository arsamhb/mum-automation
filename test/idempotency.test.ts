import {
	buildExecutionLockKey,
	buildIdempotencyKey,
	buildPositionKey
} from '../src/alerts/idempotency';
import { NormalizedAlert } from '../src/types';

function mkAlert(partial: Partial<NormalizedAlert> = {}): NormalizedAlert {
	return {
		alertId: 'a1',
		schemaVersion: '1.0.0',
		sourceTimestamp: '2026-04-14T07:51:00.000Z',
		receivedAt: '2026-04-14T07:51:01.000Z',
		exchange: 'gains',
		strategy: 'Aura',
		market: 'XAUUSD',
		order: 'buy',
		position: 'long',
		reverse: false,
		price: 100,
		...partial
	} as NormalizedAlert;
}

describe('idempotency helpers', () => {
	test('position key is stable and canonical', () => {
		expect(buildPositionKey(mkAlert())).toBe('gains:aura:XAUUSD');
	});

	test('lock key wraps position key', () => {
		expect(buildExecutionLockKey(mkAlert())).toBe('lock:gains:aura:XAUUSD');
	});

	test('idempotency key deterministic for same alert bucket', () => {
		const a = mkAlert();
		const b = mkAlert({ receivedAt: '2026-04-14T07:51:59.000Z' });
		expect(buildIdempotencyKey(a)).toBe(buildIdempotencyKey(b));
	});

	test('idempotency key changes for side/position changes', () => {
		const base = buildIdempotencyKey(mkAlert());
		expect(buildIdempotencyKey(mkAlert({ order: 'sell' }))).not.toBe(base);
		expect(buildIdempotencyKey(mkAlert({ position: 'short' }))).not.toBe(base);
	});
});
