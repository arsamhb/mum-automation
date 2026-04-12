import { AbstractDexClient } from '../abstractDexClient';
import { _sleep, doubleSizeIfReverseOrder } from '../../helper';
import { AlertObject, OrderResult } from '../../types';
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

const ERC20_ABI = [
	'function approve(address spender, uint256 amount) public returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function balanceOf(address account) view returns (uint256)',
	'function decimals() view returns (uint8)',
	'function symbol() view returns (string)'
];

function resolveCollateralType(alertCollateral?: string): CollateralTypes {
	const key = (
		alertCollateral ||
		process.env.GAINS_COLLATERAL ||
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

function getConfiguredChainId(): number {
	if (process.env.GAINS_CHAIN_ID) {
		return parseInt(process.env.GAINS_CHAIN_ID, 10);
	}
	return config.get('Gains.Network.chainId') as number;
}

function getBackendUrl(): string {
	if (process.env.GAINS_BACKEND_URL) {
		return process.env.GAINS_BACKEND_URL.replace(/\/$/, '');
	}
	return (config.get('Gains.Backend.url') as string).replace(/\/$/, '');
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

/** Poll interval / max wait for async oracle fill confirmation (env overrides). */
function getFillPollMs(): number {
	const v = process.env.GAINS_FILL_POLL_MS;
	return v ? parseInt(v, 10) : 2000;
}

function getFillWatchMaxMs(): number {
	const v = process.env.GAINS_FILL_WATCH_MS;
	return v ? parseInt(v, 10) : 120_000;
}

export class GainsClient extends AbstractDexClient {
	private signer: ethers.Wallet | undefined;
	private readonly chainId: number;
	private readonly backendUrl: string;
	private readonly collateral: CollateralTypes;

	constructor() {
		super();
		this.chainId = getConfiguredChainId();
		this.backendUrl = getBackendUrl();
		this.collateral = resolveCollateralType();
		this.signer = this.buildSigner();
	}

	private buildSigner(): ethers.Wallet | undefined {
		if (!process.env.GAINS_PRIVATE_KEY) {
			console.log('GAINS_PRIVATE_KEY is not set; Gains (gTrade) client disabled');
			return undefined;
		}
		const pk = process.env.GAINS_PRIVATE_KEY.startsWith('0x')
			? process.env.GAINS_PRIVATE_KEY
			: '0x' + process.env.GAINS_PRIVATE_KEY;
		const rpc =
			process.env.GAINS_RPC_URL || (config.get('Gains.Network.rpc') as string);
		const provider = ethers.getDefaultProvider(rpc);
		return new ethers.Wallet(pk, provider);
	}

	getIsAccountReady = async (): Promise<boolean> => {
		try {
			if (!this.signer) return false;
			const eth = await this.signer.getBalance();
			if (eth.lte(0)) {
				console.log('Gains: zero ETH balance for gas');
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
				erc20.balanceOf(this.signer.address)
			]);
			console.log(
				`Gains: ${await erc20.symbol()} balance`,
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
		}>(`${this.backendUrl}/user-trading-variables/${this.signer!.address}`, {
			timeout: 30_000
		});
		const row = data.collaterals?.[idx];
		if (!row) return undefined;
		const human =
			parseFloat(row.balance) / Math.pow(10, Number(row.decimals));
		return human;
	}

	placeOrder = async (alertMessage: AlertObject) => {
		if (!this.signer) {
			console.error('GainsClient: signer not configured');
			return;
		}
		if (alertMessage.size != null) alertMessage.size = Number(alertMessage.size);
		if (alertMessage.sizeUsd != null)
			alertMessage.sizeUsd = Number(alertMessage.sizeUsd);
		if (alertMessage.sizeByLeverage != null)
			alertMessage.sizeByLeverage = Number(alertMessage.sizeByLeverage);
		if (alertMessage.price != null)
			alertMessage.price = Number(alertMessage.price);
		try {
			const collateralType = resolveCollateralType(alertMessage.collateral);
			const orderResult =
				alertMessage.position === 'flat'
					? await this.closeMarket(alertMessage, collateralType)
					: await this.openMarket(alertMessage, collateralType);
			if (orderResult) {
				await this.exportOrder(
					'Gains',
					alertMessage.strategy,
					orderResult,
					alertMessage.price,
					alertMessage.market
				);
			}
		} catch (e) {
			console.error('Gains placeOrder', e);
		}
	};

	private async openMarket(
		alertMessage: AlertObject,
		collateralType: CollateralTypes
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

		const leverage = Number(process.env.GAINS_LEVERAGE);
		if (!Number.isFinite(leverage) || leverage <= 0) {
			console.error('GAINS_LEVERAGE must be a positive number');
			return undefined;
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
			// Same convention as dYdX / Hyperliquid: notional USD ≈ equity × multiplier
			orderSizeUsd = equityUsd * Number(alertMessage.sizeByLeverage);
		} else if (alertMessage.size !== undefined) {
			orderSizeUsd = Math.floor(
				Number(alertMessage.size) * Number(alertMessage.price)
			);
		} else if (alertMessage.sizeUsd !== undefined) {
			orderSizeUsd = alertMessage.sizeUsd;
		} else {
			console.error(
				'Gains: specify size, sizeUsd, or sizeByLeverage in the alert'
			);
			return undefined;
		}
		orderSizeUsd = doubleSizeIfReverseOrder(alertMessage, orderSizeUsd);

		const collateralUsd = orderSizeUsd / leverage;
		const long = alertMessage.position === 'long';

		const { gnsMultiCollatDiamond } = getContractsForChain(
			this.chainId,
			this.signer,
			collateralType
		);

		const counter = await gnsMultiCollatDiamond.getCounters(
			this.signer.address,
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
			user: this.signer.address,
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

		const slippage = (process.env.GAINS_SLIPPAGE
			? parseFloat(process.env.GAINS_SLIPPAGE)
			: (config.get('Gains.User.slippage') as number)) as number;
		const maxSlippageP = Math.max(1, Math.round(slippage * 1000));

		const referrer =
			process.env.GAINS_REFERRER || ethersConstants.AddressZero;

		await this.ensureAllowance(erc20, gnsMultiCollatDiamond.address, collateralWei);

		const tx = await gnsMultiCollatDiamond.openTrade(trade, maxSlippageP, referrer);
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
				>(`${this.backendUrl}/open-trades/${this.signer!.address}`, {
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

	/**
	 * Closing long: alert order "sell". Closing short: alert order "buy".
	 */
	private async closeMarket(
		alertMessage: AlertObject,
		_collateralType: CollateralTypes
	): Promise<OrderResult | undefined> {
		const pairKey = normalizeGainsPairKey(alertMessage.market);
		const raw = await this.fetchTradingVariablesRaw();
		const { pairIndexes } = transformGlobalTradingVariables(
			raw as unknown as Parameters<typeof transformGlobalTradingVariables>[0]
		);
		const pairIndex = (pairIndexes as Record<string, number>)[pairKey];
		if (pairIndex === undefined) {
			console.error(`Gains close: unknown pair ${pairKey}`);
			return undefined;
		}

		const closingLong = alertMessage.order === 'sell';
		const { data: openTrades } = await axios.get<
			Array<{ trade: { index: number; pairIndex: number; long: boolean } }>
		>(`${this.backendUrl}/open-trades/${this.signer!.address}`, {
			timeout: 30_000
		});

		const match = openTrades.find(
			(c) =>
				Number(c.trade.pairIndex) === pairIndex && c.trade.long === closingLong
		);
		if (!match) {
			console.error(
				`Gains close: no open trade for ${pairKey} long=${closingLong}`
			);
			return undefined;
		}

		const { gnsMultiCollatDiamond } = getContractsForChain(
			this.chainId,
			this.signer!,
			_collateralType
		);

		const slippage = (process.env.GAINS_SLIPPAGE
			? parseFloat(process.env.GAINS_SLIPPAGE)
			: (config.get('Gains.User.slippage') as number)) as number;
		const p = alertMessage.price;
		const expectedHuman = closingLong
			? p * (1 - slippage)
			: p * (1 + slippage);
		const expectedPrice = encodeOraclePrice(expectedHuman);

		const tx = await gnsMultiCollatDiamond.closeTradeMarket(
			match.trade.index,
			expectedPrice
		);
		const receipt = await tx.wait();

		return {
			size: 0,
			side: closingLong ? 'SELL' : 'BUY',
			orderId: receipt.transactionHash
		};
	}
}
