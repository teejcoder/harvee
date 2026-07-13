// Table-driven tests for the time-entry state machine per
// .memory/state-transitions.md §2 and Step 2.2 in the plan.

import type { Database } from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';
import { createClient } from '../../../../src/lib/state/client';
import { createProject } from '../../../../src/lib/state/project';
import { archiveTask, createTask } from '../../../../src/lib/state/task';
import {
	addManualEntry,
	cancelEdit,
	discardEntry,
	lockEntry,
	openEdit,
	pickTask,
	resumeEntry,
	saveEdit,
	startTimer,
	stopTimer,
	unlockToDiscarded,
	updateSegment
} from '../../../../src/lib/state/entry';
import { StateTransitionError } from '../../../../src/lib/state/_error';

const CID = '01HXZ8K3M9Q2R7VYABCDEF1234';

let tmpDir: string;
let dbPath: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-e-'));
	dbPath = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
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

function seedTask(db: Database): { taskId: string } {
	const c = createClient(db, { name: 'A' }, CID);
	const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
	const t = createTask(db, { projectId: p.id, name: 'T' }, CID);
	return { taskId: t.id };
}

describe('addManualEntry — back-fill a completed block', () => {
	test('creates a stopped entry with one segment; logs — → entry.stopped', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = addManualEntry(
			db,
			{ taskId, startedAt: '2026-07-10T09:00:00.000Z', stoppedAt: '2026-07-10T11:00:00.000Z' },
			CID
		);
		const row = db.prepare(`SELECT state FROM time_entries WHERE id = ?`).get(e.id) as {
			state: string;
		};
		expect(row.state).toBe('entry.stopped');
		const seg = db
			.prepare(`SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ?`)
			.get(e.id) as { n: number };
		expect(seg.n).toBe(1);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: null,
			newState: 'entry.stopped',
			trigger: 'user.addManualEntry',
			accepted: true
		});
		db.close();
	});

	test('rejects stopped <= started with invalid_time_range', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		expect(() =>
			addManualEntry(
				db,
				{ taskId, startedAt: '2026-07-10T11:00:00.000Z', stoppedAt: '2026-07-10T10:00:00.000Z' },
				CID
			)
		).toThrow(StateTransitionError);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({ accepted: false, rejectionReason: 'invalid_time_range' });
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Accepted transitions
// ---------------------------------------------------------------------------

describe('accepted transitions — happy path', () => {
	test('pickTask: `—` → entry.draft', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			entityType: 'timeEntry',
			entityId: e.id,
			previousState: null,
			newState: 'entry.draft',
			trigger: 'user.pickTask',
			accepted: true
		});
		db.close();
	});

	test('startTimer: entry.draft → entry.running (opens first segment)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'entry.draft',
			newState: 'entry.running',
			accepted: true
		});
		const segs = db
			.prepare('SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ?')
			.get(e.id) as { n: number };
		expect(segs.n).toBe(1);
		db.close();
	});

	test('stopTimer: entry.running → entry.stopped (closes segment)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'entry.running',
			newState: 'entry.stopped',
			accepted: true
		});
		const open = db
			.prepare(
				`SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ? AND stopped_at IS NULL`
			)
			.get(e.id) as { n: number };
		expect(open.n).toBe(0);
		db.close();
	});

	test('Start → Stop → Resume → Stop yields one entry with 2 segments', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);
		resumeEntry(db, e.id, CID);
		stopTimer(db, e.id, CID);
		const segCount = db
			.prepare('SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ?')
			.get(e.id) as { n: number };
		expect(segCount.n).toBe(2);
		const lastResume = transitionLines()
			.reverse()
			.find((l) => l.trigger === 'user.resumeEntry');
		expect(lastResume).toBeDefined();
		expect(lastResume).toMatchObject({
			previousState: 'entry.stopped',
			newState: 'entry.running',
			accepted: true
		});
		db.close();
	});

	test('openEdit → cancelEdit reverts segments; openEdit → saveEdit persists', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);

		openEdit(db, e.id, CID);
		const seg = db.prepare('SELECT id FROM time_entry_segments WHERE entry_id = ?').get(e.id) as {
			id: string;
		};

		// mutate the segment
		updateSegment(
			db,
			{
				segmentId: seg.id,
				startedAt: '2026-07-11T10:00:00.000Z',
				stoppedAt: '2026-07-11T12:00:00.000Z'
			},
			CID
		);

		cancelEdit(db, e.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'entry.editing',
			newState: 'entry.stopped',
			trigger: 'user.cancelEdit',
			accepted: true
		});
		// cancel restored — the mutated startedAt should be gone
		const after = db
			.prepare('SELECT started_at AS startedAt FROM time_entry_segments WHERE id = ?')
			.get(seg.id) as { startedAt: string };
		expect(after.startedAt).not.toBe('2026-07-11T10:00:00.000Z');

		// save round-trip
		openEdit(db, e.id, CID);
		updateSegment(
			db,
			{
				segmentId: seg.id,
				startedAt: '2026-07-11T10:00:00.000Z',
				stoppedAt: '2026-07-11T12:00:00.000Z'
			},
			CID
		);
		saveEdit(db, e.id, CID);
		const after2 = db
			.prepare('SELECT started_at AS startedAt FROM time_entry_segments WHERE id = ?')
			.get(seg.id) as { startedAt: string };
		expect(after2.startedAt).toBe('2026-07-11T10:00:00.000Z');
		db.close();
	});

	test('discardEntry from draft: entry.draft → entry.discarded', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		discardEntry(db, e.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'entry.draft',
			newState: 'entry.discarded',
			accepted: true
		});
		db.close();
	});
});

describe('accepted system transitions — lock / unlock', () => {
	test('lockEntry: entry.stopped → entry.locked (system.invoiceFinalize)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);

		// seed a finalized invoice to reference
		const clientId = db
			.prepare(
				'SELECT client_id AS clientId FROM projects WHERE id = (SELECT project_id FROM tasks WHERE id = ?)'
			)
			.get(taskId) as { clientId: string };
		db.prepare(
			`INSERT INTO invoices (
				id, client_id, state, start_date, end_date, invoice_number,
				payment_terms_days, currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at, created_at, updated_at
			) VALUES (
				'inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
				30, 'USD', 2, 'en-US', 10000, 0, 10000,
				'2026-07-11T00:00:00.000Z', 'now', 'now'
			)`
		).run(clientId.clientId);

		lockEntry(db, { entryId: e.id, invoiceId: 'inv1' }, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'entry.stopped',
			newState: 'entry.locked',
			trigger: 'system.invoiceFinalize',
			accepted: true,
			actor: { type: 'system', id: 'system.invoiceFinalize' }
		});
		db.close();
	});

	test('unlockToDiscarded: entry.locked → entry.discarded (system.invoiceVoid)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);

		const clientId = db
			.prepare(
				'SELECT client_id AS clientId FROM projects WHERE id = (SELECT project_id FROM tasks WHERE id = ?)'
			)
			.get(taskId) as { clientId: string };
		db.prepare(
			`INSERT INTO invoices (
				id, client_id, state, start_date, end_date, invoice_number,
				payment_terms_days, currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at, created_at, updated_at
			) VALUES (
				'inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
				30, 'USD', 2, 'en-US', 10000, 0, 10000,
				'2026-07-11T00:00:00.000Z', 'now', 'now'
			)`
		).run(clientId.clientId);

		lockEntry(db, { entryId: e.id, invoiceId: 'inv1' }, CID);
		unlockToDiscarded(db, e.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'entry.locked',
			newState: 'entry.discarded',
			trigger: 'system.invoiceVoid',
			accepted: true,
			actor: { type: 'system', id: 'system.invoiceVoid' }
		});
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Rejections — every §2 rejection code
// ---------------------------------------------------------------------------

describe('rejection: concurrent_timer_forbidden', () => {
	test('starting a second entry while another is running', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e1 = pickTask(db, { taskId }, CID);
		startTimer(db, e1.id, CID);
		const e2 = pickTask(db, { taskId }, CID);
		expect(() => startTimer(db, e2.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'concurrent_timer_forbidden'
		});
		db.close();
	});
});

describe('rejection: task_archived', () => {
	test('pickTask against an archived task', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		archiveTask(db, taskId, CID);
		expect(() => pickTask(db, { taskId }, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'timeEntry',
			trigger: 'user.pickTask',
			accepted: false,
			rejectionReason: 'task_archived'
		});
		db.close();
	});
});

describe('rejection: entry_locked_by_invoice', () => {
	test('discarding a locked entry', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);

		const clientId = db
			.prepare(
				'SELECT client_id AS clientId FROM projects WHERE id = (SELECT project_id FROM tasks WHERE id = ?)'
			)
			.get(taskId) as { clientId: string };
		db.prepare(
			`INSERT INTO invoices (
				id, client_id, state, start_date, end_date, invoice_number,
				payment_terms_days, currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at, created_at, updated_at
			) VALUES (
				'inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
				30, 'USD', 2, 'en-US', 10000, 0, 10000,
				'2026-07-11T00:00:00.000Z', 'now', 'now'
			)`
		).run(clientId.clientId);
		lockEntry(db, { entryId: e.id, invoiceId: 'inv1' }, CID);

		expect(() => discardEntry(db, e.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'entry_locked_by_invoice'
		});
		db.close();
	});

	test('openEdit on a locked entry', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);

		const clientId = db
			.prepare(
				'SELECT client_id AS clientId FROM projects WHERE id = (SELECT project_id FROM tasks WHERE id = ?)'
			)
			.get(taskId) as { clientId: string };
		db.prepare(
			`INSERT INTO invoices (
				id, client_id, state, start_date, end_date, invoice_number,
				payment_terms_days, currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at, created_at, updated_at
			) VALUES (
				'inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
				30, 'USD', 2, 'en-US', 10000, 0, 10000,
				'2026-07-11T00:00:00.000Z', 'now', 'now'
			)`
		).run(clientId.clientId);
		lockEntry(db, { entryId: e.id, invoiceId: 'inv1' }, CID);

		expect(() => openEdit(db, e.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({ accepted: false, rejectionReason: 'entry_locked_by_invoice' });
		db.close();
	});
});

describe('rejection: cannot_edit_running_entry', () => {
	test('openEdit while running', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		expect(() => openEdit(db, e.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'cannot_edit_running_entry'
		});
		db.close();
	});
});

describe('rejection: invalid_time_range (segment)', () => {
	test('updateSegment with stoppedAt < startedAt', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);
		const seg = db.prepare('SELECT id FROM time_entry_segments WHERE entry_id = ?').get(e.id) as {
			id: string;
		};
		openEdit(db, e.id, CID);
		expect(() =>
			updateSegment(
				db,
				{
					segmentId: seg.id,
					startedAt: '2026-07-11T12:00:00.000Z',
					stoppedAt: '2026-07-11T10:00:00.000Z'
				},
				CID
			)
		).toThrow(StateTransitionError);
		const warn = allLines().find(
			(l) => l.event === 'segment.update.rejected' && l.rejectionReason === 'invalid_time_range'
		);
		expect(warn).toBeDefined();
		db.close();
	});
});

describe('rejection: segment_overlap', () => {
	test('updateSegment producing an overlap with a sibling segment', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);
		const e = pickTask(db, { taskId }, CID);
		startTimer(db, e.id, CID);
		stopTimer(db, e.id, CID);
		resumeEntry(db, e.id, CID);
		stopTimer(db, e.id, CID);
		openEdit(db, e.id, CID);

		const segs = db
			.prepare(
				'SELECT id, started_at AS startedAt, stopped_at AS stoppedAt FROM time_entry_segments WHERE entry_id = ? ORDER BY started_at'
			)
			.all(e.id) as { id: string; startedAt: string; stoppedAt: string }[];
		// Try to move segment 2 so it starts inside segment 1's window.
		expect(() =>
			updateSegment(
				db,
				{
					segmentId: segs[1].id,
					startedAt: segs[0].startedAt,
					stoppedAt: segs[1].stoppedAt
				},
				CID
			)
		).toThrow(StateTransitionError);
		const warn = allLines().find(
			(l) => l.event === 'segment.update.rejected' && l.rejectionReason === 'segment_overlap'
		);
		expect(warn).toBeDefined();
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Coverage self-check
// ---------------------------------------------------------------------------

describe('coverage self-check', () => {
	test('every §2 rejection code is exercised', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTask(db);

		// concurrent_timer_forbidden
		const e1 = pickTask(db, { taskId }, CID);
		startTimer(db, e1.id, CID);
		const e2 = pickTask(db, { taskId }, CID);
		try {
			startTimer(db, e2.id, CID);
		} catch {
			/* expected */
		}
		stopTimer(db, e1.id, CID);

		// task_archived
		const { taskId: t2 } = seedTask(db);
		archiveTask(db, t2, CID);
		try {
			pickTask(db, { taskId: t2 }, CID);
		} catch {
			/* expected */
		}

		// cannot_edit_running_entry
		startTimer(db, e1.id, CID);
		try {
			openEdit(db, e1.id, CID);
		} catch {
			/* expected */
		}
		stopTimer(db, e1.id, CID);

		// entry_locked_by_invoice
		const clientId = db
			.prepare(
				'SELECT client_id AS clientId FROM projects WHERE id = (SELECT project_id FROM tasks WHERE id = ?)'
			)
			.get(taskId) as { clientId: string };
		db.prepare(
			`INSERT INTO invoices (
				id, client_id, state, start_date, end_date, invoice_number,
				payment_terms_days, currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at, created_at, updated_at
			) VALUES (
				'inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
				30, 'USD', 2, 'en-US', 10000, 0, 10000,
				'2026-07-11T00:00:00.000Z', 'now', 'now'
			)`
		).run(clientId.clientId);
		lockEntry(db, { entryId: e1.id, invoiceId: 'inv1' }, CID);
		try {
			discardEntry(db, e1.id, CID);
		} catch {
			/* expected */
		}

		// invalid_time_range + segment_overlap — set up a stopped entry with 2 segments
		const e3 = pickTask(db, { taskId }, CID);
		startTimer(db, e3.id, CID);
		stopTimer(db, e3.id, CID);
		resumeEntry(db, e3.id, CID);
		stopTimer(db, e3.id, CID);
		openEdit(db, e3.id, CID);

		const segs = db
			.prepare(
				'SELECT id, started_at AS startedAt, stopped_at AS stoppedAt FROM time_entry_segments WHERE entry_id = ? ORDER BY started_at'
			)
			.all(e3.id) as { id: string; startedAt: string; stoppedAt: string }[];
		try {
			updateSegment(
				db,
				{
					segmentId: segs[0].id,
					startedAt: '2026-07-11T20:00:00.000Z',
					stoppedAt: '2026-07-11T10:00:00.000Z'
				},
				CID
			);
		} catch {
			/* expected */
		}
		try {
			updateSegment(
				db,
				{ segmentId: segs[1].id, startedAt: segs[0].startedAt, stoppedAt: segs[1].stoppedAt },
				CID
			);
		} catch {
			/* expected */
		}

		const rejected = transitionLines().filter((l) => l.accepted === false);
		const segRejected = allLines().filter((l) => l.event === 'segment.update.rejected');
		const seen = new Set([
			...rejected.map((r) => r.rejectionReason),
			...segRejected.map((r) => r.rejectionReason)
		]);
		expect(seen.has('concurrent_timer_forbidden')).toBe(true);
		expect(seen.has('task_archived')).toBe(true);
		expect(seen.has('cannot_edit_running_entry')).toBe(true);
		expect(seen.has('entry_locked_by_invoice')).toBe(true);
		expect(seen.has('invalid_time_range')).toBe(true);
		expect(seen.has('segment_overlap')).toBe(true);
		db.close();
	});
});
