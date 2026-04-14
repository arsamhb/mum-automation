import { AbstractDexClient } from '../abstractDexClient';
import { _sleep } from '../../helper';
import { AlertObject, OrderResult, PlaceOrderResult } from '../../types';
import config = require('config');
import 'dotenv/config';
import axios from 'axios';
import { BigNumber, ethers, constants as ethersConstants } from 'ethers';
import {
	COLLATERAL_TO_CHAIN_COLLATERAL_INDEX,
	CollateralTypes,
	CounterType,
	getContractsForChain,
	transformGlobalTradingVariables,
	TradeType
} from '@gainsnetwork/sdk';
import { LEVERAGE_PRECISION, normalizeGainsPairKey, PRICE_PRECISION } from './constants';
import { resolveGainsNetworkConfig } from './gainsNetworkConfig';
import { getStrategyStateAdapter } from '../../state/strategyStateAdapter';

const ERC20_ABI = [
	'function approve(address spender, uint256 amount) public returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function balanceOf(address account) view returns (uint256)',
	'function decimals() view returns (uint8)',
	'function symbol() view returns (string)'
];
const INSUFFICIENT_COLLATERAL_SELECTOR = '0x3a23d825';

function readFirstEnv(...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = process.env[key]?.trim();
		if (value) return value;
	}
	return undefined;
}

function resolveCollateralType(alertCollateral?: string): CollateralTypes {
	const key = (
		alertCollateral ||
		readFirstEnv('GAINS_COLLATERAL_SYMBOL', 'GAINS_COLLATERAL') ||
		'USDC'
	).toUpperCase();
	const map: Record<string, CollateralTypes> = {
		USDC: CollateralTypes.USDC,
		DAI: CollateralTypes.DAI,
		ETH: CollateralTypes.ETH,
		GNS: CollateralTypes.GNS
	};
	return map[key] ?? CollateralTypes.USDC;
}

function encodeOraclePrice(humanPrice: number): BigNumber {
	if (!Number.isFinite(humanPrice) || humanPrice <= 0) {
		throw new Error('Invalid price for gTrade (must be finite and > 0)');
	}
	return BigNumber.from(
		// eslint-disable-next-line @typescript-eslint/no-loss-of-precision
		Math.floor(humanPrice * PRICE_PRECISION)
	);
}

function encodeLeverage(leverage: number): number {
	return Math.round(leverage * LEVERAGE_PRECISION);
}

function parsePositiveNumber(value: unknown): number | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

function resolveLeverageFromAlert(
	alertMessage: AlertObject
): number | undefined {
	const fromAlert = parsePositiveNumber(
		alertMessage.leverage ?? alertMessage.levrage ?? alertMessage.Levrage
	);
	return fromAlert;
}

function firstHexData(values: Array<unknown>): string | undefined {
	for (const v of values) {
		if (typeof v === 'string' && v.startsWith('0x')) return v;
	}
	return undefined;
}

/** Poll interval / max wait for async oracle fill confirmation (env overrides). */
function getFillPollMs(): number {
	const v = readFirstEnv('GAINS_FILL_POLL_INTERVAL_MS', 'GAINS_FILL_POLL_MS');
	return v ? parseInt(v, 10) : 2000;
}

function getFillWatchMaxMs(): number {
	const v = readFirstEnv(
		'GAINS_FILL_WATCH_TIMEOUT_MS',
		'GAINS_FILL_WATCH_MS'
	);
	return v ? parseInt(v, 10) : 120_000;
}

export class GainsClient extends AbstractDexClient {
	private signer: ethers.Wallet | undefined;
	private readonly traderAddress: string | undefined;
	private readonly chainId: number;
	private readonly backendUrl: string;
	private readonly rpcUrl: string;
	private readonly collateral: CollateralTypes;

	constructor() {
		super();
		const net = resolveGainsNetworkConfig();
		this.chainId = net.chainId;
		this.backendUrl = net.backendUrl;
		this.rpcUrl = net.rpc;
		this.collateral = resolveCollateralType();
		this.signer = this.buildSigner();
		this.traderAddress = this.resolveTraderAddress();
		if (this.signer && this.traderAddress) {
			const mode =
				this.signer.address.toLowerCase() ===
				this.traderAddress.toLowerCase()
					? 'direct'
					: 'delegate';
			console.log(
				`Gains: chainId=${this.chainId} rpc=${this.rpcUrl} backend=${this.backendUrl} trader=${this.traderAddress} signer=${this.signer.address} mode=${mode}`
			);
		}
	}

	private buildSigner(): ethers.Wallet | undefined {
		const rawPk = readFirstEnv(
			'GAINS_SIGNER_PRIVATE_KEY',
			'GAINS_PRIVATE_KEY'
		);
		if (!rawPk) {
			console.log(
				'GAINS_SIGNER_PRIVATE_KEY (or legacy GAINS_PRIVATE_KEY) is not set; Gains (gTrade) client disabled'
			);
			return undefined;
		}
		const pk = rawPk.startsWith('0x') ? rawPk : '0x' + rawPk;
		const provider = ethers.getDefaultProvider(this.rpcUrl);
		return new ethers.Wallet(pk, provider);
	}

	private resolveTraderAddress(): string | undefined {
		const trader = readFirstEnv('GAINS_TRADER_ADDRESS');
		if (trader) return ethers.utils.getAddress(trader);
		return this.signer?.address;
	}

	getIsAccountReady = async (): Promise<boolean> => {
		try {
			if (!this.signer || !this.traderAddress) return false;
			const eth = await this.signer.getBalance();
			if (eth.lte(0)) {
				console.log('Gains: signer has zero ETH balance for gas');
				return false;
			}
			const { gnsMultiCollatDiamond } = getContractsForChain(
				this.chainId,
				this.signer,
				this.collateral
			);
			const coll = await gnsMultiCollatDiamond.getCollateral(
				this.getCollateralIndex(this.collateral)
			);
			const tokenAddr = coll.collateral;
			const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, this.signer);
			const [dec, bal] = await Promise.all([
				erc20.decimals(),
				erc20.balanceOf(this.traderAddress)
			]);
			console.log(
				`Gains: trader ${await erc20.symbol()} balance`,
				ethers.utils.formatUnits(bal, dec)
			);
			return bal.gt(0);
		} catch (e) {
			console.error('Gains getIsAccountReady', e);
			return false;
		}
	};

	private getCollateralIndex(c: CollateralTypes): number {
		const idx = COLLATERAL_TO_CHAIN_COLLATERAL_INDEX[this.chainId]?.[c];
		if (idx === undefined) {
			throw new Error(
				`Unsupported Gains collateral ${c} for chain ${this.chainId}`
			);
		}
		return idx;
	}

	private async fetchTradingVariablesRaw(): Promise<Record<string, unknown>> {
		const { data } = await axios.get<Record<string, unknown>>(
			`${this.backendUrl}/trading-variables`,
			{ timeout: 30_000 }
		);
		return data;
	}

	/**
	 * USD value of margin wallet for the selected collateral, from Gains backend.
	 * Stablecoins (USDC, DAI) are treated as ~USD. ETH/GNS require a USD mark — not supported here yet.
	 */
	private async fetchAccountEquityUsd(
		collateralType: CollateralTypes
	): Promise<number | undefined> {
		if (
			collateralType !== CollateralTypes.USDC &&
			collateralType !== CollateralTypes.DAI
		) {
			console.error(
				'Gains sizeByLeverage: use GAINS_COLLATERAL=USDC or DAI so margin balance is USD-denominated (ETH/GNS not supported for this path yet)'
			);
			return undefined;
		}
		const idx = this.getCollateralIndex(collateralType) - 1;
		const { data } = await axios.get<{
			collaterals?: Array<{ balance: string; decimals: number }>;
		}>(`${this.backendUrl}/user-trading-variables/${this.traderAddress}`, {
			timeout: 30_000
		});
		const row = data.collaterals?.[idx];
		if (!row) return undefined;
		const human =
			parseFloat(row.balance) / Math.pow(10, Number(row.decimals));
		return human;
	}

	placeOrder = async (
		alertMessage: AlertObject
	): Promise<PlaceOrderResult> => {
		if (!this.signer || !this.traderAddress) {
			console.error('GainsClient: signer/trader not configured');
			return {
				success: false,
				message: 'Gains signer/trader is not configured'
			};
		}
		if (alertMessage.size != null) alertMessage.size = Number(alertMessage.size);
		if (alertMessage.sizeUsd != null)
			alertMessage.sizeUsd = Number(alertMessage.sizeUsd);
		if (alertMessage.sizeByLeverage != null)
			alertMessage.sizeByLeverage = Number(alertMessage.sizeByLeverage);
		if (alertMessage.price != null)
			alertMessage.price = Number(alertMessage.price);
		try {
			const stateAdapter = getStrategyStateAdapter();
			const isFirstOrder = stateAdapter.isFirstOrder(alertMessage.strategy);
			if (alertMessage.position === 'flat' && isFirstOrder) {
				console.log(
					'Gains: skipping flat signal because strategy has no opened long/short yet'
				);
				return {
					success: true,
					skipped: true,
					message: 'Skipped flat signal before any long/short order'
				};
			}

			const collateralType = resolveCollateralType(alertMessage.collateral);
			if (alertMessage.position === 'flat') {
				const closeOnlyResult = await this.closeAllOpenTradesForPair(
					alertMessage,
					collateralType
				);
				if (closeOnlyResult.closedCount === 0) {
					return {
						success: true,
						skipped: true,
						message: 'Skipped flat signal because no open trade exists'
					};
				}
				return {
					success: true,
					orderId: closeOnlyResult.lastOrderId
				};
			}

			const targetLong = this.resolveTargetLong(alertMessage);
			if (targetLong === undefined) {
				return {
					success: false,
					message:
						'Could not resolve target side from alert (expected buy/long or sell/short)'
				};
			}

			const closeResult = await this.closeAllOpenTradesForPair(
				alertMessage,
				collateralType
			);
			const orderResult = await this.openMarket(
				alertMessage,
				collateralType,
				targetLong
			);
			if (!orderResult) {
				return {
					success: false,
					message:
						'Gains order was not submitted after close phase (preflight/revert)'
				};
			}
			await this.exportOrder(
				'Gains',
				alertMessage.strategy,
				orderResult,
				alertMessage.price,
				alertMessage.market
			);
			console.log(
				`Gains: close-then-open complete for ${alertMessage.market}; closed=${closeResult.closedCount}`
			);
			return {
				success: true,
				orderId: orderResult.orderId
			};
		} catch (e) {
			console.error('Gains placeOrder', e);
			return {
				success: false,
				message:
					e instanceof Error ? e.message : 'Unexpected Gains placeOrder error'
			};
		}
	};

	private async openMarket(
		alertMessage: AlertObject,
		collateralType: CollateralTypes,
		targetLong: boolean
	): Promise<OrderResult | undefined> {
		const raw = await this.fetchTradingVariablesRaw();
		const { pairIndexes } = transformGlobalTradingVariables(
			raw as unknown as Parameters<typeof transformGlobalTradingVariables>[0]
		);
		const pairKey = normalizeGainsPairKey(alertMessage.market);
		const pairIndex = (pairIndexes as Record<string, number>)[pairKey];
		if (pairIndex === undefined) {
			console.error(
				`Gains: pair not listed for key "${pairKey}" (from market "${alertMessage.market}")`
			);
			return undefined;
		}

		const leverageFromAlert = resolveLeverageFromAlert(alertMessage);
		const leverageFromEnv = parsePositiveNumber(
			readFirstEnv('GAINS_TRADE_LEVERAGE', 'GAINS_LEVERAGE')
		);
		const leverage = leverageFromAlert ?? leverageFromEnv;
		if (!Number.isFinite(leverage) || leverage <= 0) {
			console.error(
				'Leverage must be a positive number via alert field (leverage/levrage/Levrage) or env (GAINS_TRADE_LEVERAGE/GAINS_LEVERAGE)'
			);
			return undefined;
		}
		if (leverageFromAlert !== undefined && leverageFromEnv !== undefined) {
			console.log(
				`Gains: using leverage from alert (${leverageFromAlert}) instead of env (${leverageFromEnv})`
			);
		}

		let orderSizeUsd: number;
		if (alertMessage.sizeByLeverage) {
			const equityUsd = await this.fetchAccountEquityUsd(collateralType);
			if (equityUsd === undefined || equityUsd <= 0) {
				console.error(
					'Gains: could not read margin balance for sizeByLeverage (fund wallet / use USDC or DAI)'
				);
				return undefined;
			}
			// Notional USD ≈ margin equity × multiplier
			orderSizeUsd = equityUsd * Number(alertMessage.sizeByLeverage);
		} else if (alertMessage.size !== undefined) {
			// size is base-asset quantity; collateral is derived from notional = size * live price.
			orderSizeUsd = Number(alertMessage.size) * Number(alertMessage.price);
		} else if (alertMessage.sizeUsd !== undefined) {
			orderSizeUsd = alertMessage.sizeUsd;
		} else {
			console.error(
				'Gains: specify size, sizeUsd, or sizeByLeverage in the alert'
			);
			return undefined;
		}
		if (!Number.isFinite(orderSizeUsd) || orderSizeUsd <= 0) {
			console.error(
				'Gains: computed orderSizeUsd is invalid; provide valid size/sizeUsd + price + leverage'
			);
			return undefined;
		}

		const collateralUsd = orderSizeUsd / leverage;
		const long = targetLong;

		const { gnsMultiCollatDiamond } = getContractsForChain(
			this.chainId,
			this.signer,
			collateralType
		);

		const counter = await gnsMultiCollatDiamond.getCounters(
			this.traderAddress,
			CounterType.TRADE
		);
		const tradeIndex = counter.currentIndex;

		const coll = await gnsMultiCollatDiamond.getCollateral(
			this.getCollateralIndex(collateralType)
		);
		const tokenAddr = coll.collateral;
		const erc20 = new ethers.Contract(tokenAddr, ERC20_ABI, this.signer);
		const decimals = await erc20.decimals();
		const collateralWei = ethers.utils.parseUnits(
			collateralUsd.toFixed(Number(decimals)),
			decimals
		);

		const openPrice = encodeOraclePrice(alertMessage.price);
		const tp = BigNumber.from(0);
		const sl = BigNumber.from(0);

		const trade = {
			user: this.traderAddress,
			index: tradeIndex,
			pairIndex,
			leverage: encodeLeverage(leverage),
			long,
			isOpen: true,
			collateralIndex: this.getCollateralIndex(collateralType),
			tradeType: TradeType.TRADE,
			collateralAmount: collateralWei,
			openPrice,
			tp,
			sl,
			isCounterTrade: false,
			positionSizeToken: BigNumber.from(0),
			__placeholder: 0
		};

		const slippageRaw = readFirstEnv(
			'GAINS_PRICE_SLIPPAGE_PCT',
			'GAINS_SLIPPAGE'
		);
		const slippage = (slippageRaw
			? parseFloat(slippageRaw)
			: (config.get('Gains.User.slippage') as number)) as number;
		const maxSlippageP = Math.max(1, Math.round(slippage * 1000));

		const referrer =
			readFirstEnv('GAINS_REFERRER_ADDRESS', 'GAINS_REFERRER') ||
			ethersConstants.AddressZero;

		if (
			this.signer.address.toLowerCase() === this.traderAddress.toLowerCase()
		) {
			await this.ensureAllowance(
				erc20,
				gnsMultiCollatDiamond.address,
				collateralWei
			);
		} else {
			console.log(
				'Gains: delegate mode enabled (signer != trader); skipping local allowance check. Ensure trader wallet approved collateral + delegated signer in gTrade.'
			);
		}
		const canOpenTrade = await this.preflightOpenTrade({
			gnsMultiCollatDiamond,
			trade,
			maxSlippageP,
			referrer,
			collateralUsd,
			leverage,
			orderSizeUsd,
			decimals: Number(decimals)
		});
		if (!canOpenTrade) return undefined;

		let tx;
		try {
			tx = await gnsMultiCollatDiamond.openTrade(trade, maxSlippageP, referrer);
		} catch (e) {
			this.logDecodedRevert('openTrade', gnsMultiCollatDiamond, e);
			throw e;
		}
		const receipt = await tx.wait();
		const orderId = receipt.transactionHash;

		this.scheduleOpenTradeFillWatch({
			expectedTradeIndex: tradeIndex,
			pairIndex,
			long,
			txHash: orderId
		});

		return {
			size: orderSizeUsd,
			side: long ? 'BUY' : 'SELL',
			orderId
		};
	}

	private extractRevertData(error: unknown): string | undefined {
		const e = error as {
			data?: unknown;
			error?: { data?: unknown; error?: { data?: unknown }; body?: string };
		};

		const fromDirectFields = firstHexData([
			e?.error?.error?.data,
			e?.error?.data,
			e?.data
		]);
		if (fromDirectFields) return fromDirectFields;

		if (typeof e?.error?.body === 'string') {
			try {
				const parsed = JSON.parse(e.error.body) as {
					error?: { data?: unknown };
				};
				return firstHexData([parsed?.error?.data]);
			} catch {
				// Ignore parse issues and return undefined.
			}
		}
		return undefined;
	}

	private decodeContractError(
		contract: ethers.Contract,
		revertData: string
	): string | undefined {
		try {
			const decoded = contract.interface.parseError(revertData);
			if (!decoded) return undefined;
			const args = decoded.args ? Array.from(decoded.args) : [];
			if (!args.length) return `${decoded.name}()`;
			const argList = args
				.map((a) => (BigNumber.isBigNumber(a) ? a.toString() : String(a)))
				.join(', ');
			return `${decoded.name}(${argList})`;
		} catch {
			return undefined;
		}
	}

	private logDecodedRevert(
		methodName: string,
		contract: ethers.Contract,
		error: unknown
	): void {
		const revertData = this.extractRevertData(error);
		if (!revertData) return;
		const decoded = this.decodeContractError(contract, revertData);
		if (decoded) {
			console.error(`Gains ${methodName} reverted with custom error: ${decoded}`);
			return;
		}
		console.error(
			`Gains ${methodName} reverted with raw data: ${revertData.slice(0, 10)}`
		);
	}

	private async preflightOpenTrade(params: {
		gnsMultiCollatDiamond: ethers.Contract;
		trade: {
			user: string;
			index: number;
			pairIndex: number;
			leverage: number;
			long: boolean;
			isOpen: boolean;
			collateralIndex: number;
			tradeType: TradeType;
			collateralAmount: BigNumber;
			openPrice: BigNumber;
			tp: BigNumber;
			sl: BigNumber;
			isCounterTrade: boolean;
			positionSizeToken: BigNumber;
			__placeholder: number;
		};
		maxSlippageP: number;
		referrer: string;
		collateralUsd: number;
		leverage: number;
		orderSizeUsd: number;
		decimals: number;
	}): Promise<boolean> {
		try {
			await params.gnsMultiCollatDiamond.estimateGas.openTrade(
				params.trade,
				params.maxSlippageP,
				params.referrer
			);
			return true;
		} catch (e) {
			const revertData = this.extractRevertData(e);
			if (revertData === INSUFFICIENT_COLLATERAL_SELECTOR) {
				const suggestedCollateralUsd =
					await this.suggestCollateralUsdForOpenTrade(params);
				const suggestion = suggestedCollateralUsd
					? ` Suggested minimum for current market/account: ~${suggestedCollateralUsd.toFixed(
							2
					  )} collateral units.`
					: '';
				console.error(
					`Gains: InsufficientCollateral() preflight. notionalUsd=${params.orderSizeUsd.toFixed(
						4
					)} leverage=${params.leverage} collateralUsd=${params.collateralUsd.toFixed(
						4
					)}.${suggestion}`
				);
				return false;
			}
			this.logDecodedRevert('openTrade preflight', params.gnsMultiCollatDiamond, e);
			return false;
		}
	}

	private async suggestCollateralUsdForOpenTrade(params: {
		gnsMultiCollatDiamond: ethers.Contract;
		trade: {
			user: string;
			index: number;
			pairIndex: number;
			leverage: number;
			long: boolean;
			isOpen: boolean;
			collateralIndex: number;
			tradeType: TradeType;
			collateralAmount: BigNumber;
			openPrice: BigNumber;
			tp: BigNumber;
			sl: BigNumber;
			isCounterTrade: boolean;
			positionSizeToken: BigNumber;
			__placeholder: number;
		};
		maxSlippageP: number;
		referrer: string;
		collateralUsd: number;
		decimals: number;
	}): Promise<number | undefined> {
		const multipliers = [1.25, 1.5, 2, 3, 5, 8];
		for (const m of multipliers) {
			const candidate = params.collateralUsd * m;
			const candidateWei = ethers.utils.parseUnits(
				candidate.toFixed(params.decimals),
				params.decimals
			);
			try {
				await params.gnsMultiCollatDiamond.estimateGas.openTrade(
					{ ...params.trade, collateralAmount: candidateWei },
					params.maxSlippageP,
					params.referrer
				);
				return candidate;
			} catch (e) {
				const revertData = this.extractRevertData(e);
				if (revertData !== INSUFFICIENT_COLLATERAL_SELECTOR) return undefined;
			}
		}
		return undefined;
	}

	/**
	 * After the open tx is mined, gTrade may still be fulfilling the market order off-chain/oracle.
	 * Polls the public backend `open-trades` in the background (does not delay `placeOrder` return
	 * beyond the existing `tx.wait()`), and logs when the position appears or when the watch times out.
	 */
	private scheduleOpenTradeFillWatch(params: {
		expectedTradeIndex: number;
		pairIndex: number;
		long: boolean;
		txHash: string;
	}): void {
		if (getFillWatchMaxMs() <= 0) return;
		void this.watchOpenTradeFill(params).catch((e) =>
			console.error('Gains open-trade fill watch failed', e)
		);
	}

	private async watchOpenTradeFill(params: {
		expectedTradeIndex: number;
		pairIndex: number;
		long: boolean;
		txHash: string;
	}): Promise<void> {
		const pollMs = getFillPollMs();
		const maxMs = getFillWatchMaxMs();
		const started = Date.now();
		console.log(
			`Gains: open tx mined (${params.txHash}); polling for trade index ${params.expectedTradeIndex} on pair ${params.pairIndex} (async fill, max ${maxMs}ms)`
		);

		while (Date.now() - started < maxMs) {
			await _sleep(pollMs);
			try {
				const { data } = await axios.get<
					Array<{
						trade: {
							index: number | string;
							pairIndex: number | string;
							long: boolean;
						};
					}>
				>(`${this.backendUrl}/open-trades/${this.traderAddress}`, {
					timeout: 15_000
				});
				const found = data.some(
					(c) =>
						Number(c.trade.index) === params.expectedTradeIndex &&
						Number(c.trade.pairIndex) === params.pairIndex &&
						c.trade.long === params.long
				);
				if (found) {
					console.log(
						`Gains: position visible in open-trades (index ${params.expectedTradeIndex}, pair ${params.pairIndex}) after ~${Date.now() - started}ms`
					);
					return;
				}
			} catch (e) {
				console.warn('Gains: open-trades poll error (will retry)', e);
			}
		}

		console.warn(
			`Gains: open-trades watch timed out after ${maxMs}ms (tx ${params.txHash}). Trade may still complete — check explorer / gTrade UI.`
		);
	}

	private async ensureAllowance(
		erc20: ethers.Contract,
		spender: string,
		amount: BigNumber
	): Promise<void> {
		const owner = this.signer!.address;
		const cur: BigNumber = await erc20.allowance(owner, spender);
		if (cur.gte(amount)) return;
		const tx = await erc20.approve(spender, ethersConstants.MaxUint256);
		await tx.wait();
	}

	private resolveTargetLong(alertMessage: AlertObject): boolean | undefined {
		if (alertMessage.position === 'long') return true;
		if (alertMessage.position === 'short') return false;
		if (alertMessage.order === 'buy') return true;
		if (alertMessage.order === 'sell') return false;
		return undefined;
	}

	private async resolvePairIndex(alertMessage: AlertObject): Promise<{
		pairIndex: number;
		pairKey: string;
	}> {
		const pairKey = normalizeGainsPairKey(alertMessage.market);
		const raw = await this.fetchTradingVariablesRaw();
		const { pairIndexes } = transformGlobalTradingVariables(
			raw as unknown as Parameters<typeof transformGlobalTradingVariables>[0]
		);
		const pairIndex = (pairIndexes as Record<string, number>)[pairKey];
		if (pairIndex === undefined) {
			throw new Error(`Gains: unknown pair "${pairKey}"`);
		}
		return { pairIndex, pairKey };
	}

	private async fetchOpenTrades(): Promise<
		Array<{ trade: { index: number; pairIndex: number; long: boolean } }>
	> {
		const { data } = await axios.get<
			Array<{ trade: { index: number; pairIndex: number; long: boolean } }>
		>(`${this.backendUrl}/open-trades/${this.traderAddress}`, {
			timeout: 30_000
		});
		return data;
	}

	private async closeAllOpenTradesForPair(
		alertMessage: AlertObject,
		_collateralType: CollateralTypes
	): Promise<{ closedCount: number; lastOrderId?: string }> {
		const { pairIndex, pairKey } = await this.resolvePairIndex(alertMessage);
		const retries = Number(process.env.GAINS_CLOSE_RECONCILE_RETRIES || '4');
		const intervalMs = Number(process.env.GAINS_CLOSE_RECONCILE_INTERVAL_MS || '1500');
		const stateAdapter = getStrategyStateAdapter();
		const localPosition = stateAdapter.getPosition(alertMessage.strategy);
		let pairTrades: Array<{ trade: { index: number; pairIndex: number; long: boolean } }> = [];

		for (let attempt = 0; attempt <= retries; attempt++) {
			const openTrades = await this.fetchOpenTrades();
			pairTrades = openTrades.filter(
				(c) => Number(c.trade.pairIndex) === pairIndex
			);
			if (pairTrades.length > 0) break;
			if (attempt < retries) await _sleep(intervalMs);
		}

		if (pairTrades.length === 0) {
			if (localPosition !== 0) {
				throw new Error(
					`Close reconciliation pending for ${pairKey}; no open trades visible yet`
				);
			}
			return { closedCount: 0 };
		}

		const { gnsMultiCollatDiamond } = getContractsForChain(
			this.chainId,
			this.signer!,
			_collateralType
		);

		const slippageRaw = readFirstEnv(
			'GAINS_PRICE_SLIPPAGE_PCT',
			'GAINS_SLIPPAGE'
		);
		const slippage = (slippageRaw
			? parseFloat(slippageRaw)
			: (config.get('Gains.User.slippage') as number)) as number;
		let lastOrderId: string | undefined;
		for (const item of pairTrades) {
			const closingLong = item.trade.long;
			const p = alertMessage.price;
			const expectedHuman = closingLong
				? p * (1 - slippage)
				: p * (1 + slippage);
			const expectedPrice = encodeOraclePrice(expectedHuman);

			let tx;
			try {
				tx = await gnsMultiCollatDiamond.closeTradeMarket(
					item.trade.index,
					expectedPrice
				);
				console.log(
					`Gains closeTradeMarket submitted: tx=${tx.hash} tradeIndex=${item.trade.index} pairIndex=${pairIndex} long=${closingLong}`
				);
			} catch (e) {
				this.logDecodedRevert('closeTradeMarket', gnsMultiCollatDiamond, e);
				throw e;
			}
			const receipt = await tx.wait();
			lastOrderId = receipt.transactionHash;
			console.log(
				`Gains closeTradeMarket mined: tx=${receipt.transactionHash} tradeIndex=${item.trade.index} pairIndex=${pairIndex} long=${closingLong}`
			);
		}

		return {
			closedCount: pairTrades.length,
			lastOrderId
		};
	}
}
