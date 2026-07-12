// Step 6.6 — export a finalized invoice as a PDF. This is a POST endpoint (not a
// SvelteKit form action) because it streams binary bytes back as a download, which
// an ActionResult cannot carry. It also writes the same bytes to
// `<INVOICE_DIR>/<invoiceNumber>.pdf` on disk. Re-exporting overwrites + re-downloads
// per .memory/tech-stack.md §PDF export.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getClient } from '$lib/db/queries/clients';
import { getInvoice } from '$lib/db/queries/invoices';
import { listInvoiceLines } from '$lib/db/queries/lineItems';
import { getSettings } from '$lib/db/queries/settings';
import { log } from '$lib/log';
import { renderInvoicePdf } from '$lib/pdf/invoice';
import { exportInvoice } from '$lib/state/invoice';
import { StateTransitionError } from '$lib/state/_error';
import type { RequestHandler } from './$types';

// Overridable so tests can write to a tmp dir instead of the repo (mirrors the
// DATABASE_PATH / LOG_PATH pattern). Defaults to the gitignored `invoices/`.
function invoiceDir(): string {
	return process.env.INVOICE_DIR ?? 'invoices';
}

export const POST: RequestHandler = async ({ locals, params }) => {
	const correlationId = locals.correlationId;
	if (!correlationId) throw error(500, 'correlationId missing on locals');
	const db = getDb();
	log.debug({
		event: 'routes.invoices.export.enter',
		correlationId,
		entityType: 'invoice',
		entityId: params.id
	});

	const existing = getInvoice(db, params.id);
	if (!existing) throw error(404, `Invoice ${params.id} not found`);

	try {
		// Transition finalized → exported (idempotent on an already-exported invoice).
		// Rejects a draft with `must_finalize_before_export` before we render anything.
		exportInvoice(db, params.id, correlationId);
	} catch (err) {
		if (err instanceof StateTransitionError) {
			return json({ error: err.message, rejectionReason: err.rejectionReason }, { status: 400 });
		}
		log.error({
			event: 'routes.invoices.export.failed',
			correlationId,
			entityType: 'invoice',
			entityId: params.id,
			error: { message: (err as Error).message, stack: (err as Error).stack }
		});
		throw err;
	}

	const invoice = getInvoice(db, params.id);
	if (!invoice?.invoiceNumber) throw error(500, `Invoice ${params.id} has no invoice number`);
	const client = getClient(db, invoice.clientId);
	if (!client) throw error(500, `Client ${invoice.clientId} not found`);
	const settings = getSettings(db);
	const lines = listInvoiceLines(db, params.id);

	const bytes = await renderInvoicePdf({ invoice, client, settings, lines }, correlationId);

	const dir = invoiceDir();
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, `${invoice.invoiceNumber}.pdf`);
	writeFileSync(filePath, bytes);
	log.info({
		event: 'invoice.pdf.written',
		correlationId,
		entityType: 'invoice',
		entityId: invoice.id,
		path: filePath,
		bytes: bytes.length
	});

	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
			'content-length': String(bytes.length)
		}
	});
};
