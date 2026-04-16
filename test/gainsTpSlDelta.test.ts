import { tpSlDeltaToAbsolute } from '../src/services/gains/gainsClient';

describe('gains tp/sl delta conversion', () => {
	test('converts long tp/sl deltas into absolute price levels', () => {
		const out = tpSlDeltaToAbsolute({
			entryPrice: 100,
			targetLong: true,
			tpDelta: 20,
			slDelta: 15
		});
		expect(out.tpAbs).toBe(120);
		expect(out.slAbs).toBe(85);
	});

	test('converts short tp/sl deltas into absolute price levels', () => {
		const out = tpSlDeltaToAbsolute({
			entryPrice: 100,
			targetLong: false,
			tpDelta: 20,
			slDelta: 15
		});
		expect(out.tpAbs).toBe(80);
		expect(out.slAbs).toBe(115);
	});

	test('treats 0/empty as unset', () => {
		expect(
			tpSlDeltaToAbsolute({
				entryPrice: 100,
				targetLong: true,
				tpDelta: 0,
				slDelta: ''
			})
		).toEqual({ tpAbs: undefined, slAbs: undefined });
	});
});

