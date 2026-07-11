import type { Database } from 'better-sqlite3';
import { log } from '../../log';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export interface Settings {
	id: 1;
	senderName: string;
	senderAddress: string;
	senderEmail: string;
	senderPhone: string | null;
	paymentInstructions: string;
	currencyCode: string;
	currencyDecimals: number;
	defaultPaymentTermsDays: number;
	invoiceLocale: string;
}

export interface UpdateSettingsArgs {
	senderName: string;
	senderAddress: string;
	senderEmail: string;
	senderPhone: string | null;
	paymentInstructions: string;
	currencyCode: string;
	currencyDecimals: number;
	defaultPaymentTermsDays: number;
	invoiceLocale: string;
}

export function getSettings(db: Database): Settings {
	log.debug({ event: 'db.query.getSettings' });
	const row = prep(db, `SELECT * FROM settings WHERE id = 1`).get();
	if (!row) throw new Error('settings singleton row missing');
	return rowToCamel<Settings>(row);
}

export function updateSettings(
	db: Database,
	args: UpdateSettingsArgs,
	correlationId: string
): Settings {
	requireCorrelationId(correlationId, 'updateSettings');
	const before = getSettings(db);
	prep(
		db,
		`UPDATE settings SET
			sender_name = ?,
			sender_address = ?,
			sender_email = ?,
			sender_phone = ?,
			payment_instructions = ?,
			currency_code = ?,
			currency_decimals = ?,
			default_payment_terms_days = ?,
			invoice_locale = ?
		 WHERE id = 1`
	).run(
		args.senderName,
		args.senderAddress,
		args.senderEmail,
		args.senderPhone,
		args.paymentInstructions,
		args.currencyCode,
		args.currencyDecimals,
		args.defaultPaymentTermsDays,
		args.invoiceLocale
	);
	const after = getSettings(db);
	log.info({
		event: 'settings.update',
		correlationId,
		entityType: 'settings',
		entityId: '1',
		before,
		after
	});
	return after;
}
