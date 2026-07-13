import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getClient } from '$lib/db/queries/clients';
import { listInvoices } from '$lib/db/queries/invoices';
import { getSettings } from '$lib/db/queries/settings';
import { log } from '$lib/log';
import { toMinorUnits } from '$lib/money';
import { archiveClient, deleteClient, unarchiveClient, updateClient } from '$lib/state/client';
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

	const invoices = listInvoices(db, { clientId: params.id });
	const settings = getSettings(db);

	// Unbilled time for this client — stopped entries not yet locked onto an invoice.
	// Gives the user a "here's what's billable" signal before generating.
	const unbilled = db
		.prepare(
			`SELECT
				COALESCE(SUM(
					CASE WHEN s.stopped_at IS NOT NULL
						THEN strftime('%s', s.stopped_at) - strftime('%s', s.started_at)
						ELSE 0 END
				), 0) AS sec,
				COUNT(DISTINCT e.id) AS entries
			 FROM time_entries e
			 JOIN tasks t ON e.task_id = t.id
			 JOIN projects p ON t.project_id = p.id
			 LEFT JOIN time_entry_segments s ON s.entry_id = e.id
			 WHERE p.client_id = ? AND e.state = 'entry.stopped'`
		)
		.get(params.id) as { sec: number; entries: number };

	return {
		client,
		projects,
		invoices,
		unbilled: { hours: unbilled.sec / 3600, entries: unbilled.entries },
		currency: {
			code: settings.currencyCode,
			decimals: settings.currencyDecimals,
			locale: settings.invoiceLocale
		}
	};
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const rateInput = Number(form.get('hourlyRate'));
		let projReason: string | null = null;
		if (name.length === 0) projReason = 'empty_name';
		else if (!Number.isFinite(rateInput) || rateInput < 0) projReason = 'invalid_hourly_rate';
		if (projReason) {
			log.warn({
				event: 'routes.projects.create.validation.rejected',
				correlationId,
				entityType: 'project',
				reason: projReason
			});
			return fail(400, {
				error:
					projReason === 'empty_name'
						? 'Name is required'
						: 'Hourly rate must be a non-negative number'
			});
		}

		// Rate is entered in major units; store as minor units at the configured
		// currency's precision (USD→×100, JPY→×1).
		const hourlyRate = toMinorUnits(rateInput, getSettings(getDb()).currencyDecimals);

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

	rename: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (name.length === 0) {
			log.warn({
				event: 'routes.clients.rename.validation.rejected',
				correlationId,
				entityType: 'client',
				entityId: params.id,
				reason: 'empty_name'
			});
			return fail(400, { error: 'Name is required' });
		}
		return handleTransition(
			() => {
				updateClient(getDb(), { id: params.id, name }, correlationId);
				return { success: true };
			},
			correlationId,
			'routes.clients.rename.failed'
		);
	},

	deleteClient: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		// No auto-cascade: a client with projects can't be hard-deleted (FK RESTRICT).
		// Give a clear message instead of a raw constraint error.
		const childCount = (
			getDb().prepare(`SELECT COUNT(*) AS n FROM projects WHERE client_id = ?`).get(params.id) as {
				n: number;
			}
		).n;
		if (childCount > 0) {
			log.warn({
				event: 'routes.clients.delete.rejected',
				correlationId,
				entityType: 'client',
				entityId: params.id,
				reason: 'has_projects'
			});
			return fail(400, {
				error: `Delete or archive this client's ${childCount} project(s) first.`
			});
		}
		try {
			deleteClient(getDb(), params.id, correlationId);
		} catch (err) {
			if (err instanceof StateTransitionError) {
				return fail(400, { error: err.message, rejectionReason: err.rejectionReason });
			}
			log.error({
				event: 'routes.clients.delete.failed',
				correlationId,
				entityType: 'client',
				entityId: params.id,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
		throw redirect(303, '/clients');
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
		const datesWellFormed =
			/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate);
		if (!datesWellFormed || startDate > endDate) {
			log.warn({
				event: 'routes.invoices.generate.validation.rejected',
				correlationId,
				entityType: 'invoice',
				reason: datesWellFormed ? 'start_after_end' : 'malformed_date',
				startDate,
				endDate
			});
			return fail(400, {
				error: datesWellFormed
					? 'Start date must be on or before end date'
					: 'Both dates must be YYYY-MM-DD'
			});
		}

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
