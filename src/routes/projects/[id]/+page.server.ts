import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getProject } from '$lib/db/queries/projects';
import { log } from '$lib/log';
import { createTask } from '$lib/state/task';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

interface TaskRow {
	id: string;
	name: string;
	archivedAt: string | null;
}

export const load: PageServerLoad = ({ params }) => {
	const db = getDb();
	log.debug({ event: 'routes.projects.detail.load', entityId: params.id });

	const project = getProject(db, params.id);
	if (!project) throw error(404, `Project ${params.id} not found`);

	const tasks = db
		.prepare(
			`SELECT id, name, archived_at AS archivedAt
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
		if (name.length === 0) return fail(400, { error: 'Name is required' });

		try {
			const task = createTask(getDb(), { projectId: params.id, name }, correlationId);
			return { success: true, taskId: task.id };
		} catch (err) {
			if (err instanceof StateTransitionError) {
				return fail(400, {
					error: err.message,
					rejectionReason: err.rejectionReason
				});
			}
			log.error({
				event: 'routes.tasks.create.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
	}
};
