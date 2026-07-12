import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getEntry } from '$lib/db/queries/entries';
import { log } from '$lib/log';
import {
	cancelEdit,
	discardEntry,
	openEdit,
	resumeEntry,
	saveEdit,
	updateNotes,
	updateSegment
} from '$lib/state/entry';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

interface SegmentRow {
	id: string;
	startedAt: string;
	stoppedAt: string | null;
}

export const load: PageServerLoad = ({ params }) => {
	const db = getDb();
	log.debug({ event: 'routes.entries.detail.load', entityId: params.id });

	const entry = getEntry(db, params.id);
	if (!entry) throw error(404, `Entry ${params.id} not found`);

	const context = db
		.prepare(
			`SELECT t.name AS taskName, p.name AS projectName, c.name AS clientName
			 FROM tasks t
			 JOIN projects p ON t.project_id = p.id
			 JOIN clients c ON p.client_id = c.id
			 WHERE t.id = ?`
		)
		.get(entry.taskId) as { taskName: string; projectName: string; clientName: string };

	const segments = db
		.prepare(
			`SELECT id, started_at AS startedAt, stopped_at AS stoppedAt
			 FROM time_entry_segments WHERE entry_id = ?
			 ORDER BY started_at`
		)
		.all(params.id) as SegmentRow[];

	return { entry, context, segments };
};

function toActionResult(err: unknown): ReturnType<typeof fail> {
	if (err instanceof StateTransitionError) {
		return fail(400, { error: err.message, rejectionReason: err.rejectionReason });
	}
	return fail(500, { error: (err as Error).message });
}

export const actions: Actions = {
	updateNotes: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const notes = String(form.get('notes') ?? '');
		try {
			updateNotes(getDb(), { entryId: params.id, notes }, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	openEdit: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			openEdit(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	saveEdit: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			saveEdit(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	cancelEdit: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			cancelEdit(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	updateSegment: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const segmentId = String(form.get('segmentId') ?? '');
		const startedAt = String(form.get('startedAt') ?? '');
		const stoppedAtRaw = String(form.get('stoppedAt') ?? '');
		const stoppedAt = stoppedAtRaw.length > 0 ? stoppedAtRaw : null;
		if (!segmentId || !startedAt) return fail(400, { error: 'segmentId and startedAt required' });
		try {
			updateSegment(getDb(), { segmentId, startedAt, stoppedAt }, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	resume: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			resumeEntry(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	discard: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			discardEntry(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	}
};
