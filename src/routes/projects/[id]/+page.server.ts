import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getProject } from '$lib/db/queries/projects';
import { getSettings } from '$lib/db/queries/settings';
import { log } from '$lib/log';
import { archiveProject, deleteProject, unarchiveProject, updateProject } from '$lib/state/project';
import { archiveTask, createTask, deleteTask, unarchiveTask, updateTask } from '$lib/state/task';
import { toMinorUnits } from '$lib/money';
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

	const settings = getSettings(db);

	return {
		project,
		tasks,
		currency: {
			code: settings.currencyCode,
			decimals: settings.currencyDecimals,
			locale: settings.invoiceLocale
		}
	};
};

export const actions: Actions = {
	editProject: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const rateInput = Number(form.get('hourlyRate'));
		let reason: string | null = null;
		if (name.length === 0) reason = 'empty_name';
		else if (!Number.isFinite(rateInput) || rateInput < 0) reason = 'invalid_hourly_rate';
		if (reason) {
			log.warn({
				event: 'routes.projects.edit.validation.rejected',
				correlationId,
				entityType: 'project',
				entityId: params.id,
				reason
			});
			return fail(400, {
				error: reason === 'empty_name' ? 'Name is required' : 'Rate must be a non-negative number'
			});
		}
		const hourlyRate = toMinorUnits(rateInput, getSettings(getDb()).currencyDecimals);
		return handleTransition(
			() => {
				updateProject(getDb(), { id: params.id, name, hourlyRate }, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.projects.edit.failed'
		);
	},

	deleteProject: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const project = getProject(getDb(), params.id);
		if (!project) throw error(404, `Project ${params.id} not found`);
		const childCount = (
			getDb().prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?`).get(params.id) as {
				n: number;
			}
		).n;
		if (childCount > 0) {
			log.warn({
				event: 'routes.projects.delete.rejected',
				correlationId,
				entityType: 'project',
				entityId: params.id,
				reason: 'has_tasks'
			});
			return fail(400, { error: `Delete or archive this project's ${childCount} task(s) first.` });
		}
		try {
			deleteProject(getDb(), params.id, correlationId);
		} catch (err) {
			if (err instanceof StateTransitionError) {
				return fail(400, { error: err.message, rejectionReason: err.rejectionReason });
			}
			log.error({
				event: 'routes.projects.delete.failed',
				correlationId,
				entityType: 'project',
				entityId: params.id,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
		throw redirect(303, `/clients/${project.clientId}`);
	},

	deleteTask: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const taskId = String((await request.formData()).get('taskId') ?? '');
		if (!taskId) return fail(400, { error: 'taskId required' });
		return handleTransition(
			() => {
				deleteTask(getDb(), taskId, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.tasks.delete.failed'
		);
	},

	create: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (name.length === 0) {
			log.warn({
				event: 'routes.tasks.create.validation.rejected',
				correlationId,
				entityType: 'task',
				reason: 'empty_name'
			});
			return fail(400, { error: 'Name is required' });
		}
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
		let updReason: string | null = null;
		if (!taskId) updReason = 'missing_task_id';
		else if (name.length === 0) updReason = 'empty_name';
		if (updReason) {
			log.warn({
				event: 'routes.tasks.update.validation.rejected',
				correlationId,
				entityType: 'task',
				entityId: taskId || undefined,
				reason: updReason
			});
			return fail(400, {
				error: updReason === 'missing_task_id' ? 'taskId required' : 'Name is required'
			});
		}
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
