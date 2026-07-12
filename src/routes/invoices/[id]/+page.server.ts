import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getInvoice } from '$lib/db/queries/invoices';
import { listInvoiceLines } from '$lib/db/queries/lineItems';
import { log } from '$lib/log';
import {
	addDiscountLine,
	deleteDraft,
	finalizeInvoice,
	removeDiscountLine,
	updateTaskLine,
	voidInvoice
} from '$lib/state/invoice';
import { StateTransitionError } from '$lib/state/_error';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const db = getDb();
	log.debug({ event: 'routes.invoices.detail.load', entityId: params.id });

	const invoice = getInvoice(db, params.id);
	if (!invoice) throw error(404, `Invoice ${params.id} not found`);

	const client = db.prepare(`SELECT id, name FROM clients WHERE id = ?`).get(invoice.clientId) as {
		id: string;
		name: string;
	};

	const lines = listInvoiceLines(db, params.id);

	return { invoice, client, lines };
};

function toActionResult(err: unknown): ReturnType<typeof fail> {
	if (err instanceof StateTransitionError) {
		return fail(400, { error: err.message, rejectionReason: err.rejectionReason });
	}
	return fail(500, { error: (err as Error).message });
}

export const actions: Actions = {
	addDiscount: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const description = String(form.get('description') ?? '').trim() || 'Discount';
		const amountInput = Number(form.get('amount'));
		if (!Number.isFinite(amountInput)) return fail(400, { error: 'Amount must be a number' });
		// Positive input from the user represents the discount magnitude; store as negative minor units.
		const amount = -Math.round(Math.abs(amountInput) * 100);
		try {
			addDiscountLine(getDb(), { invoiceId: params.id, description, amount }, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	updateLine: async ({ request, locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		const form = await request.formData();
		const lineId = String(form.get('lineId') ?? '');
		const description = String(form.get('description') ?? '').trim();
		const hours = Number(form.get('hours'));
		const rateInput = Number(form.get('rate'));
		if (!lineId) return fail(400, { error: 'lineId required' });
		if (description.length === 0) return fail(400, { error: 'Description is required' });
		if (!Number.isFinite(hours) || hours <= 0)
			return fail(400, { error: 'Hours must be a positive number' });
		if (!Number.isFinite(rateInput) || rateInput <= 0)
			return fail(400, { error: 'Rate must be a positive number' });
		// Rate is entered in major currency units; store as minor units (matches addDiscount's *100).
		const rate = Math.round(rateInput * 100);
		try {
			updateTaskLine(
				getDb(),
				{ invoiceId: params.id, lineId, description, hours, rate },
				correlationId
			);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	removeDiscount: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			removeDiscountLine(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	finalize: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			finalizeInvoice(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	void: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			voidInvoice(getDb(), params.id, correlationId);
			return { success: true };
		} catch (err) {
			return toActionResult(err);
		}
	},

	delete: async ({ locals, params }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) return fail(500, { error: 'correlationId missing on locals' });
		try {
			deleteDraft(getDb(), params.id, correlationId);
			return { success: true, deleted: true };
		} catch (err) {
			return toActionResult(err);
		}
	}
};
