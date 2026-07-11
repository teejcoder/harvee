import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../src/lib/db';

// This suite applies the REAL production migrations directory (`db/migrations`)
// against a tmp SQLite file — end-to-end validation that 001_settings.sql
// runs cleanly through the runner and leaves the DB in the intended shape.

let tmpDir: string;
let dbPath: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-settings-'));
	dbPath = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

describe('001_settings.sql', () => {
	test('creates the settings table with CHECK (id = 1)', () => {
		const db = openDb(dbPath, 'db/migrations');

		const row = db
			.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'")
			.get() as { sql: string } | undefined;

		expect(row).toBeDefined();
		expect(row!.sql).toMatch(/CHECK\s*\(\s*id\s*=\s*1\s*\)/i);

		db.close();
	});

	test('seeds exactly one row with placeholder values and id = 1', () => {
		const db = openDb(dbPath, 'db/migrations');

		const count = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
		expect(count.n).toBe(1);

		const row = db.prepare('SELECT * FROM settings').get() as Record<string, unknown>;
		expect(row.id).toBe(1);
		expect(row.sender_name).toBe('Your Name');
		expect(row.currency_code).toBe('USD');
		expect(row.currency_decimals).toBe(2);
		expect(row.default_payment_terms_days).toBe(30);
		expect(row.invoice_locale).toBe('en-US');
		expect(row.sender_phone).toBeNull();

		db.close();
	});

	test('inserting a second row with id != 1 is rejected by CHECK', () => {
		const db = openDb(dbPath, 'db/migrations');

		expect(() =>
			db
				.prepare(
					`INSERT INTO settings (
					id, sender_name, sender_address, sender_email,
					payment_instructions, currency_code, currency_decimals,
					default_payment_terms_days, invoice_locale
				) VALUES (2, 'X', 'X', 'x@x', 'X', 'USD', 2, 30, 'en-US')`
				)
				.run()
		).toThrow(/CHECK constraint failed/i);

		// Row count still 1
		const count = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
		expect(count.n).toBe(1);

		db.close();
	});

	test('a second open does not duplicate the settings row (migration recorded once)', () => {
		const db1 = openDb(dbPath, 'db/migrations');
		db1.close();

		const db2 = openDb(dbPath, 'db/migrations');
		const count = db2.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
		expect(count.n).toBe(1);

		const applied = db2.prepare('SELECT filename FROM _migrations').all() as {
			filename: string;
		}[];
		expect(applied.map((r) => r.filename)).toEqual(['001_settings.sql']);

		db2.close();
	});
});
