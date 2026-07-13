import { getDb } from '$lib/db';
import { listInvoices } from '$lib/db/queries/invoices';
import { log } from '$lib/log';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	log.debug({ event: 'routes.invoices.list.load' });
	return { invoices: listInvoices(getDb()) };
};
