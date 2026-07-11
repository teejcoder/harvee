import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-te-'));
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

/** Seed a client/project/task/invoice chain so FK inserts can succeed. */
function seedFixtures(db: ReturnType<typeof openDb>): {
	taskId: string;
	invoiceId: string;
} {
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
	db.prepare(
		`INSERT INTO invoices (
			id, client_id, state, start_date, end_date,
			invoice_number, payment_terms_days,
			currency_code, currency_decimals, invoice_locale,
			subtotal, discount_total, total, finalized_at, created_at, updated_at
		) VALUES (
			'inv1', 'c1', 'invoice.finalized', '2026-07-01', '2026-07-31',
			'20260711-1', 30,
			'USD', 2, 'en-US',
			10000, 0, 10000, '2026-07-11T00:00:00.000Z', 'now', 'now'
		)`
	).run();
	return { taskId: 't1', invoiceId: 'inv1' };
}

describe('004_time_entries.sql — time_entries', () => {
	test('column shape matches domain-model.md §10', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'time_entries');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.task_id).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.notes).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.state).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.invoice_id).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.edit_form_snapshot).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.created_at).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.updated_at).toMatchObject({ type: 'TEXT', notnull: 1 });

		db.close();
	});

	test('FKs: task_id → tasks, invoice_id → invoices (both enforced)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const fks = db.prepare('PRAGMA foreign_key_list(time_entries)').all() as {
			table: string;
			from: string;
			to: string;
		}[];
		const asMap = new Map(fks.map((r) => [r.from, r]));

		expect(asMap.get('task_id')).toMatchObject({ table: 'tasks', to: 'id' });
		expect(asMap.get('invoice_id')).toMatchObject({ table: 'invoices', to: 'id' });

		db.close();
	});

	test.each(['entry.draft', 'entry.running', 'entry.stopped', 'entry.editing', 'entry.discarded'])(
		'accepts state = %s (with NULL invoice_id)',
		(state) => {
			const db = openDb(dbPath, 'db/migrations');
			const { taskId } = seedFixtures(db);

			expect(() =>
				db
					.prepare(
						`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
					 VALUES ('e1', ?, ?, 'now', 'now')`
					)
					.run(taskId, state)
			).not.toThrow();

			db.close();
		}
	);

	test('accepts state = entry.locked when invoice_id is NOT NULL', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId, invoiceId } = seedFixtures(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entries (id, task_id, state, invoice_id, created_at, updated_at)
					 VALUES ('e1', ?, 'entry.locked', ?, 'now', 'now')`
				)
				.run(taskId, invoiceId)
		).not.toThrow();

		db.close();
	});

	test('rejects invalid state values', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
					 VALUES ('e1', ?, 'entry.nonsense', 'now', 'now')`
				)
				.run(taskId)
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects entry.locked WITHOUT an invoice_id (CHECK constraint)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
					 VALUES ('e1', ?, 'entry.locked', 'now', 'now')`
				)
				.run(taskId)
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects non-locked state WITH an invoice_id (CHECK constraint)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId, invoiceId } = seedFixtures(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entries (id, task_id, state, invoice_id, created_at, updated_at)
					 VALUES ('e1', ?, 'entry.stopped', ?, 'now', 'now')`
				)
				.run(taskId, invoiceId)
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('rejects an orphan invoice_id (FK enforced now that invoices exists)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entries (id, task_id, state, invoice_id, created_at, updated_at)
					 VALUES ('e1', ?, 'entry.locked', 'no-such-invoice', 'now', 'now')`
				)
				.run(taskId)
		).toThrow(/FOREIGN KEY constraint failed/i);

		db.close();
	});
});

describe('004_time_entries.sql — time_entry_segments', () => {
	test('column shape matches domain-model.md §10', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'time_entry_segments');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.entry_id).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.started_at).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.stopped_at).toMatchObject({ type: 'TEXT', notnull: 0 });

		db.close();
	});

	test('FK to time_entries', () => {
		const db = openDb(dbPath, 'db/migrations');
		const fks = db.prepare('PRAGMA foreign_key_list(time_entry_segments)').all() as {
			table: string;
			from: string;
			to: string;
		}[];
		expect(fks).toHaveLength(1);
		expect(fks[0]).toMatchObject({ table: 'time_entries', from: 'entry_id', to: 'id' });

		db.close();
	});

	test('rejects a segment where stopped_at < started_at', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.stopped', 'now', 'now')`
		).run(taskId);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
					 VALUES ('s1', 'e1', '2026-07-11T10:00:00.000Z', '2026-07-11T09:00:00.000Z')`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		db.close();
	});

	test('accepts stopped_at = started_at (zero-duration segment)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.stopped', 'now', 'now')`
		).run(taskId);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
					 VALUES ('s1', 'e1', '2026-07-11T10:00:00.000Z', '2026-07-11T10:00:00.000Z')`
				)
				.run()
		).not.toThrow();

		db.close();
	});

	test('accepts stopped_at IS NULL (open segment)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.running', 'now', 'now')`
		).run(taskId);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
					 VALUES ('s1', 'e1', '2026-07-11T10:00:00.000Z', NULL)`
				)
				.run()
		).not.toThrow();

		db.close();
	});

	test('rejects a SECOND open segment on the same entry (partial UNIQUE INDEX)', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.running', 'now', 'now')`
		).run(taskId);
		db.prepare(
			`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
			 VALUES ('s1', 'e1', '2026-07-11T10:00:00.000Z', NULL)`
		).run();

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
					 VALUES ('s2', 'e1', '2026-07-11T11:00:00.000Z', NULL)`
				)
				.run()
		).toThrow(/UNIQUE constraint failed/i);

		db.close();
	});

	test('allows multiple CLOSED segments on the same entry', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES ('e1', ?, 'entry.stopped', 'now', 'now')`
		).run(taskId);

		db.prepare(
			`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
			 VALUES
			   ('s1', 'e1', '2026-07-11T10:00:00.000Z', '2026-07-11T10:30:00.000Z'),
			   ('s2', 'e1', '2026-07-11T11:00:00.000Z', '2026-07-11T11:30:00.000Z')`
		).run();

		const count = db
			.prepare('SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ?')
			.get('e1') as { n: number };
		expect(count.n).toBe(2);

		db.close();
	});

	test('allows an open segment on each of two different entries', () => {
		const db = openDb(dbPath, 'db/migrations');
		const { taskId } = seedFixtures(db);
		db.prepare(
			`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
			 VALUES
			   ('e1', ?, 'entry.running', 'now', 'now'),
			   ('e2', ?, 'entry.running', 'now', 'now')`
		).run(taskId, taskId);

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
					 VALUES
					   ('s1', 'e1', '2026-07-11T10:00:00.000Z', NULL),
					   ('s2', 'e2', '2026-07-11T10:00:00.000Z', NULL)`
				)
				.run()
		).not.toThrow();

		db.close();
	});

	test('rejects an orphan entry_id (FK enforcement)', () => {
		const db = openDb(dbPath, 'db/migrations');

		expect(() =>
			db
				.prepare(
					`INSERT INTO time_entry_segments (id, entry_id, started_at)
					 VALUES ('s1', 'no-such-entry', '2026-07-11T10:00:00.000Z')`
				)
				.run()
		).toThrow(/FOREIGN KEY constraint failed/i);

		db.close();
	});
});
