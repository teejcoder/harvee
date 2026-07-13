import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { log } from '$lib/log';
import { createClient } from '$lib/state/client';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

interface ClientRow {
	id: string;
	name: string;
	archivedAt: string | null;
}

export const load: PageServerLoad = () => {
	const db = getDb();
	log.debug({ event: 'routes.clients.list.load' });
	const rows = db
		.prepare(
			`SELECT id, name, archived_at AS archivedAt
			 FROM clients
			 ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`
		)
		.all() as ClientRow[];
	return { clients: rows };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (name.length === 0) {
			log.warn({
				event: 'routes.clients.create.validation.rejected',
				correlationId,
				entityType: 'client',
				reason: 'empty_name'
			});
			return fail(400, { error: 'Name is required' });
		}

		try {
			const client = createClient(getDb(), { name }, correlationId);
			return { success: true, clientId: client.id };
		} catch (err) {
			if (err instanceof StateTransitionError) {
				return fail(400, {
					error: err.message,
					rejectionReason: err.rejectionReason
				});
			}
			log.error({
				event: 'routes.clients.create.failed',
				correlationId,
				error: { message: (err as Error).message, stack: (err as Error).stack }
			});
			return fail(500, { error: (err as Error).message });
		}
	}
};
