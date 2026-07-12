// Invoice lifecycle per .memory/state-transitions.md §3 and domain-model.md
// §5 (numbering), §6 (scope + generation), §8 (line items).
//
// Finalize cascades entries to locked; void cascades entries to discarded.
// Both cascades share the caller's correlationId so a single logical
// operation groups by one ID in the transition log.

import type { Database } from 'better-sqlite3';
import * as invoicesQ from '../db/queries/invoices';
import * as lineItemsQ from '../db/queries/lineItems';
import * as settingsQ from '../db/queries/settings';
import { ulid } from '../ids';
import { log, logTransition } from '../log';
import { localDateOf, nowUtcIso } from '../time';
import { StateTransitionError } from './_error';
import { lockEntry, unlockToDiscarded } from './entry';

const USER_ACTOR = { type: 'user' as const, id: 'user_teej' };

interface EligibleEntry {
	entryId: string;
	taskId: string;
	projectId: string;
	projectHourlyRate: number;
	taskName: string;
	projectName: string;
	totalHours: number;
}

/** Query entries eligible for invoicing per domain-model §6. */
function queryEligibleEntries(
	db: Database,
	clientId: string,
	startDate: string,
	endDate: string
): EligibleEntry[] {
	// Get stopped entries for this client with no invoice, then filter by
	// whether any segment's startedAt (in local time) falls in the inclusive
	// range [startDate, endDate].
	const rows = db
		.prepare(
			`SELECT
				e.id AS entryId,
				t.id AS taskId,
				t.name AS taskName,
				p.id AS projectId,
				p.name AS projectName,
				p.hourly_rate AS projectHourlyRate
			 FROM time_entries e
			 JOIN tasks t ON e.task_id = t.id
			 JOIN projects p ON t.project_id = p.id
			 WHERE p.client_id = ?
			   AND e.state = 'entry.stopped'
			   AND e.invoice_id IS NULL`
		)
		.all(clientId) as {
		entryId: string;
		taskId: string;
		taskName: string;
		projectId: string;
		projectName: string;
		projectHourlyRate: number;
	}[];

	const segmentsStmt = db.prepare(
		`SELECT started_at AS startedAt, stopped_at AS stoppedAt
		 FROM time_entry_segments
		 WHERE entry_id = ? AND stopped_at IS NOT NULL`
	);

	const eligible: EligibleEntry[] = [];
	for (const row of rows) {
		const segs = segmentsStmt.all(row.entryId) as {
			startedAt: string;
			stoppedAt: string;
		}[];
		let inScope = false;
		let totalMs = 0;
		for (const s of segs) {
			const localDate = localDateOf(s.startedAt);
			if (localDate >= startDate && localDate <= endDate) inScope = true;
			totalMs += new Date(s.stoppedAt).getTime() - new Date(s.startedAt).getTime();
		}
		if (inScope && totalMs > 0) {
			eligible.push({
				entryId: row.entryId,
				taskId: row.taskId,
				taskName: row.taskName,
				projectId: row.projectId,
				projectName: row.projectName,
				projectHourlyRate: row.projectHourlyRate,
				totalHours: totalMs / 3_600_000
			});
		}
	}
	return eligible;
}

// -----------------------------------------------------------------------------
// generateDraftInvoice
// -----------------------------------------------------------------------------

export function generateDraftInvoice(
	db: Database,
	args: { clientId: string; startDate: string; endDate: string },
	correlationId: string
): invoicesQ.Invoice {
	log.debug({ event: 'state.invoice.generate.enter', correlationId, ...args });

	const eligible = queryEligibleEntries(db, args.clientId, args.startDate, args.endDate);
	const invoiceId = ulid();

	if (eligible.length === 0) {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: null,
			newState: 'invoice.draft',
			trigger: 'user.generateInvoice',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'no_billable_entries'
		});
		throw new StateTransitionError(
			'no_billable_entries',
			`no unbilled stopped entries for client ${args.clientId} in [${args.startDate}, ${args.endDate}]`
		);
	}

	// Group by task and compute per-task hours × rate.
	const byTask = new Map<string, { hours: number; entry: EligibleEntry }>();
	for (const e of eligible) {
		const existing = byTask.get(e.taskId);
		if (existing) existing.hours += e.totalHours;
		else byTask.set(e.taskId, { hours: e.totalHours, entry: e });
	}

	const settings = settingsQ.getSettings(db);
	let subtotal = 0;
	const taskLines: {
		taskId: string;
		description: string;
		hours: number;
		rate: number;
		amount: number;
	}[] = [];
	for (const [taskId, { hours, entry }] of byTask) {
		const rate = entry.projectHourlyRate;
		const amount = Math.round(hours * rate);
		subtotal += amount;
		taskLines.push({
			taskId,
			description: `${entry.projectName} — ${entry.taskName}`,
			hours,
			rate,
			amount
		});
	}

	// Insert everything in a single transaction.
	db.transaction(() => {
		invoicesQ.createDraftInvoice(
			db,
			{
				id: invoiceId,
				clientId: args.clientId,
				startDate: args.startDate,
				endDate: args.endDate,
				paymentTermsDays: settings.defaultPaymentTermsDays,
				currencyCode: settings.currencyCode,
				currencyDecimals: settings.currencyDecimals,
				invoiceLocale: settings.invoiceLocale,
				subtotal,
				discountTotal: 0,
				total: subtotal
			},
			correlationId
		);
		let i = 0;
		for (const tl of taskLines) {
			lineItemsQ.createTaskLine(
				db,
				{
					invoiceId,
					taskId: tl.taskId,
					description: tl.description,
					hours: tl.hours,
					rate: tl.rate,
					amount: tl.amount,
					sortOrder: i++
				},
				correlationId
			);
		}
	})();

	logTransition({
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		previousState: null,
		newState: 'invoice.draft',
		trigger: 'user.generateInvoice',
		actor: USER_ACTOR,
		accepted: true
	});
	return invoicesQ.getInvoice(db, invoiceId)!;
}

// -----------------------------------------------------------------------------
// Extend createDraftInvoice signature — accept optional id
// -----------------------------------------------------------------------------

// (see src/lib/db/queries/invoices.ts — updated separately to accept id)

// -----------------------------------------------------------------------------
// Discount lines
// -----------------------------------------------------------------------------

export function addDiscountLine(
	db: Database,
	args: { invoiceId: string; description: string; amount: number },
	correlationId: string
): void {
	log.debug({ event: 'state.invoice.addDiscount.enter', correlationId, ...args });
	const invoice = invoicesQ.getInvoice(db, args.invoiceId);
	if (!invoice) throw new Error(`invoice ${args.invoiceId} not found`);
	if (invoice.state !== 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: args.invoiceId,
			previousState: invoice.state,
			newState: invoice.state,
			trigger: 'user.addDiscountLine',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invoice_locked'
		});
		throw new StateTransitionError(
			'invoice_locked',
			`invoice ${args.invoiceId} is ${invoice.state}; cannot edit`
		);
	}

	// invalid_discount_line: amount must be negative
	if (args.amount >= 0) {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: args.invoiceId,
			previousState: invoice.state,
			newState: invoice.state,
			trigger: 'user.addDiscountLine',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invalid_discount_line'
		});
		throw new StateTransitionError('invalid_discount_line', `discount amount must be negative`);
	}

	// invalid_discount_line: at most one per invoice
	const existing = db
		.prepare(
			`SELECT COUNT(*) AS n FROM invoice_line_items WHERE invoice_id = ? AND kind = 'discount'`
		)
		.get(args.invoiceId) as { n: number };
	if (existing.n > 0) {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: args.invoiceId,
			previousState: invoice.state,
			newState: invoice.state,
			trigger: 'user.addDiscountLine',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invalid_discount_line'
		});
		throw new StateTransitionError('invalid_discount_line', `invoice already has a discount line`);
	}

	// Recompute totals in a single transaction
	const nextSortOrder = db
		.prepare(
			`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM invoice_line_items WHERE invoice_id = ?`
		)
		.get(args.invoiceId) as { n: number };

	db.transaction(() => {
		lineItemsQ.createDiscountLine(
			db,
			{
				invoiceId: args.invoiceId,
				description: args.description,
				amount: args.amount,
				sortOrder: nextSortOrder.n
			},
			correlationId
		);
		const newDiscountTotal = invoice.discountTotal + args.amount;
		const newTotal = invoice.subtotal + newDiscountTotal;
		db.prepare(
			`UPDATE invoices SET discount_total = ?, total = ?, updated_at = ? WHERE id = ?`
		).run(newDiscountTotal, newTotal, nowUtcIso(), args.invoiceId);
	})();
}

export function removeDiscountLine(db: Database, invoiceId: string, correlationId: string): void {
	log.debug({ event: 'state.invoice.removeDiscount.enter', correlationId, invoiceId });
	const invoice = invoicesQ.getInvoice(db, invoiceId);
	if (!invoice) throw new Error(`invoice ${invoiceId} not found`);
	if (invoice.state !== 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: invoice.state,
			newState: invoice.state,
			trigger: 'user.removeDiscountLine',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invoice_locked'
		});
		throw new StateTransitionError(
			'invoice_locked',
			`invoice ${invoiceId} is ${invoice.state}; cannot edit`
		);
	}

	db.transaction(() => {
		db.prepare(`DELETE FROM invoice_line_items WHERE invoice_id = ? AND kind = 'discount'`).run(
			invoiceId
		);
		db.prepare(
			`UPDATE invoices SET discount_total = 0, total = subtotal, updated_at = ? WHERE id = ?`
		).run(nowUtcIso(), invoiceId);
	})();
}

// -----------------------------------------------------------------------------
// updateTaskLine — edit a draft task line's description/hours/rate, recompute totals
// -----------------------------------------------------------------------------

export function updateTaskLine(
	db: Database,
	args: { invoiceId: string; lineId: string; description: string; hours: number; rate: number },
	correlationId: string
): void {
	log.debug({ event: 'state.invoice.updateTaskLine.enter', correlationId, ...args });
	const invoice = invoicesQ.getInvoice(db, args.invoiceId);
	if (!invoice) throw new Error(`invoice ${args.invoiceId} not found`);
	if (invoice.state !== 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: args.invoiceId,
			previousState: invoice.state,
			newState: invoice.state,
			trigger: 'user.updateTaskLine',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invoice_locked'
		});
		throw new StateTransitionError(
			'invoice_locked',
			`invoice ${args.invoiceId} is ${invoice.state}; cannot edit`
		);
	}

	const line = db
		.prepare(
			`SELECT kind, description, hours, rate, amount FROM invoice_line_items WHERE id = ? AND invoice_id = ?`
		)
		.get(args.lineId, args.invoiceId) as
		| {
				kind: string;
				description: string;
				hours: number | null;
				rate: number | null;
				amount: number;
		  }
		| undefined;
	if (!line) throw new Error(`line ${args.lineId} not found on invoice ${args.invoiceId}`);
	if (line.kind !== 'task') throw new Error(`line ${args.lineId} is not a task line`);

	// amount = round(hours * rate). The DB CHECK requires hours > 0 and amount > 0
	// for task lines (see 003_invoices.sql); the route validates positivity first,
	// and this write is the backstop — a non-positive value rolls the transaction back.
	const amount = Math.round(args.hours * args.rate);

	db.transaction(() => {
		db.prepare(
			`UPDATE invoice_line_items SET description = ?, hours = ?, rate = ?, amount = ? WHERE id = ?`
		).run(args.description, args.hours, args.rate, amount, args.lineId);
		const { subtotal } = db
			.prepare(
				`SELECT COALESCE(SUM(amount), 0) AS subtotal FROM invoice_line_items WHERE invoice_id = ? AND kind = 'task'`
			)
			.get(args.invoiceId) as { subtotal: number };
		const newTotal = subtotal + invoice.discountTotal;
		db.prepare(`UPDATE invoices SET subtotal = ?, total = ?, updated_at = ? WHERE id = ?`).run(
			subtotal,
			newTotal,
			nowUtcIso(),
			args.invoiceId
		);
	})();

	log.info({
		event: 'invoice.updateTaskLine',
		correlationId,
		entityType: 'invoice',
		entityId: args.invoiceId,
		before: {
			description: line.description,
			hours: line.hours,
			rate: line.rate,
			amount: line.amount
		},
		after: { description: args.description, hours: args.hours, rate: args.rate, amount }
	});
}

// -----------------------------------------------------------------------------
// finalizeInvoice — draft → finalized, cascades entries to locked
// -----------------------------------------------------------------------------

function nextInvoiceNumber(db: Database, finalizedAt: string): string {
	const localDate = localDateOf(finalizedAt).replaceAll('-', '');
	const prefix = `${localDate}-`;
	const existing = db
		.prepare(
			`SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`
		)
		.get(`${prefix}%`) as { invoice_number: string } | undefined;
	if (!existing) return `${prefix}1`;
	const lastN = Number(existing.invoice_number.split('-').at(-1));
	return `${prefix}${lastN + 1}`;
}

export function finalizeInvoice(db: Database, invoiceId: string, correlationId: string): void {
	log.debug({ event: 'state.invoice.finalize.enter', correlationId, invoiceId });
	const invoice = invoicesQ.getInvoice(db, invoiceId);
	if (!invoice) throw new Error(`invoice ${invoiceId} not found`);

	if (invoice.state !== 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: invoice.state,
			newState: 'invoice.finalized',
			trigger: 'user.finalizeInvoice',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invoice_locked'
		});
		throw new StateTransitionError(
			'invoice_locked',
			`invoice ${invoiceId} is ${invoice.state}; cannot finalize`
		);
	}

	if (invoice.total <= 0) {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: 'invoice.draft',
			newState: 'invoice.finalized',
			trigger: 'user.finalizeInvoice',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invoice_non_positive_total'
		});
		throw new StateTransitionError(
			'invoice_non_positive_total',
			`invoice ${invoiceId} total is ${invoice.total}; must be > 0`
		);
	}

	// Cascade: lock every eligible entry (same criteria as generation).
	const eligible = queryEligibleEntries(db, invoice.clientId, invoice.startDate, invoice.endDate);

	const finalizedAt = nowUtcIso();
	const invoiceNumber = nextInvoiceNumber(db, finalizedAt);

	db.transaction(() => {
		db.prepare(
			`UPDATE invoices
			 SET state = 'invoice.finalized', invoice_number = ?, finalized_at = ?, updated_at = ?
			 WHERE id = ?`
		).run(invoiceNumber, finalizedAt, finalizedAt, invoiceId);
		for (const e of eligible) {
			lockEntry(db, { entryId: e.entryId, invoiceId }, correlationId);
		}
	})();

	logTransition({
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		previousState: 'invoice.draft',
		newState: 'invoice.finalized',
		trigger: 'user.finalizeInvoice',
		actor: USER_ACTOR,
		accepted: true
	});
}

// -----------------------------------------------------------------------------
// exportInvoice — finalized/exported → exported
// -----------------------------------------------------------------------------

export function exportInvoice(db: Database, invoiceId: string, correlationId: string): void {
	log.debug({ event: 'state.invoice.export.enter', correlationId, invoiceId });
	const invoice = invoicesQ.getInvoice(db, invoiceId);
	if (!invoice) throw new Error(`invoice ${invoiceId} not found`);
	if (invoice.state === 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: invoice.state,
			newState: 'invoice.exported',
			trigger: 'user.exportInvoice',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'must_finalize_before_export'
		});
		throw new StateTransitionError(
			'must_finalize_before_export',
			`invoice ${invoiceId} is a draft; finalize first`
		);
	}
	if (invoice.state === 'invoice.voided') {
		throw new Error(`invoice ${invoiceId} is voided; cannot export`);
	}

	db.prepare(`UPDATE invoices SET state = 'invoice.exported', updated_at = ? WHERE id = ?`).run(
		nowUtcIso(),
		invoiceId
	);
	logTransition({
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		previousState: invoice.state,
		newState: 'invoice.exported',
		trigger: 'user.exportInvoice',
		actor: USER_ACTOR,
		accepted: true
	});
}

// -----------------------------------------------------------------------------
// voidInvoice — finalized/exported → voided, cascades entries to discarded
// -----------------------------------------------------------------------------

export function voidInvoice(db: Database, invoiceId: string, correlationId: string): void {
	log.debug({ event: 'state.invoice.void.enter', correlationId, invoiceId });
	const invoice = invoicesQ.getInvoice(db, invoiceId);
	if (!invoice) throw new Error(`invoice ${invoiceId} not found`);

	if (invoice.state === 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: invoice.state,
			newState: 'invoice.voided',
			trigger: 'user.voidInvoice',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'void_requires_finalized'
		});
		throw new StateTransitionError(
			'void_requires_finalized',
			`invoice ${invoiceId} is a draft; delete instead`
		);
	}
	if (invoice.state === 'invoice.voided') {
		throw new Error(`invoice ${invoiceId} is already voided`);
	}

	const lockedEntries = db
		.prepare(`SELECT id FROM time_entries WHERE invoice_id = ? AND state = 'entry.locked'`)
		.all(invoiceId) as { id: string }[];

	const voidedAt = nowUtcIso();
	db.transaction(() => {
		for (const e of lockedEntries) {
			unlockToDiscarded(db, e.id, correlationId);
		}
		db.prepare(
			`UPDATE invoices SET state = 'invoice.voided', voided_at = ?, updated_at = ? WHERE id = ?`
		).run(voidedAt, voidedAt, invoiceId);
	})();

	logTransition({
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		previousState: invoice.state,
		newState: 'invoice.voided',
		trigger: 'user.voidInvoice',
		actor: USER_ACTOR,
		accepted: true
	});
}

// -----------------------------------------------------------------------------
// deleteDraft — draft → (removed). Line items cascade via ON DELETE CASCADE.
// -----------------------------------------------------------------------------

export function deleteDraft(db: Database, invoiceId: string, correlationId: string): void {
	log.debug({ event: 'state.invoice.deleteDraft.enter', correlationId, invoiceId });
	const invoice = invoicesQ.getInvoice(db, invoiceId);
	if (!invoice) throw new Error(`invoice ${invoiceId} not found`);
	if (invoice.state !== 'invoice.draft') {
		logTransition({
			correlationId,
			entityType: 'invoice',
			entityId: invoiceId,
			previousState: invoice.state,
			newState: 'invoice.deleted',
			trigger: 'user.deleteDraft',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'invoice_locked'
		});
		throw new StateTransitionError(
			'invoice_locked',
			`invoice ${invoiceId} is ${invoice.state}; cannot delete`
		);
	}
	db.prepare(`DELETE FROM invoices WHERE id = ?`).run(invoiceId);
	log.info({
		event: 'invoice.delete',
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		before: invoice,
		after: null
	});
	logTransition({
		correlationId,
		entityType: 'invoice',
		entityId: invoiceId,
		previousState: 'invoice.draft',
		newState: 'invoice.deleted',
		trigger: 'user.deleteDraft',
		actor: USER_ACTOR,
		accepted: true
	});
}
