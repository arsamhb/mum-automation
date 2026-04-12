import { AbstractDexClient } from './abstractDexClient';
import { GainsClient } from './gains/gainsClient';

export class DexRegistry {
	private registeredDexs: Map<string, AbstractDexClient>;

	constructor() {
		this.registeredDexs = new Map();
		const gains = new GainsClient();
		this.registeredDexs.set('gains', gains);
		this.registeredDexs.set('gtrade', gains);
		this.registeredDexs.set('gns', gains);
	}

	getDex(dexKey: string): AbstractDexClient {
		return this.registeredDexs.get(dexKey);
	}

	getAllDexKeys(): string[] {
		return Array.from(this.registeredDexs.keys());
	}
}
