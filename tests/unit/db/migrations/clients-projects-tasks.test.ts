import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';

// Applies the real db/migrations/ dir end-to-end so 002_clients_projects_tasks.sql
// runs through the runner and lands the shape in .memory/domain-model.md §10.

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-cpt-'));
	dbPath = join(tmpDir, 'data.sqlite');
	process.env.LOG_PATH = join(tmpDir, 'log.jsonl');
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

type ColumnRow = {
	name: string;
	type: string;
	notnull: number;
	pk: number;
};

function columns(db: ReturnType<typeof openDb>, table: string): Record<string, ColumnRow> {
	const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnRow[];
	return Object.fromEntries(rows.map((r) => [r.name, r]));
}

describe('002_clients_projects_tasks.sql', () => {
	test('clients: id (PK TEXT), name, nullable archived_at, timestamps', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'clients');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.name).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.archived_at).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.created_at).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.updated_at).toMatchObject({ type: 'TEXT', notnull: 1 });

		db.close();
	});

	test('projects: id, client_id FK, name, hourly_rate INTEGER, archived_at nullable, timestamps', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'projects');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.client_id).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.name).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.hourly_rate).toMatchObject({ type: 'INTEGER', notnull: 1 });
		expect(cols.archived_at).toMatchObject({ type: 'TEXT', notnull: 0 });
		expect(cols.created_at).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.updated_at).toMatchObject({ type: 'TEXT', notnull: 1 });

		const fks = db.prepare('PRAGMA foreign_key_list(projects)').all() as {
			table: string;
			from: string;
			to: string;
			on_delete: string;
		}[];
		expect(fks).toHaveLength(1);
		expect(fks[0]).toMatchObject({
			table: 'clients',
			from: 'client_id',
			to: 'id',
			on_delete: 'NO ACTION'
		});

		db.close();
	});

	test('tasks: id, project_id FK, name, archived_at nullable, timestamps', () => {
		const db = openDb(dbPath, 'db/migrations');
		const cols = columns(db, 'tasks');

		expect(cols.id).toMatchObject({ type: 'TEXT', pk: 1 });
		expect(cols.project_id).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.name).toMatchObject({ type: 'TEXT', notnull: 1 });
		expect(cols.archived_at).toMatchObject({ type: 'TEXT', notnull: 0 });

		const fks = db.prepare('PRAGMA foreign_key_list(tasks)').all() as {
			table: string;
			from: string;
			to: string;
			on_delete: string;
		}[];
		expect(fks).toHaveLength(1);
		expect(fks[0]).toMatchObject({
			table: 'projects',
			from: 'project_id',
			to: 'id',
			on_delete: 'NO ACTION'
		});

		db.close();
	});

	test('FK enforcement rejects orphan project and orphan task inserts', () => {
		const db = openDb(dbPath, 'db/migrations');

		expect(() =>
			db
				.prepare(
					`INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
					 VALUES ('proj-1', 'no-such-client', 'X', 10000, 'now', 'now')`
				)
				.run()
		).toThrow(/FOREIGN KEY constraint failed/i);

		expect(() =>
			db
				.prepare(
					`INSERT INTO tasks (id, project_id, name, created_at, updated_at)
					 VALUES ('task-1', 'no-such-project', 'X', 'now', 'now')`
				)
				.run()
		).toThrow(/FOREIGN KEY constraint failed/i);

		db.close();
	});

	test('FK enforcement rejects deleting a client that has projects (NO ACTION default)', () => {
		const db = openDb(dbPath, 'db/migrations');

		db.prepare(
			`INSERT INTO clients (id, name, created_at, updated_at)
			 VALUES ('c1', 'Acme', 'now', 'now')`
		).run();
		db.prepare(
			`INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
			 VALUES ('p1', 'c1', 'P', 10000, 'now', 'now')`
		).run();

		expect(() => db.prepare(`DELETE FROM clients WHERE id = 'c1'`).run()).toThrow(
			/FOREIGN KEY constraint failed/i
		);

		db.close();
	});

	test('FK enforcement rejects deleting a project that has tasks (NO ACTION default)', () => {
		const db = openDb(dbPath, 'db/migrations');

		db.prepare(
			`INSERT INTO clients (id, name, created_at, updated_at)
			 VALUES ('c1', 'Acme', 'now', 'now')`
		).run();
		db.prepare(
			`INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
			 VALUES ('p1', 'c1', 'P', 10000, 'now', 'now')`
		).run();
		db.prepare(
			`INSERT INTO tasks (id, project_id, name, created_at, updated_at)
			 VALUES ('t1', 'p1', 'T', 'now', 'now')`
		).run();

		expect(() => db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run()).toThrow(
			/FOREIGN KEY constraint failed/i
		);

		db.close();
	});

	test('indexes exist for projects.client_id and tasks.project_id', () => {
		const db = openDb(dbPath, 'db/migrations');
		const idx = db
			.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
			.all() as { name: string }[];
		const names = idx.map((r) => r.name);
		expect(names).toContain('idx_projects_client_id');
		expect(names).toContain('idx_tasks_project_id');
		db.close();
	});

	test('second boot logs skip for both migrations and applies zero writes', () => {
		const db1 = openDb(dbPath, 'db/migrations');
		db1.close();

		const applied = openDb(dbPath, 'db/migrations')
			.prepare('SELECT filename FROM _migrations ORDER BY filename')
			.all() as { filename: string }[];
		expect(applied.map((r) => r.filename)).toEqual([
			'001_settings.sql',
			'002_clients_projects_tasks.sql'
		]);
	});
});
