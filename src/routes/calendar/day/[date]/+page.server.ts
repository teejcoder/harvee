import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { segmentsInRange, totalsByProject } from '$lib/calendar';
import { log } from '$lib/log';
import { localDayBounds, utcIsoFromLocalDateTime } from '$lib/time';
import { addManualEntry } from '$lib/state/entry';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
	addTime: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const startLocal = String(form.get('startedAt') ?? '');
		const endLocal = String(form.get('stoppedAt') ?? '');
		if (!taskId || !startLocal || !endLocal) {
			log.warn({
				event: 'routes.calendar.addTime.validation.rejected',
				correlationId,
				entityType: 'timeEntry',
				reason: 'missing_fields'
			});
			return fail(400, { error: 'Task, start, and end are all required' });
		}
		const startedAt = utcIsoFromLocalDateTime(startLocal);
		const stoppedAt = utcIsoFromLocalDateTime(endLocal);
		try {
			addManualEntry(getDb(), { taskId, startedAt, stoppedAt }, correlationId);
			return { success: true };
		} catch (err) {
			if (err instanceof StateTransitionError) {
				return fail(400, { error: err.message, rejectionReason: err.rejectionReason });
			}
			log.error({
				event: 'routes.calendar.addTime.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
	}
};
