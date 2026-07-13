import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/db';
import { getSettings, updateSettings } from '$lib/db/queries/settings';
import { log } from '$lib/log';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const db = getDb();
	const settings = getSettings(db);
	log.debug({ event: 'routes.settings.load' });
	return { settings };
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const correlationId = locals.correlationId;
		if (!correlationId) {
			log.error({ event: 'routes.settings.update.missing_cid' });
			return fail(500, { error: 'correlationId missing on locals' });
		}

		const form = await request.formData();
		const parseInt0 = (name: string, fallback: number, min: number, max: number): number => {
			const raw = form.get(name);
			const parsed = raw === null ? fallback : Number(raw);
			if (!Number.isFinite(parsed)) return fallback;
			return Math.min(max, Math.max(min, Math.trunc(parsed)));
		};
		const args = {
			senderName: String(form.get('senderName') ?? '').trim(),
			senderAddress: String(form.get('senderAddress') ?? '').trim(),
			senderEmail: String(form.get('senderEmail') ?? '').trim(),
			senderPhone: (() => {
				const raw = form.get('senderPhone');
				const v = raw === null ? '' : String(raw).trim();
				return v.length > 0 ? v : null;
			})(),
			paymentInstructions: String(form.get('paymentInstructions') ?? '').trim(),
			currencyCode: String(form.get('currencyCode') ?? '')
				.trim()
				.toUpperCase(),
			currencyDecimals: parseInt0('currencyDecimals', 2, 0, 4),
			defaultPaymentTermsDays: parseInt0('defaultPaymentTermsDays', 30, 0, 3650),
			invoiceLocale: String(form.get('invoiceLocale') ?? '').trim()
		};

		// Reject config that would later throw an Intl RangeError on every invoice
		// render/export (a persistent denial of invoicing). currencyCode must be a
		// 3-letter alpha code; invoiceLocale must be a well-formed BCP-47 tag.
		const currencyOk = /^[A-Z]{3}$/.test(args.currencyCode);
		let localeOk = true;
		try {
			new Intl.NumberFormat(args.invoiceLocale, {
				style: 'currency',
				currency: currencyOk ? args.currencyCode : 'USD'
			});
		} catch {
			localeOk = false;
		}
		if (!currencyOk || !localeOk) {
			log.warn({
				event: 'routes.settings.update.validation.rejected',
				correlationId,
				entityType: 'settings',
				entityId: '1',
				reason: !currencyOk ? 'invalid_currency_code' : 'invalid_locale',
				currencyCode: args.currencyCode,
				invoiceLocale: args.invoiceLocale
			});
			return fail(400, { error: 'Invalid currency code or locale' });
		}

		try {
			const updated = updateSettings(getDb(), args, correlationId);
			return { success: true, settings: updated };
		} catch (err) {
			log.error({
				event: 'routes.settings.update.failed',
				correlationId,
				error: {
					message: (err as Error).message,
					stack: (err as Error).stack
				}
			});
			return fail(400, { error: (err as Error).message });
		}
	}
};
