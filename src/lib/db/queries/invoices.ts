import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { nowUtcIso } from '../../time';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export type InvoiceState =
	'invoice.draft' | 'invoice.finalized' | 'invoice.exported' | 'invoice.voided';

export interface Invoice {
	id: string;
	clientId: string;
	state: InvoiceState;
	startDate: string;
	endDate: string;
	invoiceNumber: string | null;
	paymentTermsDays: number;
	currencyCode: string;
	currencyDecimals: number;
	invoiceLocale: string;
	subtotal: number;
	discountTotal: number;
	total: number;
	finalizedAt: string | null;
	voidedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateInvoiceDraftArgs {
	id?: string;
	clientId: string;
	startDate: string;
	endDate: string;
	paymentTermsDays: number;
	currencyCode: string;
	currencyDecimals: number;
	invoiceLocale: string;
	subtotal: number;
	discountTotal: number;
	total: number;
}

/** Only creates draft invoices — non-draft states are entered via state-machine transitions later. */
export function createDraftInvoice(
	db: Database,
	args: CreateInvoiceDraftArgs,
	correlationId: string
): Invoice {
	requireCorrelationId(correlationId, 'createDraftInvoice');
	const id = args.id ?? ulid();
	const now = nowUtcIso();
	prep(
		db,
		`INSERT INTO invoices (
			id, client_id, state, start_date, end_date,
			payment_terms_days, currency_code, currency_decimals, invoice_locale,
			subtotal, discount_total, total, created_at, updated_at
		 ) VALUES (?, ?, 'invoice.draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		args.clientId,
		args.startDate,
		args.endDate,
		args.paymentTermsDays,
		args.currencyCode,
		args.currencyDecimals,
		args.invoiceLocale,
		args.subtotal,
		args.discountTotal,
		args.total,
		now,
		now
	);
	const created: Invoice = {
		id,
		clientId: args.clientId,
		state: 'invoice.draft',
		startDate: args.startDate,
		endDate: args.endDate,
		invoiceNumber: null,
		paymentTermsDays: args.paymentTermsDays,
		currencyCode: args.currencyCode,
		currencyDecimals: args.currencyDecimals,
		invoiceLocale: args.invoiceLocale,
		subtotal: args.subtotal,
		discountTotal: args.discountTotal,
		total: args.total,
		finalizedAt: null,
		voidedAt: null,
		createdAt: now,
		updatedAt: now
	};
	log.info({
		event: 'invoice.create',
		correlationId,
		entityType: 'invoice',
		entityId: id,
		before: null,
		after: created
	});
	return created;
}

export function getInvoice(db: Database, id: string): Invoice | undefined {
	log.debug({ event: 'db.query.getInvoice', entityType: 'invoice', entityId: id });
	const row = prep(db, `SELECT * FROM invoices WHERE id = ?`).get(id);
	return row ? rowToCamel<Invoice>(row) : undefined;
}

export interface InvoiceListItem {
	id: string;
	clientId: string;
	clientName: string;
	state: InvoiceState;
	invoiceNumber: string | null;
	startDate: string;
	endDate: string;
	total: number;
	currencyCode: string;
	currencyDecimals: number;
	invoiceLocale: string;
	finalizedAt: string | null;
	createdAt: string;
}

/** List invoices (newest first) with client name joined; optionally scoped to one client. */
export function listInvoices(db: Database, opts: { clientId?: string } = {}): InvoiceListItem[] {
	log.debug({ event: 'db.query.listInvoices', clientId: opts.clientId });
	const where = opts.clientId ? 'WHERE i.client_id = ?' : '';
	const stmt = prep(
		db,
		`SELECT
			i.id AS id,
			i.client_id AS clientId,
			c.name AS clientName,
			i.state AS state,
			i.invoice_number AS invoiceNumber,
			i.start_date AS startDate,
			i.end_date AS endDate,
			i.total AS total,
			i.currency_code AS currencyCode,
			i.currency_decimals AS currencyDecimals,
			i.invoice_locale AS invoiceLocale,
			i.finalized_at AS finalizedAt,
			i.created_at AS createdAt
		 FROM invoices i
		 JOIN clients c ON i.client_id = c.id
		 ${where}
		 ORDER BY i.created_at DESC`
	);
	return (opts.clientId ? stmt.all(opts.clientId) : stmt.all()) as InvoiceListItem[];
}
