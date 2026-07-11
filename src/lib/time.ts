// System-local timezone math. All timezone code in this file per
// .memory/conventions.md §4. Exempt from the "every function logs"
// rule (pure utility) per .memory/conventions.md §6.
//
// Timestamps are stored as UTC ISO 8601 strings; day/week/month
// boundaries are computed in the system-local timezone (or a caller-
// supplied IANA zone for tests).

type IsoTs = string;
type LocalDate = string; // 'YYYY-MM-DD'
type LocalMonth = string; // 'YYYY-MM'

export interface Bounds {
	startUtcIso: IsoTs;
	endUtcIso: IsoTs;
}

const systemTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function nowUtcIso(): IsoTs {
	return new Date().toISOString();
}

export function localDateOf(utcIso: IsoTs, tz: string = systemTz()): LocalDate {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date(utcIso));
	const map = partsMap(parts);
	return `${map.year}-${map.month}-${map.day}`;
}

export function localDayBounds(localDate: LocalDate, tz: string = systemTz()): Bounds {
	const [y, m, d] = localDate.split('-').map(Number);
	return {
		startUtcIso: new Date(localWallToUtcMs(y, m, d, 0, 0, tz)).toISOString(),
		endUtcIso: new Date(localWallToUtcMs(y, m, d + 1, 0, 0, tz)).toISOString()
	};
}

// Monday-start week (ISO 8601). Bounds cover the local Monday 00:00
// through the following Monday 00:00.
export function localWeekBounds(localDate: LocalDate, tz: string = systemTz()): Bounds {
	const [y, m, d] = localDate.split('-').map(Number);
	const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
	const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
	const mondayOffset = isoDay - 1;
	return {
		startUtcIso: new Date(localWallToUtcMs(y, m, d - mondayOffset, 0, 0, tz)).toISOString(),
		endUtcIso: new Date(localWallToUtcMs(y, m, d - mondayOffset + 7, 0, 0, tz)).toISOString()
	};
}

export function localMonthBounds(yyyyMm: LocalMonth, tz: string = systemTz()): Bounds {
	const [y, m] = yyyyMm.split('-').map(Number);
	return {
		startUtcIso: new Date(localWallToUtcMs(y, m, 1, 0, 0, tz)).toISOString(),
		endUtcIso: new Date(localWallToUtcMs(y, m + 1, 1, 0, 0, tz)).toISOString()
	};
}

// --- internal helpers ---

// Return the UTC instant (ms) that corresponds to the given local wall-clock
// time in the target IANA timezone. Uses two passes to converge across DST.
function localWallToUtcMs(
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	tz: string
): number {
	const naive = Date.UTC(y, mo - 1, d, h, mi);
	const offset1 = tzOffsetMs(naive, tz);
	const guess = naive - offset1;
	const offset2 = tzOffsetMs(guess, tz);
	return naive - offset2;
}

// Offset of `tz` from UTC at the given UTC instant, in milliseconds.
// Positive offsets are ahead of UTC (e.g. Asia/Tokyo returns +9h).
function tzOffsetMs(utcMs: number, tz: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(new Date(utcMs));
	const map = partsMap(parts);
	const asUtc = Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
		Number(map.hour) % 24, // Intl can emit '24' for midnight in some ICUs
		Number(map.minute),
		Number(map.second)
	);
	return asUtc - utcMs;
}

function partsMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value;
	return out;
}
