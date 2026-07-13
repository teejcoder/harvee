import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	localDateOf,
	localDateTimeInputOf,
	localDayBounds,
	localMonthBounds,
	localWeekBounds,
	nowUtcIso,
	utcIsoFromLocalDateTime
} from '../../../src/lib/time';

const HOUR_MS = 3_600_000;

// US DST 2026 anchors:
//   Spring forward: 2026-03-08 (23-hour day)
//   Fall back:      2026-11-01 (25-hour day)
const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo'; // No DST, +09:00 year-round

describe('nowUtcIso()', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	test('returns UTC ISO of current mocked instant with ms precision', () => {
		vi.setSystemTime(new Date('2026-07-11T14:32:07.412Z'));
		expect(nowUtcIso()).toBe('2026-07-11T14:32:07.412Z');
	});
});

describe('localDateOf()', () => {
	test('returns YYYY-MM-DD in the given IANA zone', () => {
		expect(localDateOf('2026-03-08T08:00:00.000Z', LA)).toBe('2026-03-08');
		expect(localDateOf('2026-03-08T07:59:59.999Z', LA)).toBe('2026-03-07');
		expect(localDateOf('2026-03-08T00:00:00.000Z', TOKYO)).toBe('2026-03-08');
	});
});

describe('localDayBounds() — DST forward in LA (2026-03-08)', () => {
	test('the spring-forward day is exactly 23 hours long', () => {
		const { startUtcIso, endUtcIso } = localDayBounds('2026-03-08', LA);
		expect(startUtcIso).toBe('2026-03-08T08:00:00.000Z'); // 00:00 PST
		expect(endUtcIso).toBe('2026-03-09T07:00:00.000Z'); // 00:00 PDT
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(23 * HOUR_MS);
	});
});

describe('localDayBounds() — DST back in LA (2026-11-01)', () => {
	test('the fall-back day is exactly 25 hours long', () => {
		const { startUtcIso, endUtcIso } = localDayBounds('2026-11-01', LA);
		expect(startUtcIso).toBe('2026-11-01T07:00:00.000Z'); // 00:00 PDT
		expect(endUtcIso).toBe('2026-11-02T08:00:00.000Z'); // 00:00 PST
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(25 * HOUR_MS);
	});
});

describe('localDayBounds() — non-DST in Tokyo (2026-03-08)', () => {
	test('a day is exactly 24 hours long', () => {
		const { startUtcIso, endUtcIso } = localDayBounds('2026-03-08', TOKYO);
		expect(startUtcIso).toBe('2026-03-07T15:00:00.000Z');
		expect(endUtcIso).toBe('2026-03-08T15:00:00.000Z');
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(24 * HOUR_MS);
	});
});

describe('localWeekBounds() — Monday-anchored across DST forward (2026-03-10, LA)', () => {
	test('the week spanning DST forward is 167 hours (7*24 - 1)', () => {
		const { startUtcIso, endUtcIso } = localWeekBounds('2026-03-10', LA);
		// Monday 2026-03-09 00:00 PDT = 07:00 UTC
		expect(startUtcIso).toBe('2026-03-09T07:00:00.000Z');
		// Following Monday 2026-03-16 00:00 PDT = 07:00 UTC
		expect(endUtcIso).toBe('2026-03-16T07:00:00.000Z');
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(7 * 24 * HOUR_MS);
	});

	test('a Sunday is anchored to the preceding Monday', () => {
		// 2026-03-08 is a Sunday (DST-forward day). Monday of its week = 2026-03-02.
		const { startUtcIso, endUtcIso } = localWeekBounds('2026-03-08', LA);
		expect(startUtcIso).toBe('2026-03-02T08:00:00.000Z'); // 00:00 PST
		expect(endUtcIso).toBe('2026-03-09T07:00:00.000Z'); // 00:00 PDT after DST forward
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(
			7 * 24 * HOUR_MS - HOUR_MS
		);
	});
});

describe('localMonthBounds() — DST forward month (2026-03 in LA)', () => {
	test('March 2026 in LA covers the DST-forward transition', () => {
		const { startUtcIso, endUtcIso } = localMonthBounds('2026-03', LA);
		expect(startUtcIso).toBe('2026-03-01T08:00:00.000Z'); // 00:00 PST
		expect(endUtcIso).toBe('2026-04-01T07:00:00.000Z'); // 00:00 PDT
		// 31 days - 1 hour lost to DST forward
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(
			31 * 24 * HOUR_MS - HOUR_MS
		);
	});
});

describe('localMonthBounds() — non-DST month (2026-03 in Tokyo)', () => {
	test('March 2026 in Tokyo is exactly 31 * 24 hours', () => {
		const { startUtcIso, endUtcIso } = localMonthBounds('2026-03', TOKYO);
		expect(startUtcIso).toBe('2026-02-28T15:00:00.000Z');
		expect(endUtcIso).toBe('2026-03-31T15:00:00.000Z');
		expect(new Date(endUtcIso).getTime() - new Date(startUtcIso).getTime()).toBe(31 * 24 * HOUR_MS);
	});
});

describe('rollover edge cases', () => {
	test('localDayBounds() rolls year-end (2026-12-31 in Tokyo → 2027-01-01)', () => {
		const { startUtcIso, endUtcIso } = localDayBounds('2026-12-31', TOKYO);
		expect(startUtcIso).toBe('2026-12-30T15:00:00.000Z');
		expect(endUtcIso).toBe('2026-12-31T15:00:00.000Z');
	});

	test('localMonthBounds() rolls year-end (2026-12 in Tokyo → 2027-01)', () => {
		const { startUtcIso, endUtcIso } = localMonthBounds('2026-12', TOKYO);
		expect(startUtcIso).toBe('2026-11-30T15:00:00.000Z');
		expect(endUtcIso).toBe('2026-12-31T15:00:00.000Z');
	});

	test('localWeekBounds() pulls back across a month boundary (2026-03-01 Sun in Tokyo)', () => {
		// 2026-03-01 is a Sunday. Its Monday is 2026-02-23.
		const { startUtcIso, endUtcIso } = localWeekBounds('2026-03-01', TOKYO);
		expect(startUtcIso).toBe('2026-02-22T15:00:00.000Z');
		expect(endUtcIso).toBe('2026-03-01T15:00:00.000Z');
	});
});

describe('localDateTimeInputOf()', () => {
	test('formats a UTC instant as a local datetime-local string', () => {
		expect(localDateTimeInputOf('2026-07-10T04:00:00.000Z', TOKYO)).toBe('2026-07-10T13:00:00');
		// LA in July is PDT (-7): 20:00Z → 13:00 local.
		expect(localDateTimeInputOf('2026-07-10T20:00:00.000Z', LA)).toBe('2026-07-10T13:00:00');
	});

	test('normalizes midnight to 00 (not 24) and rolls the date', () => {
		// Tokyo +9: 15:00Z → 00:00 next local day.
		expect(localDateTimeInputOf('2026-07-10T15:00:00.000Z', TOKYO)).toBe('2026-07-11T00:00:00');
	});
});

describe('utcIsoFromLocalDateTime()', () => {
	test('parses a local wall-clock string into a UTC ISO instant', () => {
		expect(utcIsoFromLocalDateTime('2026-07-10T13:00:00', TOKYO)).toBe('2026-07-10T04:00:00.000Z');
		expect(utcIsoFromLocalDateTime('2026-07-10T13:00:00', LA)).toBe('2026-07-10T20:00:00.000Z');
	});

	test('tolerates a missing seconds component', () => {
		expect(utcIsoFromLocalDateTime('2026-07-10T13:00', TOKYO)).toBe('2026-07-10T04:00:00.000Z');
	});

	test('round-trips with localDateTimeInputOf on whole-second instants', () => {
		for (const iso of ['2026-07-10T04:00:00.000Z', '2026-01-02T23:17:05.000Z']) {
			for (const tz of [LA, TOKYO]) {
				expect(utcIsoFromLocalDateTime(localDateTimeInputOf(iso, tz), tz)).toBe(iso);
			}
		}
	});
});
