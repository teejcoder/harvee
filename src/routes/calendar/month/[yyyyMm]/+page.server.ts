import { getDb } from '$lib/db';
import { segmentsInRange, totalsByLocalDate } from '$lib/calendar';
import { log } from '$lib/log';
import { localMonthBounds } from '$lib/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	log.debug({ event: 'routes.calendar.month.load', yyyyMm: params.yyyyMm });
	const { startUtcIso, endUtcIso } = localMonthBounds(params.yyyyMm);
	const segments = segmentsInRange(getDb(), startUtcIso, endUtcIso);
	const perDay = totalsByLocalDate(segments);

	const [y, m] = params.yyyyMm.split('-').map(Number);
	const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
	const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

	// Leading empty cells so the first cell aligns to Monday-start.
	const jsDay = firstOfMonth.getUTCDay();
	const isoDay = jsDay === 0 ? 7 : jsDay;
	const leadingBlanks = isoDay - 1;

	const cells: ({ date: string; hours: number } | null)[] = [];
	for (let i = 0; i < leadingBlanks; i++) cells.push(null);
	for (let d = 1; d <= daysInMonth; d++) {
		const date = `${params.yyyyMm}-${String(d).padStart(2, '0')}`;
		cells.push({ date, hours: perDay[date] ?? 0 });
	}

	const totalHours = Object.values(perDay).reduce((sum, h) => sum + h, 0);

	return {
		yyyyMm: params.yyyyMm,
		cells,
		totalHours
	};
};
