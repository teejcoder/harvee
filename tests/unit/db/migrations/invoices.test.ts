import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-inv-'));
	dbPath = join(tmpDir, 'data.sqlite');
	process.env.LOG_PATH = join(tmpDir, 'log.jsonl');
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

type ColumnRow = { name: string; type: string; notnull: number; pk: number };

function columns(db: ReturnType<typeof openDb>, table: string): Record<string, ColumnRow> {
	const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnRow[];
	return Object.fromEntries(rows.map((r) => [r.name, r]));
}

/** Seed a client + task so we can insert draft invoices and line items. */
function seedClientAndTask(db: ReturnType<typeof openDb>): { clientId: string; taskId: string } {
	db.prepare(
		`INSERT INTO clients (id, name, created_at, updated_at)
		 VALUES ('c1', 'Acme', 'now', 'now')`
	).run();
	db.prepare(
		`INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
		 VALUES ('p1', 'c1', 'Proj', 10000, 'now', 'now')`
	).run();
	db.prepare(
		`INSERT INTO tasks (id, project_id, name, created_at, updated_at)
		 VALUES ('t1', 'p1', 'Task', 'now', 'now')`
	).run();
	return { clientId: 'c1', taskId: 't1' };
}

const DRAFT_COLS = `
  id, client_id, state, start_date, end_date,
  payment_terms_days, currency_code, currency_decimals, invoice_locale,
  subtotal, discount_total, total, created_at, updated_at
`;
const DRAFT_VALS = `
  ?, 'c1', 'invoice.draft', '2026-07-01', '2026-07-31',
  30, 'USD', 2, 'en-US',
  10000, 0, 10000, 'now', 'now'
`;

describe('003_invoices.sql — invoices', () => {
	test('column shape matches domain-model.md §10', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'invoices');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.client_id).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.state).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.start_date).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.end_date).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.invoice_number).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.payment_terms_days).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.currency_code).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.currency_decimals).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.invoice_locale).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.subtotal).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.discount_total).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.total).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.finalized_at).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.voided_at).toMatchObject({ type: 'TEXT', notnull: 0 });

		db.close();
	});

	test('FK to clients', () => {
		const db = openDb(dbPath, 'db/migrations');
		const fks = db.prepare('PRAGMA foreign_key_list(invoices)').all() as {
			table: string;
			from: string;
			to: string;
		}[];
		expect(fks).toHaveLength(1);
		expect(fks[0]).toMatchObject({ table: 'clients', from: 'client_id', to: 'id' });
		db.close();
	});

	test('invoice_number is UNIQUE (multiple NULLs allowed, one value at most)', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		// Two drafts (both invoice_number NULL) — allowed.
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i2');

		const insertFinalized = db.prepare(`
			INSERT INTO invoices (
				id, client_id, state, start_date, end_date,
				invoice_number, payment_terms_days,
				currency_code, currency_decimals, invoice_locale,
				subtotal, discount_total, total, finalized_at,
				created_at, updated_at
			) VALUES (
				?, 'c1', 'invoice.finalized', '2026-07-01', '2026-07-31',
				?, 30, 'USD', 2, 'en-US',
				10000, 0, 10000, '2026-07-11T00:00:00.000Z',
				'now', 'now'
			)
		`);
		insertFinalized.run('i3', '20260711-1');
		expect(() => insertFinalized.run('i4', '20260711-1')).toThrow(/UNIQUE constraint failed/i);

		db.close();
	});

	test('rejects end_date < start_date', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoices (
					id, client_id, state, start_date, end_date,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, created_at, updated_at
				) VALUES (
					'i1', 'c1', 'invoice.draft', '2026-07-31', '2026-07-01',
					30, 'USD', 2, 'en-US',
					10000, 0, 10000, 'now', 'now'
				)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects total != subtotal + discount_total', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoices (
					id, client_id, state, start_date, end_date,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, created_at, updated_at
				) VALUES (
					'i1', 'c1', 'invoice.draft', '2026-07-01', '2026-07-31',
					30, 'USD', 2, 'en-US',
					10000, -500, 9600, 'now', 'now'
				)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects a positive discount_total', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoices (
					id, client_id, state, start_date, end_date,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, created_at, updated_at
				) VALUES (
					'i1', 'c1', 'invoice.draft', '2026-07-01', '2026-07-31',
					30, 'USD', 2, 'en-US',
					10000, 500, 10500, 'now', 'now'
				)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('draft state requires invoice_number and finalized_at both NULL', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		// draft with invoice_number set → CHECK failure.
		expect(() =>
			db
				.prepare(
					`INSERT INTO invoices (
					id, client_id, state, start_date, end_date, invoice_number,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, created_at, updated_at
				) VALUES (
					'i1', 'c1', 'invoice.draft', '2026-07-01', '2026-07-31', '20260711-1',
					30, 'USD', 2, 'en-US',
					10000, 0, 10000, 'now', 'now'
				)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('finalized state requires invoice_number and finalized_at NOT NULL', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		// finalized with NULL invoice_number → CHECK failure.
		expect(() =>
			db
				.prepare(
					`INSERT INTO invoices (
					id, client_id, state, start_date, end_date,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, finalized_at, created_at, updated_at
				) VALUES (
					'i1', 'c1', 'invoice.finalized', '2026-07-01', '2026-07-31',
					30, 'USD', 2, 'en-US',
					10000, 0, 10000, '2026-07-11T00:00:00.000Z', 'now', 'now'
				)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('voided state requires voided_at NOT NULL', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoices (
					id, client_id, state, start_date, end_date, invoice_number,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, finalized_at, created_at, updated_at
				) VALUES (
					'i1', 'c1', 'invoice.voided', '2026-07-01', '2026-07-31', '20260711-1',
					30, 'USD', 2, 'en-US',
					10000, 0, 10000, '2026-07-11T00:00:00.000Z', 'now', 'now'
				)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});
});

describe('003_invoices.sql — invoice_line_items', () => {
	test('column shape', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'invoice_line_items');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.invoice_id).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.kind).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.task_id).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.description).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.hours).toMatchObject({ type: 'REAL', notnull: 0 });
		expect(cols.rate).toMatchObject({ type: 'INTEGER', notnull: 0 });
		expect(cols.amount).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.sort_order).toMatchObject({ type: 'INTEGER', notnull: 1 });

		db.close();
	});

	test('FKs to invoices (CASCADE) and tasks (NO ACTION)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const fks = db.prepare('PRAGMA foreign_key_list(invoice_line_items)').all() as {
			table: string;
			from: string;
			to: string;
			on_delete: string;
		}[];
		const asMap = new Map(fks.map((r) => [r.from, r]));

		expect(asMap.get('invoice_id')).toMatchObject({
			table: 'invoices',
			to: 'id',
			on_delete: 'CASCADE'
		});
		expect(asMap.get('task_id')).toMatchObject({
			table: 'tasks',
			to: 'id',
			on_delete: 'NO ACTION'
		});

		db.close();
	});

	test('accepts a valid task line', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, task_id, description, hours, rate, amount, sort_order)
					 VALUES ('l1', 'i1', 'task', 't1', 'Work', 1.0, 10000, 10000, 0)`
				)
				.run()
		).not.toThrow();

		db.close();
	});

	test('rejects a task line without a task_id / hours / rate', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, description, hours, rate, amount, sort_order)
					 VALUES ('l1', 'i1', 'task', 'X', 1.0, 10000, 10000, 0)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects a task line with non-positive hours or amount', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, task_id, description, hours, rate, amount, sort_order)
					 VALUES ('l1', 'i1', 'task', 't1', 'X', 0, 10000, 0, 0)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('accepts a valid discount line', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, description, amount, sort_order)
					 VALUES ('l1', 'i1', 'discount', 'Early-pay discount', -500, 1)`
				)
				.run()
		).not.toThrow();

		db.close();
	});

	test('rejects a discount line with a non-negative amount', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, description, amount, sort_order)
					 VALUES ('l1', 'i1', 'discount', 'Bad discount', 500, 1)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects a discount line that carries a task_id, hours, or rate', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, task_id, description, amount, sort_order)
					 VALUES ('l1', 'i1', 'discount', 't1', 'X', -500, 1)`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('at most one discount line per invoice (partial UNIQUE INDEX)', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');

		db.prepare(
			`INSERT INTO invoice_line_items
			 (id, invoice_id, kind, description, amount, sort_order)
			 VALUES ('l1', 'i1', 'discount', 'D1', -500, 1)`
		).run();

		expect(() =>
			db
				.prepare(
					`INSERT INTO invoice_line_items
					 (id, invoice_id, kind, description, amount, sort_order)
					 VALUES ('l2', 'i1', 'discount', 'D2', -300, 2)`
				)
				.run()
		).toThrow(/UNIQUE constraint failed/i);

		db.close();
	});

	test('deleting a draft invoice cascades its line items', () => {
		const db = openDb(dbPath, 'db/migrations');
		seedClientAndTask(db);
		db.prepare(`INSERT INTO invoices (${DRAFT_COLS}) VALUES (${DRAFT_VALS})`).run('i1');
		db.prepare(
			`INSERT INTO invoice_line_items
			 (id, invoice_id, kind, task_id, description, hours, rate, amount, sort_order)
			 VALUES ('l1', 'i1', 'task', 't1', 'Work', 1.0, 10000, 10000, 0)`
		).run();

		db.prepare(`DELETE FROM invoices WHERE id = 'i1'`).run();

		const remaining = db
			.prepare('SELECT COUNT(*) AS n FROM invoice_line_items WHERE invoice_id = ?')
			.get('i1') as { n: number };
		expect(remaining.n).toBe(0);

		db.close();
	});
});
