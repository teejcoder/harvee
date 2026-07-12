import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getClient } from '$lib/db/queries/clients';
import { log } from '$lib/log';
import { createProject } from '$lib/state/project';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

interface ProjectRow {
	id: string;
	name: string;
	hourlyRate: number;
	archivedAt: string | null;
}

export const load: PageServerLoad = ({ params }) => {
	const db = getDb();
	log.debug({ event: 'routes.clients.detail.load', entityId: params.id });

	const client = getClient(db, params.id);
	if (!client) throw error(404, `Client ${params.id} not found`);

	const projects = db
		.prepare(
			`SELECT id, name, hourly_rate AS hourlyRate, archived_at AS archivedAt
			 FROM projects
			 WHERE client_id = ?
			 ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`
		)
		.all(params.id) as ProjectRow[];

	return { client, projects };
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const rateInput = Number(form.get('hourlyRate'));
		if (name.length === 0) return fail(400, { error: 'Name is required' });
		if (!Number.isFinite(rateInput) || rateInput < 0)
			return fail(400, { error: 'Hourly rate must be a non-negative number' });

		// Rate is entered in whole units (e.g. dollars); store as minor units.
		const hourlyRate = Math.round(rateInput * 100);

		try {
			const project = createProject(
				getDb(),
				{ clientId: params.id, name, hourlyRate },
				correlationId
			);
			return { success: true, projectId: project.id };
		} catch (err) {
			if (err instanceof StateTransitionError) {
				return fail(400, {
					error: err.message,
					rejectionReason: err.rejectionReason
				});
			}
			log.error({
				event: 'routes.projects.create.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
	}
};
