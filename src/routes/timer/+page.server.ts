import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { log } from '$lib/log';
import { pickTask, startTimer, stopTimer } from '$lib/state/entry';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

/** /timer is just a set of action endpoints — no page content of its own. */
export const load: PageServerLoad = ({ request }) => {
	// If someone navigates directly to /timer, bounce them home.
	if (request.method === 'GET') throw redirect(303, '/');
	return {};
};

function toActionResult(err: unknown): ReturnType<typeof fail> {
	if (err instanceof StateTransitionError) {
		return fail(400, { error: err.message, rejectionReason: err.rejectionReason });
	}
	return fail(500, { error: (err as Error).message });
}

export const actions: Actions = {
	start: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });

		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		if (!taskId) return fail(400, { error: 'taskId required' });

		try {
			const entry = pickTask(getDb(), { taskId }, correlationId);
			startTimer(getDb(), entry.id, correlationId);
			return { success: true, entryId: entry.id };
		} catch (err) {
			log.error({
				event: 'routes.timer.start.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return toActionResult(err);
		}
	},

	stop: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });

		const form = await request.formData();
		const entryId = String(form.get('entryId') ?? '');
		if (!entryId) return fail(400, { error: 'entryId required' });

		try {
			stopTimer(getDb(), entryId, correlationId);
			return { success: true };
		} catch (err) {
			log.error({
				event: 'routes.timer.stop.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return toActionResult(err);
		}
	}
};
