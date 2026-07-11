import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';

let tmpDir: string;
let dbPath: string;
let migrationsDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-db-'));
	dbPath = join(tmpDir, 'data.sqlite');
	migrationsDir = join(tmpDir, 'migrations');
	mkdirSync(migrationsDir);
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

function readLogLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

describe('openDb + runMigrations', () => {
	test('creates data.sqlite and the _migrations table on first open', () => {
		const db = openDb(dbPath, migrationsDir);
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
			name: string;
		}[];
		expect(tables.some((t) => t.name === '_migrations')).toBe(true);
		db.close();
	});

	test('applies each .sql file in ascending filename order', () => {
		writeFileSync(join(migrationsDir, '002_bar.sql'), 'CREATE TABLE bar (id TEXT);');
		writeFileSync(join(migrationsDir, '001_foo.sql'), 'CREATE TABLE foo (id TEXT);');
		const db = openDb(dbPath, migrationsDir);

		const applied = (
			db.prepare('SELECT filename FROM _migrations ORDER BY filename').all() as {
				filename: string;
			}[]
		).map((r) => r.filename);
		expect(applied).toEqual(['001_foo.sql', '002_bar.sql']);

		// Both tables actually exist
		const tables = (
			db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
		).map((t) => t.name);
		expect(tables).toContain('foo');
		expect(tables).toContain('bar');

		db.close();
	});

	test('second open logs db.migrate.skip for every migration file with zero writes', () => {
		writeFileSync(join(migrationsDir, '001_foo.sql'), 'CREATE TABLE foo (id TEXT);');
		writeFileSync(join(migrationsDir, '002_bar.sql'), 'CREATE TABLE bar (id TEXT);');

		const db1 = openDb(dbPath, migrationsDir);
		db1.close();

		// Clear log to isolate second-boot output
		writeFileSync(logFile, '');

		const db2 = openDb(dbPath, migrationsDir);
		const lines = readLogLines();

		const skips = lines.filter((l) => l.event === 'db.migrate.skip');
		expect(skips.map((s) => s.file).sort()).toEqual(['001_foo.sql', '002_bar.sql']);

		const applies = lines.filter((l) => l.event === 'db.migrate.apply');
		expect(applies).toHaveLength(0);

		db2.close();
	});

	test('handles a missing migrations directory gracefully (warn + no failure)', () => {
		const missingDir = join(tmpDir, 'does-not-exist');
		const db = openDb(dbPath, missingDir);

		const lines = readLogLines();
		expect(lines.some((l) => l.event === 'db.migrate.no_dir')).toBe(true);

		// _migrations table exists, no rows.
		const rows = db.prepare('SELECT filename FROM _migrations').all();
		expect(rows).toHaveLength(0);
		db.close();
	});

	test('rolls back the transaction if a migration fails mid-way', () => {
		// Two-statement migration: the first CREATE TABLE succeeds, then a
		// bad statement fails. Without a transaction wrapper the CREATE
		// would persist. This test proves atomicity — the wrapper must
		// roll BOTH the schema change AND the _migrations insert back.
		writeFileSync(
			join(migrationsDir, '001_partial.sql'),
			'CREATE TABLE will_rollback (id TEXT);\nTHIS IS NOT VALID SQL;'
		);
		expect(() => openDb(dbPath, migrationsDir)).toThrow();

		// Reopen with an empty migrations dir so we can inspect state.
		const emptyDir = join(tmpDir, 'empty');
		mkdirSync(emptyDir);
		const db = openDb(dbPath, emptyDir);

		// Neither the table nor the _migrations record should exist.
		const tables = (
			db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
		).map((t) => t.name);
		expect(tables).not.toContain('will_rollback');

		const applied = db.prepare('SELECT filename FROM _migrations').all();
		expect(applied).toHaveLength(0);

		db.close();
	});
});
