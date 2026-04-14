import { AlertObject, OrderResult, PlaceOrderResult } from '../types';
import { getStrategyStateAdapter } from '../state/strategyStateAdapter';

export abstract class AbstractDexClient {
	abstract getIsAccountReady(): Promise<boolean>;
	abstract placeOrder(alertMessage: AlertObject): Promise<PlaceOrderResult>;

	exportOrder = async (
		exchange: string,
		strategy: string,
		orderResult: OrderResult,
		tradingviewPrice: number,
		market: string
	) => {
		const stateAdapter = getStrategyStateAdapter();
		stateAdapter.markFirstOrderConsumed(strategy);
		const orderSize = Number(orderResult.size);
		const position = orderResult.side == 'BUY' ? orderSize : -1 * orderSize;
		stateAdapter.applyPositionDelta(strategy, position);
		stateAdapter.appendTradeHistory(exchange, {
			strategy,
			market,
			side: orderResult.side,
			size: orderResult.size,
			tradingviewPrice,
			orderId: orderResult.orderId
		});
	};
}
