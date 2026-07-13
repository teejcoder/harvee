import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getInvoice } from '$lib/db/queries/invoices';
import { listInvoiceLines } from '$lib/db/queries/lineItems';
import { log } from '$lib/log';
import { toMinorUnits } from '$lib/money';
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
		if (!Number.isFinite(amountInput)) {
			log.warn({
				event: 'routes.invoices.addDiscount.validation.rejected',
				correlationId,
				entityType: 'invoice',
				entityId: params.id,
				reason: 'amount_not_finite'
			});
			return fail(400, { error: 'Amount must be a number' });
		}
		// Positive input represents the discount magnitude; store as negative minor
		// units in the invoice's own currency precision (JPY=0dp, USD=2dp, …).
		const decimals = getInvoice(getDb(), params.id)?.currencyDecimals ?? 2;
		const amount = -Math.abs(toMinorUnits(amountInput, decimals));
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
		let reason: string | null = null;
		if (!lineId) reason = 'missing_line_id';
		else if (description.length === 0) reason = 'empty_description';
		else if (!Number.isFinite(hours) || hours <= 0) reason = 'non_positive_hours';
		else if (!Number.isFinite(rateInput) || rateInput <= 0) reason = 'non_positive_rate';
		if (reason) {
			log.warn({
				event: 'routes.invoices.updateLine.validation.rejected',
				correlationId,
				entityType: 'invoice',
				entityId: params.id,
				reason
			});
			return fail(400, { error: `Invalid line edit (${reason})` });
		}
		// Rate is entered in major units; store as minor units at the invoice's precision.
		const decimals = getInvoice(getDb(), params.id)?.currencyDecimals ?? 2;
		const rate = toMinorUnits(rateInput, decimals);
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
		} catch (err) {
			return toActionResult(err);
		}
		// The invoice no longer exists — send the user to the list instead of a 404.
		throw redirect(303, '/invoices');
	}
};
