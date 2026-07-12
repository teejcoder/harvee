import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getClient } from '$lib/db/queries/clients';
import { log } from '$lib/log';
import { archiveClient, unarchiveClient } from '$lib/state/client';
import { archiveProject, createProject, unarchiveProject } from '$lib/state/project';
import { generateDraftInvoice } from '$lib/state/invoice';
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

		return handleTransition(
			() => {
				const project = createProject(
					getDb(),
					{ clientId: params.id, name, hourlyRate },
					correlationId
				);
				return { success: true, projectId: project.id };
			},
			correlationId,
			'routes.projects.create.failed'
		);
	},

	archiveClient: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		return handleTransition(
			() => {
				archiveClient(getDb(), params.id, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.clients.archive.failed'
		);
	},

	unarchiveClient: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		return handleTransition(
			() => {
				unarchiveClient(getDb(), params.id, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.clients.unarchive.failed'
		);
	},

	archiveProject: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const projectId = String(form.get('projectId') ?? '');
		if (!projectId) return fail(400, { error: 'projectId required' });
		return handleTransition(
			() => {
				archiveProject(getDb(), projectId, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.projects.archive.failed'
		);
	},

	unarchiveProject: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const projectId = String(form.get('projectId') ?? '');
		if (!projectId) return fail(400, { error: 'projectId required' });
		return handleTransition(
			() => {
				unarchiveProject(getDb(), projectId, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.projects.unarchive.failed'
		);
	},

	generateInvoice: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const startDate = String(form.get('startDate') ?? '');
		const endDate = String(form.get('endDate') ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
			return fail(400, { error: 'Both dates must be YYYY-MM-DD' });

		try {
			const invoice = generateDraftInvoice(
				getDb(),
				{ clientId: params.id, startDate, endDate },
				correlationId
			);
			throw redirect(303, `/invoices/${invoice.id}`);
		} catch (err) {
			// SvelteKit uses `throw redirect(...)` — rethrow if that's what we caught.
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			if (err instanceof StateTransitionError) {
				return fail(400, {
					error: err.message,
					rejectionReason: err.rejectionReason
				});
			}
			log.error({
				event: 'routes.invoices.generate.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
	}
};
