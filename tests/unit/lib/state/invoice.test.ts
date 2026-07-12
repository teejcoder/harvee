// Table-driven tests for the invoice state machine per
// .memory/state-transitions.md §3 and Step 2.3 in the plan.

import type { Database } from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb } from '../../../../src/lib/db';
import { createClient } from '../../../../src/lib/state/client';
import { createProject } from '../../../../src/lib/state/project';
import { createTask } from '../../../../src/lib/state/task';
import { pickTask, startTimer, stopTimer } from '../../../../src/lib/state/entry';
import {
	addDiscountLine,
	deleteDraft,
	exportInvoice,
	finalizeInvoice,
	generateDraftInvoice,
	removeDiscountLine,
	voidInvoice
} from '../../../../src/lib/state/invoice';
import { StateTransitionError } from '../../../../src/lib/state/_error';

const CID = '01HXZ8K3M9Q2R7VYABCDEF1234';

let tmpDir: string;
let dbPath: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-inv-'));
	dbPath = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
	vi.useRealTimers();
});

function allLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function transitionLines(): Record<string, unknown>[] {
	return allLines().filter((l) => Object.hasOwn(l, 'previousState'));
}

/** Seed a client + project + task and produce N stopped entries whose
 *  segments fall entirely on 2026-07-10 (system-local). */
function seedStoppedEntries(db: Database, count: number): { clientId: string; taskId: string } {
	const c = createClient(db, { name: 'Acme' }, CID);
	const p = createProject(db, { clientId: c.id, name: 'Proj', hourlyRate: 10000 }, CID);
	const t = createTask(db, { projectId: p.id, name: 'Task' }, CID);

	for (let i = 0; i < count; i++) {
		// Freeze time to a fixed moment on 2026-07-10 for each entry so that
		// every segment's startedAt is in-range for the invoice.
		vi.useFakeTimers();
		vi.setSystemTime(new Date(`2026-07-10T12:${String(i).padStart(2, '0')}:00.000Z`));
		const e = pickTask(db, { taskId: t.id }, CID);
		startTimer(db, e.id, CID);
		vi.setSystemTime(new Date(`2026-07-10T13:${String(i).padStart(2, '0')}:00.000Z`));
		stopTimer(db, e.id, CID);
		vi.useRealTimers();
	}

	return { clientId: c.id, taskId: t.id };
}

// ---------------------------------------------------------------------------
// Accepted transitions
// ---------------------------------------------------------------------------

describe('accepted transitions', () => {
	test('generateDraftInvoice: `—` → invoice.draft with correct line item', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		expect(inv.state).toBe('invoice.draft');
		expect(inv.subtotal).toBeGreaterThan(0);
		expect(inv.total).toBe(inv.subtotal);
		expect(inv.invoiceNumber).toBeNull();
		expect(inv.finalizedAt).toBeNull();

		const t = transitionLines().find(
			(l) => l.entityId === inv.id && l.trigger === 'user.generateInvoice'
		);
		expect(t).toMatchObject({
			previousState: null,
			newState: 'invoice.draft',
			accepted: true
		});

		const lines = db
			.prepare(`SELECT COUNT(*) AS n FROM invoice_line_items WHERE invoice_id = ?`)
			.get(inv.id) as { n: number };
		expect(lines.n).toBe(1);
		db.close();
	});

	test('finalize cascade: invoice + N entry.locked share one correlationId', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 3);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);

		const CASCADE_CID = '01HXZ8K3M9Q2R7VYABCDEFCAS1';
		finalizeInvoice(db, inv.id, CASCADE_CID);

		const cascadeLines = transitionLines().filter((l) => l.correlationId === CASCADE_CID);
		const invLine = cascadeLines.find(
			(l) => l.trigger === 'user.finalizeInvoice' && l.accepted === true
		);
		const lockLines = cascadeLines.filter(
			(l) => l.trigger === 'system.invoiceFinalize' && l.accepted === true
		);
		expect(invLine).toMatchObject({
			previousState: 'invoice.draft',
			newState: 'invoice.finalized'
		});
		expect(lockLines).toHaveLength(3);
		for (const line of lockLines) {
			expect(line).toMatchObject({
				previousState: 'entry.stopped',
				newState: 'entry.locked',
				actor: { type: 'system' }
			});
		}

		const finalized = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(inv.id) as {
			invoice_number: string;
			finalized_at: string;
		};
		expect(finalized.invoice_number).toMatch(/^\d{8}-\d+$/);
		expect(finalized.finalized_at).not.toBeNull();
		db.close();
	});

	test('exportInvoice: finalized → exported; re-export from exported also OK', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, inv.id, CID);
		exportInvoice(db, inv.id, CID);
		let last = transitionLines().at(-1)!;
		expect(last).toMatchObject({
			previousState: 'invoice.finalized',
			newState: 'invoice.exported'
		});
		exportInvoice(db, inv.id, CID);
		last = transitionLines().at(-1)!;
		expect(last).toMatchObject({
			previousState: 'invoice.exported',
			newState: 'invoice.exported'
		});
		db.close();
	});

	test('exported → voided: void after export follows the same cascade shape', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 2);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, inv.id, CID);
		exportInvoice(db, inv.id, CID);

		const VOID_CID = '01HXZ8K3M9Q2R7VYABCDEFXPV1';
		voidInvoice(db, inv.id, VOID_CID);

		const cascadeLines = transitionLines().filter((l) => l.correlationId === VOID_CID);
		const invLine = cascadeLines.find(
			(l) => l.trigger === 'user.voidInvoice' && l.accepted === true
		);
		const unlockLines = cascadeLines.filter(
			(l) => l.trigger === 'system.invoiceVoid' && l.accepted === true
		);
		expect(invLine).toMatchObject({
			previousState: 'invoice.exported',
			newState: 'invoice.voided'
		});
		expect(unlockLines).toHaveLength(2);
		db.close();
	});

	test('void cascade: invoice + N entry.discarded share one correlationId', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 2);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, inv.id, CID);

		const VOID_CID = '01HXZ8K3M9Q2R7VYABCDEFVOI2';
		voidInvoice(db, inv.id, VOID_CID);

		const cascadeLines = transitionLines().filter((l) => l.correlationId === VOID_CID);
		const invLine = cascadeLines.find(
			(l) => l.trigger === 'user.voidInvoice' && l.accepted === true
		);
		const unlockLines = cascadeLines.filter(
			(l) => l.trigger === 'system.invoiceVoid' && l.accepted === true
		);
		expect(invLine).toMatchObject({
			previousState: 'invoice.finalized',
			newState: 'invoice.voided'
		});
		expect(unlockLines).toHaveLength(2);
		for (const line of unlockLines) {
			expect(line).toMatchObject({
				previousState: 'entry.locked',
				newState: 'entry.discarded',
				actor: { type: 'system' }
			});
		}
		db.close();
	});

	test('addDiscountLine + removeDiscountLine round-trip updates totals', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		const originalSubtotal = inv.subtotal;

		addDiscountLine(db, { invoiceId: inv.id, description: 'Discount', amount: -500 }, CID);
		let after = db
			.prepare(`SELECT discount_total, total FROM invoices WHERE id = ?`)
			.get(inv.id) as {
			discount_total: number;
			total: number;
		};
		expect(after.discount_total).toBe(-500);
		expect(after.total).toBe(originalSubtotal - 500);

		removeDiscountLine(db, inv.id, CID);
		after = db.prepare(`SELECT discount_total, total FROM invoices WHERE id = ?`).get(inv.id) as {
			discount_total: number;
			total: number;
		};
		expect(after.discount_total).toBe(0);
		expect(after.total).toBe(originalSubtotal);
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Rejections — every §3 rejection code
// ---------------------------------------------------------------------------

describe('rejection: no_billable_entries', () => {
	test('generate for a client with no unbilled stopped entries', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'Empty' }, CID);
		expect(() =>
			generateDraftInvoice(
				db,
				{ clientId: c.id, startDate: '2026-07-01', endDate: '2026-07-31' },
				CID
			)
		).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'no_billable_entries' });
		db.close();
	});
});

describe('rejection: invoice_locked', () => {
	test('addDiscountLine on a finalized invoice', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, inv.id, CID);
		expect(() =>
			addDiscountLine(db, { invoiceId: inv.id, description: 'X', amount: -100 }, CID)
		).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'invoice_locked' });
		db.close();
	});

	test('finalize on an already-finalized invoice', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, inv.id, CID);
		expect(() => finalizeInvoice(db, inv.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'invoice_locked' });
		db.close();
	});
});

describe('rejection: invoice_non_positive_total', () => {
	test('finalize a draft whose total is 0 after adding an offsetting discount', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		addDiscountLine(db, { invoiceId: inv.id, description: 'Full', amount: -inv.subtotal }, CID);
		expect(() => finalizeInvoice(db, inv.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'invoice_non_positive_total'
		});
		db.close();
	});
});

describe('rejection: invalid_discount_line', () => {
	test('adding a non-negative discount', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		expect(() =>
			addDiscountLine(db, { invoiceId: inv.id, description: 'Bad', amount: 100 }, CID)
		).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'invalid_discount_line' });
		db.close();
	});

	test('adding a second discount line', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		addDiscountLine(db, { invoiceId: inv.id, description: 'D1', amount: -100 }, CID);
		expect(() =>
			addDiscountLine(db, { invoiceId: inv.id, description: 'D2', amount: -100 }, CID)
		).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'invalid_discount_line' });
		db.close();
	});
});

describe('rejection: must_finalize_before_export', () => {
	test('export a draft', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		expect(() => exportInvoice(db, inv.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'must_finalize_before_export'
		});
		db.close();
	});
});

describe('rejection: void_requires_finalized', () => {
	test('void a draft', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		expect(() => voidInvoice(db, inv.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'void_requires_finalized'
		});
		db.close();
	});
});

// ---------------------------------------------------------------------------
// deleteDraft (accepted path + rejection)
// ---------------------------------------------------------------------------

describe('deleteDraft', () => {
	test('draft can be deleted; finalized cannot (invoice_locked)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId } = seedStoppedEntries(db, 1);
		const draft = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		deleteDraft(db, draft.id, CID);
		const gone = db.prepare(`SELECT id FROM invoices WHERE id = ?`).get(draft.id);
		expect(gone).toBeUndefined();
		// Accepted delete must emit a transition line targeting the pseudo-terminal state.
		const deleteTransition = transitionLines().find(
			(l) => l.entityId === draft.id && l.trigger === 'user.deleteDraft' && l.accepted === true
		);
		expect(deleteTransition).toMatchObject({
			previousState: 'invoice.draft',
			newState: 'invoice.deleted'
		});

		// Now finalize a fresh invoice, try to delete it → rejected.
		seedStoppedEntries(db, 1);
		const clients = db.prepare(`SELECT id FROM clients`).all() as { id: string }[];
		const inv2 = generateDraftInvoice(
			db,
			{ clientId: clients[1].id, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, inv2.id, CID);
		expect(() => deleteDraft(db, inv2.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'invoice_locked' });
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Coverage self-check
// ---------------------------------------------------------------------------

describe('coverage self-check', () => {
	test('every §3 rejection code fires', () => {
		const db = openDb(dbPath, 'db/migrations');

		// no_billable_entries
		const cEmpty = createClient(db, { name: 'Empty' }, CID);
		try {
			generateDraftInvoice(
				db,
				{ clientId: cEmpty.id, startDate: '2026-07-01', endDate: '2026-07-31' },
				CID
			);
		} catch {
			/* expected */
		}

		// Set up a real invoice for the remaining scenarios
		const { clientId } = seedStoppedEntries(db, 1);
		const inv = generateDraftInvoice(
			db,
			{ clientId, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);

		// invalid_discount_line (positive amount)
		try {
			addDiscountLine(db, { invoiceId: inv.id, description: 'X', amount: 100 }, CID);
		} catch {
			/* expected */
		}

		// invoice_non_positive_total
		addDiscountLine(db, { invoiceId: inv.id, description: 'Full', amount: -inv.subtotal }, CID);
		try {
			finalizeInvoice(db, inv.id, CID);
		} catch {
			/* expected */
		}
		removeDiscountLine(db, inv.id, CID);

		// must_finalize_before_export
		try {
			exportInvoice(db, inv.id, CID);
		} catch {
			/* expected */
		}

		// void_requires_finalized
		try {
			voidInvoice(db, inv.id, CID);
		} catch {
			/* expected */
		}

		// invoice_locked (finalize twice)
		finalizeInvoice(db, inv.id, CID);
		try {
			finalizeInvoice(db, inv.id, CID);
		} catch {
			/* expected */
		}

		const seen = new Set(
			transitionLines()
				.filter((l) => l.accepted === false)
				.map((r) => r.rejectionReason)
		);
		expect(seen.has('no_billable_entries')).toBe(true);
		expect(seen.has('invalid_discount_line')).toBe(true);
		expect(seen.has('invoice_non_positive_total')).toBe(true);
		expect(seen.has('must_finalize_before_export')).toBe(true);
		expect(seen.has('void_requires_finalized')).toBe(true);
		expect(seen.has('invoice_locked')).toBe(true);
		db.close();
	});
});
