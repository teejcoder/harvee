import { describe, expect, test } from 'vitest';
import { formatMoney, fromMinorUnits, toMinorUnits } from '../../../src/lib/money';

describe('toMinorUnits / fromMinorUnits — decimal-aware', () => {
	test('USD (2dp) multiplies/divides by 100', () => {
		expect(toMinorUnits(12.5, 2)).toBe(1250);
		expect(fromMinorUnits(1250, 2)).toBe(12.5);
	});

	test('JPY (0dp) is 1:1 — no phantom ×100 inflation', () => {
		expect(toMinorUnits(1000, 0)).toBe(1000);
		expect(fromMinorUnits(1000, 0)).toBe(1000);
	});

	test('3-decimal currency (e.g. BHD) scales by 1000', () => {
		expect(toMinorUnits(1.234, 3)).toBe(1234);
		expect(fromMinorUnits(1234, 3)).toBe(1.234);
	});

	test('rounds to the nearest minor unit', () => {
		expect(toMinorUnits(0.005, 2)).toBe(1); // 0.5 cents → rounds to 1
	});
});

describe('formatMoney', () => {
	test('formats USD minor units', () => {
		expect(formatMoney(1250, 'USD', 2, 'en-US')).toBe('$12.50');
	});

	test('formats JPY without decimals (1000 units = ¥1,000, not ¥10.00)', () => {
		const out = formatMoney(1000, 'JPY', 0, 'en-US');
		expect(out).toContain('1,000');
		expect(out).not.toContain('.');
	});

	test('falls back to a plain number + code on a bad currency (no throw)', () => {
		expect(formatMoney(1234, 'ZZ', 2, 'en-US')).toBe('12.34 ZZ');
	});
});
