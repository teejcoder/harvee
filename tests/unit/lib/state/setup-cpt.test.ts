// Table-driven tests for the Client / Project / Task state machines
// per .memory/state-transitions.md §1 and Step 2.1 in the plan.
//
// Every accepted transition and every rejection reason listed for §1 is
// covered. Each test also asserts the transition-log entry shape.

import type { Database } from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';
import {
	archiveClient,
	createClient,
	deleteClient,
	unarchiveClient
} from '../../../../src/lib/state/client';
import {
	archiveProject,
	createProject,
	deleteProject,
	unarchiveProject
} from '../../../../src/lib/state/project';
import { archiveTask, createTask, deleteTask, unarchiveTask } from '../../../../src/lib/state/task';
import { StateTransitionError } from '../../../../src/lib/state/_error';

const CID = '01HXZ8K3M9Q2R7VYABCDEF1234';

let tmpDir: string;
let dbPath: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-sm-'));
	dbPath = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

function transitionLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l))
		.filter((l: Record<string, unknown>) => Object.hasOwn(l, 'previousState'));
}

function seedTree(db: Database): { clientId: string; projectId: string; taskId: string } {
	const c = createClient(db, { name: 'Acme' }, CID);
	const p = createProject(db, { clientId: c.id, name: 'Proj', hourlyRate: 10000 }, CID);
	const t = createTask(db, { projectId: p.id, name: 'Task' }, CID);
	return { clientId: c.id, projectId: p.id, taskId: t.id };
}

// -----------------------------------------------------------------------------
// Accepted transitions
// -----------------------------------------------------------------------------

describe('accepted transitions — create → active', () => {
	test('client: `—` → `client.active`', () => {
		const db = openDb(dbPath, 'db/migrations');
		const client = createClient(db, { name: 'Acme' }, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			entityType: 'client',
			entityId: client.id,
			previousState: null,
			newState: 'client.active',
			trigger: 'user.createClient',
			accepted: true,
			rejectionReason: null
		});
		db.close();
	});

	test('project: `—` → `project.active`', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'Acme' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			entityType: 'project',
			entityId: p.id,
			previousState: null,
			newState: 'project.active',
			trigger: 'user.createProject',
			accepted: true
		});
		db.close();
	});

	test('task: `—` → `task.active`', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTree(db);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			entityType: 'task',
			entityId: taskId,
			previousState: null,
			newState: 'task.active',
			trigger: 'user.createTask',
			accepted: true
		});
		db.close();
	});
});

describe('accepted transitions — active ↔ archived', () => {
	test('client: active → archived → active', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'Acme' }, CID);
		archiveClient(db, c.id, CID);
		let t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'client.active',
			newState: 'client.archived',
			trigger: 'user.archiveClient',
			accepted: true
		});
		unarchiveClient(db, c.id, CID);
		t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'client.archived',
			newState: 'client.active',
			trigger: 'user.unarchiveClient',
			accepted: true
		});
		db.close();
	});

	test('project: active → archived → active (with no active children)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		archiveProject(db, p.id, CID);
		let t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'project.active',
			newState: 'project.archived',
			accepted: true
		});
		unarchiveProject(db, p.id, CID);
		t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'project.archived',
			newState: 'project.active',
			accepted: true
		});
		db.close();
	});

	test('task: active → archived → active (no running timer)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTree(db);
		archiveTask(db, taskId, CID);
		let t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'task.active',
			newState: 'task.archived',
			accepted: true
		});
		unarchiveTask(db, taskId, CID);
		t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'task.archived',
			newState: 'task.active',
			accepted: true
		});
		db.close();
	});
});

// -----------------------------------------------------------------------------
// Rejected transitions — every canonical rejection code from §1
// -----------------------------------------------------------------------------

describe('rejection: parent_archived (create under archived parent)', () => {
	test('project under archived client', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		archiveClient(db, c.id, CID);
		expect(() => createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID)).toThrow(
			StateTransitionError
		);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'project',
			trigger: 'user.createProject',
			accepted: false,
			rejectionReason: 'parent_archived'
		});
		db.close();
	});

	test('task under archived project', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		archiveProject(db, p.id, CID);
		expect(() => createTask(db, { projectId: p.id, name: 'T' }, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'task',
			trigger: 'user.createTask',
			accepted: false,
			rejectionReason: 'parent_archived'
		});
		db.close();
	});
});

describe('rejection: children_not_archived (archive with active children)', () => {
	test('client with an active project', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		expect(() => archiveClient(db, c.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'client',
			trigger: 'user.archiveClient',
			accepted: false,
			rejectionReason: 'children_not_archived'
		});
		db.close();
	});

	test('project with an active task', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		createTask(db, { projectId: p.id, name: 'T' }, CID);
		expect(() => archiveProject(db, p.id, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'project',
			trigger: 'user.archiveProject',
			accepted: false,
			rejectionReason: 'children_not_archived'
		});
		db.close();
	});
});

describe('rejection: task_has_running_timer (archive task while running)', () => {
	test('task with a running time_entry', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTree(db);

		// Insert a running entry directly (state machine for entries lands in 2.2).
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.running', 'now', 'now')`
		).run(taskId);

		expect(() => archiveTask(db, taskId, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'task',
			trigger: 'user.archiveTask',
			accepted: false,
			rejectionReason: 'task_has_running_timer'
		});
		db.close();
	});
});

describe('rejection: referenced_by_invoice (hard-delete when on non-draft invoice)', () => {
	function makeFinalizedLine(db: Database, taskId: string, clientId: string): void {
		db.prepare(
			`INSERT INTO invoices (
				id, client_id, state, start_date, end_date, invoice_number,
				payment_terms_days, currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at, created_at, updated_at
			) VALUES (
				'inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
				30, 'USD', 2, 'en-US',
				10000, 0, 10000, '2026-07-11T00:00:00.000Z', 'now', 'now'
			)`
		).run(clientId);
		db.prepare(
			`INSERT INTO invoice_line_items
			   (id, invoice_id, kind, task_id, description, hours, rate, amount, sort_order)
			 VALUES ('l1', 'inv1', 'task', ?, 'Work', 1.0, 10000, 10000, 0)`
		).run(taskId);
	}

	test('deleteClient rejected when a non-draft invoice references the client', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId, taskId } = seedTree(db);
		makeFinalizedLine(db, taskId, clientId);

		expect(() => deleteClient(db, clientId, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'client',
			trigger: 'user.deleteClient',
			accepted: false,
			rejectionReason: 'referenced_by_invoice'
		});
		db.close();
	});

	test('deleteProject rejected when a task under it appears on a non-draft invoice', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId, projectId, taskId } = seedTree(db);
		makeFinalizedLine(db, taskId, clientId);

		expect(() => deleteProject(db, projectId, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'project',
			trigger: 'user.deleteProject',
			accepted: false,
			rejectionReason: 'referenced_by_invoice'
		});
		db.close();
	});

	test('deleteTask rejected when task appears on a non-draft invoice', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { clientId, taskId } = seedTree(db);
		makeFinalizedLine(db, taskId, clientId);

		expect(() => deleteTask(db, taskId, CID)).toThrow(StateTransitionError);
		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'task',
			trigger: 'user.deleteTask',
			accepted: false,
			rejectionReason: 'referenced_by_invoice'
		});
		db.close();
	});
});

// -----------------------------------------------------------------------------
// Accepted delete — pseudo-terminal `.deleted` state per state-transitions.md §1
// -----------------------------------------------------------------------------

describe('accepted transitions — delete → *.deleted', () => {
	const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

	test('client: active → deleted (no invoice references)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		deleteClient(db, c.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			entityType: 'client',
			entityId: c.id,
			previousState: 'client.active',
			newState: 'client.deleted',
			trigger: 'user.deleteClient',
			accepted: true
		});
		// Row is actually gone.
		const row = db.prepare('SELECT id FROM clients WHERE id = ?').get(c.id);
		expect(row).toBeUndefined();
		db.close();
	});

	test('project: active → deleted (no invoice references)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		deleteProject(db, p.id, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'project.active',
			newState: 'project.deleted',
			trigger: 'user.deleteProject',
			accepted: true
		});
		db.close();
	});

	test('task: active → deleted (no invoice references)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedTree(db);
		deleteTask(db, taskId, CID);
		const t = transitionLines().at(-1)!;
		expect(t).toMatchObject({
			previousState: 'task.active',
			newState: 'task.deleted',
			trigger: 'user.deleteTask',
			accepted: true
		});
		db.close();
	});

	test('rejected create logs a real ULID as entityId, not empty string', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'A' }, CID);
		archiveClient(db, c.id, CID);
		expect(() => createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID)).toThrow(
			StateTransitionError
		);
		const rejected = transitionLines().at(-1)!;
		expect(rejected.entityId).toMatch(ULID_REGEX);
		db.close();
	});
});

// -----------------------------------------------------------------------------
// Coverage self-check: every rejection code from §1 appears in at least one
// rejected transition-log line across the suite.
// -----------------------------------------------------------------------------

describe('coverage self-check', () => {
	test('every §1 rejection code is exercised across the suite', () => {
		// This test runs against a fresh DB; it triggers each rejection once and
		// then asserts every canonical code appears in the resulting log.
		const db = openDb(dbPath, 'db/migrations');

		// parent_archived (create project under archived client)
		const c = createClient(db, { name: 'A' }, CID);
		archiveClient(db, c.id, CID);
		try {
			createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		} catch {
			/* expected */
		}
		unarchiveClient(db, c.id, CID);

		// children_not_archived (archive client with active project)
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 1 }, CID);
		try {
			archiveClient(db, c.id, CID);
		} catch {
			/* expected */
		}

		// task_has_running_timer
		const t = createTask(db, { projectId: p.id, name: 'T' }, CID);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.running', 'now', 'now')`
		).run(t.id);
		try {
			archiveTask(db, t.id, CID);
		} catch {
			/* expected */
		}

		// referenced_by_invoice
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
		).run(c.id);
		db.prepare(
			`INSERT INTO invoice_line_items
			   (id, invoice_id, kind, task_id, description, hours, rate, amount, sort_order)
			 VALUES ('l1', 'inv1', 'task', ?, 'Work', 1.0, 10000, 10000, 0)`
		).run(t.id);
		try {
			deleteClient(db, c.id, CID);
		} catch {
			/* expected */
		}

		const rejections = transitionLines().filter((l) => l.accepted === false);
		const seenCodes = new Set(rejections.map((r) => r.rejectionReason));
		expect(seenCodes.has('parent_archived')).toBe(true);
		expect(seenCodes.has('children_not_archived')).toBe(true);
		expect(seenCodes.has('task_has_running_timer')).toBe(true);
		expect(seenCodes.has('referenced_by_invoice')).toBe(true);

		db.close();
	});
});
