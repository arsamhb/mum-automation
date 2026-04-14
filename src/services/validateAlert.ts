import { AlertObject } from '../types';
import { DexRegistry } from './dexRegistry';
import { getStrategyStateAdapter } from '../state/strategyStateAdapter';

export const validateAlert = async (
	alertMessage: AlertObject
): Promise<boolean> => {
	// check correct alert JSON format
	if (!Object.keys(alertMessage).length) {
		console.error('Tradingview alert is not JSON format.');
		return false;
	}

	// check passphrase
	if (process.env.TRADINGVIEW_PASSPHRASE && !alertMessage.passphrase) {
		console.error('Passphrase is not set on alert message.');
		return false;
	}
	if (
		alertMessage.passphrase &&
		alertMessage.passphrase != process.env.TRADINGVIEW_PASSPHRASE
	) {
		console.error('Passphrase from tradingview alert does not match to config');
		return false;
	}

	// check exchange
	if (alertMessage.exchange) {
		const validExchanges = new DexRegistry().getAllDexKeys();
		if (!validExchanges.includes(alertMessage.exchange.toLowerCase())) {
			console.error('Exchange name must be one of: ' + validExchanges.join(', '));
			return false;
		}
	}

	// check strategy name
	if (!alertMessage.strategy) {
		console.error('Strategy field of tradingview alert must not be empty');
		return false;
	}

	// check orderSide
	if (alertMessage.order != 'buy' && alertMessage.order != 'sell') {
		console.error(
			'Side field of tradingview alert is not correct. Must be buy or sell'
		);
		return false;
	}

	//check position
	if (
		alertMessage.position != 'long' &&
		alertMessage.position != 'short' &&
		alertMessage.position != 'flat'
	) {
		console.error('Position field of tradingview alert is not correct.');
		return false;
	}

	//check reverse
	if (typeof alertMessage.reverse != 'boolean') {
		console.error(
			'Reverse field of tradingview alert is not correct. Must be true or false.'
		);
		return false;
	}

	const stateAdapter = getStrategyStateAdapter();
	stateAdapter.ensureStrategy(alertMessage.strategy, alertMessage.reverse);
	const strategyState = stateAdapter.getStrategy(alertMessage.strategy);
	console.log('strategyData', strategyState);

	if (
		alertMessage.position == 'flat' &&
		stateAdapter.isFirstOrder(alertMessage.strategy)
	) {
		console.log(
			'this alert is first and close order; it will be skipped until a long/short opens.'
		);
		return true;
	}

	return true;
};
