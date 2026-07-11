import { describe, expect, test } from 'vitest';
import { ulid } from '../../../src/lib/ids';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ulid()', () => {
	test('returns a 26-char Crockford base32 string', () => {
		const id = ulid();
		expect(id).toMatch(ULID_REGEX);
	});

	test('10k IDs generated in a tight loop are ascending and unique', () => {
		const count = 10_000;
		const ids: string[] = new Array(count);
		for (let i = 0; i < count; i++) ids[i] = ulid();

		for (const id of ids) expect(id).toMatch(ULID_REGEX);

		const sorted = [...ids].sort();
		expect(ids).toEqual(sorted);

		const unique = new Set(ids);
		expect(unique.size).toBe(count);
	});
});
