import { getDb } from '$lib/db';
import { segmentsInRange, totalsByLocalDate } from '$lib/calendar';
import { log } from '$lib/log';
import { localWeekBounds } from '$lib/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	log.debug({ event: 'routes.calendar.week.load', date: params.date });
	const { startUtcIso, endUtcIso } = localWeekBounds(params.date);
	const segments = segmentsInRange(getDb(), startUtcIso, endUtcIso);
	const perDay = totalsByLocalDate(segments);

	// Build the 7 day slots (Mon..Sun) with 0h defaults.
	const startLocalDate = params.date; // Monday-anchored week
	const monday = mondayOf(startLocalDate);
	const days: { date: string; hours: number }[] = [];
	for (let i = 0; i < 7; i++) {
		const d = shift(monday, i);
		days.push({ date: d, hours: perDay[d] ?? 0 });
	}
	const totalHours = days.reduce((sum, d) => sum + d.hours, 0);

	return {
		date: params.date,
		monday,
		days,
		totalHours,
		// keep a reference frame for prev/next week
		bounds: { startUtcIso, endUtcIso }
	};
};

function mondayOf(localDate: string): string {
	const [y, m, d] = localDate.split('-').map(Number);
	const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	const iso = jsDay === 0 ? 7 : jsDay;
	return shift(localDate, -(iso - 1));
}

function shift(localDate: string, days: number): string {
	const [y, m, d] = localDate.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d + days));
	return dt.toISOString().slice(0, 10);
}
