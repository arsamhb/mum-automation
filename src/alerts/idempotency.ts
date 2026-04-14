import { createHash } from 'crypto';
import { NormalizedAlert } from '../types';

function minuteBucket(isoTs: string): string {
	const ms = Date.parse(isoTs);
	if (!Number.isFinite(ms)) return '0';
	return String(Math.floor(ms / 60_000));
}

export function buildPositionKey(alert: NormalizedAlert): string {
	return [
		alert.exchange,
		alert.strategy.toLowerCase(),
		alert.market.toUpperCase()
	].join(':');
}

export function buildExecutionLockKey(alert: NormalizedAlert): string {
	return `lock:${buildPositionKey(alert)}`;
}

export function buildIdempotencyKey(alert: NormalizedAlert): string {
	const payload = [
		alert.exchange.toLowerCase(),
		alert.strategy.toLowerCase(),
		alert.market.toUpperCase(),
		alert.order.toLowerCase(),
		alert.position.toLowerCase(),
		minuteBucket(alert.sourceTimestamp),
		alert.size ?? '',
		alert.sizeUsd ?? '',
		alert.sizeByLeverage ?? '',
		alert.leverage ?? ''
	].join('|');
	return createHash('sha256').update(payload).digest('hex');
}
