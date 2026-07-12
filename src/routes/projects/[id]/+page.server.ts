import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getProject } from '$lib/db/queries/projects';
import { log } from '$lib/log';
import { archiveProject, unarchiveProject } from '$lib/state/project';
import { archiveTask, createTask, unarchiveTask, updateTask } from '$lib/state/task';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

function handleTransition<T>(
	fn: () => T,
	correlationId: string,
	failureEvent: string
): T | ReturnType<typeof fail> {
	try {
		return fn();
	} catch (err) {
		if (err instanceof StateTransitionError) {
			return fail(400, {
				error: err.message,
				rejectionReason: err.rejectionReason
			});
		}
		log.error({
			event: failureEvent,
			correlationId,
			error: { message: (err as Error).message, stack: (err as Error).stack }
		});
		return fail(500, { error: (err as Error).message });
	}
}

interface TaskRow {
	id: string;
	name: string;
	description: string;
	archivedAt: string | null;
}

export const load: PageServerLoad = ({ params }) => {
	const db = getDb();
	log.debug({ event: 'routes.projects.detail.load', entityId: params.id });

	const project = getProject(db, params.id);
	if (!project) throw error(404, `Project ${params.id} not found`);

	const tasks = db
		.prepare(
			`SELECT id, name, description, archived_at AS archivedAt
			 FROM tasks
			 WHERE project_id = ?
			 ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`
		)
		.all(params.id) as TaskRow[];

	return { project, tasks };
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (name.length === 0) return fail(400, { error: 'Name is required' });
		return handleTransition(
			() => {
				const task = createTask(
					getDb(),
					{ projectId: params.id, name, description },
					correlationId
				);
				return { success: true, taskId: task.id };
			},
			correlationId,
			'routes.tasks.create.failed'
		);
	},

	updateTask: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!taskId) return fail(400, { error: 'taskId required' });
		if (name.length === 0) return fail(400, { error: 'Name is required' });
		return handleTransition(
			() => {
				updateTask(getDb(), { id: taskId, name, description }, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.tasks.update.failed'
		);
	},

	archiveProject: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		return handleTransition(
			() => {
				archiveProject(getDb(), params.id, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.projects.archive.failed'
		);
	},

	unarchiveProject: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		return handleTransition(
			() => {
				unarchiveProject(getDb(), params.id, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.projects.unarchive.failed'
		);
	},

	archiveTask: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		if (!taskId) return fail(400, { error: 'taskId required' });
		return handleTransition(
			() => {
				archiveTask(getDb(), taskId, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.tasks.archive.failed'
		);
	},

	unarchiveTask: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		if (!taskId) return fail(400, { error: 'taskId required' });
		return handleTransition(
			() => {
				unarchiveTask(getDb(), taskId, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.tasks.unarchive.failed'
		);
	}
};
