import * as fs from 'fs';
import config from 'config';
import { getStrategiesDB } from '../helper';

type StrategyRow = {
	isFirstOrder?: string;
	position?: number;
	reverse?: boolean;
};

type TradeHistoryRow = {
	strategy: string;
	market: string;
	side: string;
	size: number;
	tradingviewPrice: number;
	orderId: string;
};

export interface StrategyStateAdapter {
	getStrategy(strategy: string): StrategyRow | undefined;
	ensureStrategy(strategy: string, reverse: boolean): void;
	isFirstOrder(strategy: string): boolean;
	getPosition(strategy: string): number;
	markFirstOrderConsumed(strategy: string): void;
	applyPositionDelta(strategy: string, delta: number): number;
	appendTradeHistory(exchange: string, row: TradeHistoryRow): void;
}

class FileStrategyStateAdapter implements StrategyStateAdapter {
	private getEnvironment(): 'mainnet' | 'testnet' {
		return config.util.getEnv('NODE_ENV') == 'production' ? 'mainnet' : 'testnet';
	}

	getStrategy(strategy: string): StrategyRow | undefined {
		const [, rootData] = getStrategiesDB();
		return rootData[strategy] as StrategyRow | undefined;
	}

	ensureStrategy(strategy: string, reverse: boolean): void {
		const [db, rootData] = getStrategiesDB();
		if (rootData[strategy]) return;
		const rootPath = '/' + strategy;
		db.push(rootPath + '/reverse', reverse);
		db.push(rootPath + '/isFirstOrder', 'true');
		db.push(rootPath + '/position', 0);
	}

	isFirstOrder(strategy: string): boolean {
		return this.getStrategy(strategy)?.isFirstOrder === 'true';
	}

	getPosition(strategy: string): number {
		return Number(this.getStrategy(strategy)?.position ?? 0);
	}

	markFirstOrderConsumed(strategy: string): void {
		const [db] = getStrategiesDB();
		db.push('/' + strategy + '/isFirstOrder', 'false');
	}

	applyPositionDelta(strategy: string, delta: number): number {
		const [db] = getStrategiesDB();
		const next = this.getPosition(strategy) + Number(delta);
		db.push('/' + strategy + '/position', next);
		return next;
	}

	appendTradeHistory(exchange: string, row: TradeHistoryRow): void {
		const environment = this.getEnvironment();
		const folderPath = './data/exports/' + environment;
		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath, {
				recursive: true
			});
		}
		const fullPath = folderPath + `/tradeHistory${exchange}.csv`;
		if (!fs.existsSync(fullPath)) {
			const headerString =
				'datetime,strategy,market,sideUsd,size,tradingviewPrice,order_id';
			fs.writeFileSync(fullPath, headerString);
		}
		const appendArray = [
			new Date().toISOString(),
			row.strategy,
			row.market,
			row.side,
			row.size,
			row.tradingviewPrice,
			row.orderId
		];
		fs.appendFileSync(fullPath, '\r\n' + appendArray.join());
	}
}

let strategyStateAdapter: StrategyStateAdapter | undefined;

export function getStrategyStateAdapter(): StrategyStateAdapter {
	if (!strategyStateAdapter) {
		strategyStateAdapter = new FileStrategyStateAdapter();
	}
	return strategyStateAdapter;
}
