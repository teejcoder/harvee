import { getDb } from '$lib/db';
import { segmentsInRange, totalsByProject } from '$lib/calendar';
import { log } from '$lib/log';
import { localDayBounds } from '$lib/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	log.debug({ event: 'routes.calendar.day.load', date: params.date });
	const { startUtcIso, endUtcIso } = localDayBounds(params.date);
	const segments = segmentsInRange(getDb(), startUtcIso, endUtcIso);
	return {
		date: params.date,
		segments,
		projectTotals: totalsByProject(segments)
	};
};
