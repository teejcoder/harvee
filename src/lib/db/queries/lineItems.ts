import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export type LineItemKind = 'task' | 'discount';

export interface LineItem {
	id: string;
	invoiceId: string;
	kind: LineItemKind;
	taskId: string | null;
	description: string;
	hours: number | null;
	rate: number | null;
	amount: number;
	sortOrder: number;
}

export interface CreateTaskLineArgs {
	invoiceId: string;
	taskId: string;
	description: string;
	hours: number;
	rate: number;
	amount: number;
	sortOrder: number;
}

export interface CreateDiscountLineArgs {
	invoiceId: string;
	description: string;
	amount: number;
	sortOrder: number;
}

export function createTaskLine(
	db: Database,
	args: CreateTaskLineArgs,
	correlationId: string
): LineItem {
	requireCorrelationId(correlationId, 'createTaskLine');
	const id = ulid();
	prep(
		db,
		`INSERT INTO invoice_line_items
			(id, invoice_id, kind, task_id, description, hours, rate, amount, sort_order)
		 VALUES (?, ?, 'task', ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		args.invoiceId,
		args.taskId,
		args.description,
		args.hours,
		args.rate,
		args.amount,
		args.sortOrder
	);
	const created: LineItem = {
		id,
		invoiceId: args.invoiceId,
		kind: 'task',
		taskId: args.taskId,
		description: args.description,
		hours: args.hours,
		rate: args.rate,
		amount: args.amount,
		sortOrder: args.sortOrder
	};
	log.info({
		event: 'lineItem.create',
		correlationId,
		entityType: 'invoice',
		entityId: args.invoiceId,
		before: null,
		after: created
	});
	return created;
}

export function createDiscountLine(
	db: Database,
	args: CreateDiscountLineArgs,
	correlationId: string
): LineItem {
	requireCorrelationId(correlationId, 'createDiscountLine');
	const id = ulid();
	prep(
		db,
		`INSERT INTO invoice_line_items
			(id, invoice_id, kind, description, amount, sort_order)
		 VALUES (?, ?, 'discount', ?, ?, ?)`
	).run(id, args.invoiceId, args.description, args.amount, args.sortOrder);
	const created: LineItem = {
		id,
		invoiceId: args.invoiceId,
		kind: 'discount',
		taskId: null,
		description: args.description,
		hours: null,
		rate: null,
		amount: args.amount,
		sortOrder: args.sortOrder
	};
	log.info({
		event: 'lineItem.create',
		correlationId,
		entityType: 'invoice',
		entityId: args.invoiceId,
		before: null,
		after: created
	});
	return created;
}

export function listInvoiceLines(db: Database, invoiceId: string): LineItem[] {
	log.debug({
		event: 'db.query.listInvoiceLines',
		entityType: 'invoice',
		entityId: invoiceId
	});
	const rows = prep(
		db,
		`SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order`
	).all(invoiceId);
	return rows.map((r) => rowToCamel<LineItem>(r));
}
