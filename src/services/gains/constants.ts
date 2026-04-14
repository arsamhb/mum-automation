/**
 * gTrade pair keys follow backend `pairIndexes` format: "BASE/QUOTE" (e.g. ETH/USD).
 */
export const PRICE_PRECISION = 1e10;
export const LEVERAGE_PRECISION = 1000;

/** Normalize TradingView / common ticker strings to gTrade pair key. */
export function normalizeGainsPairKey(market: string): string {
	const raw = market.trim().toUpperCase().replace(/[-_]/g, '');
	if (raw.includes('/')) {
		const [base, quote] = raw.split('/');
		const q = quote === 'USDT' || quote === 'USD' ? 'USD' : quote;
		return `${base}/${q}`;
	}
	const noPerp = raw.replace(/(PERP|PERPETUAL)$/i, '');
	if (noPerp.endsWith('USDT')) {
		return `${noPerp.slice(0, -4)}/USD`;
	}
	if (noPerp.endsWith('USD')) {
		return `${noPerp.slice(0, -3)}/USD`;
	}
	console.log('************************************************ market ****************', market);
	return market.trim();
}


