// SQLite connection and migration runner. On first open the runner
// applies every .sql file in db/migrations/ in ascending filename order,
// tracked in a `_migrations` table. Already-applied files are skipped.
//
// getDb() returns the memoized production connection (opens ./data.sqlite
// on first call). Tests call openDb(path, migrationsDir) directly with a
// tmpdir to avoid touching the production file.

import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from '../ids';
import { log } from '../log';
import { nowUtcIso } from '../time';

const DEFAULT_DB_PATH = './data.sqlite';
const DEFAULT_MIGRATIONS_DIR = 'db/migrations';

let cached: SqliteDatabase | undefined;

export function openDb(
	path: string = DEFAULT_DB_PATH,
	migrationsDir: string = DEFAULT_MIGRATIONS_DIR
): SqliteDatabase {
	log.debug({ event: 'db.open', path, migrationsDir });
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	runMigrations(db, migrationsDir);
	return db;
}

export function getDb(): SqliteDatabase {
	if (!cached) cached = openDb();
	return cached;
}

function runMigrations(db: SqliteDatabase, migrationsDir: string): void {
	const correlationId = ulid();

	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			filename TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	const appliedRows = db.prepare('SELECT filename FROM _migrations').all() as {
		filename: string;
	}[];
	const applied = new Set(appliedRows.map((r) => r.filename));

	let files: string[];
	try {
		files = readdirSync(migrationsDir)
			.filter((f) => f.endsWith('.sql'))
			.sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			// No migrations directory yet — nothing to apply. Log at warn so
			// the first-time-setup case is visible but non-fatal.
			log.warn({
				event: 'db.migrate.no_dir',
				correlationId,
				migrationsDir,
				reason: 'migrations directory not found; skipping'
			});
			return;
		}
		throw err;
	}

	log.debug({
		event: 'db.migrate.start',
		correlationId,
		migrationsDir,
		fileCount: files.length,
		alreadyApplied: applied.size
	});

	const record = db.prepare('INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)');

	for (const file of files) {
		if (applied.has(file)) {
			log.debug({ event: 'db.migrate.skip', correlationId, file });
			continue;
		}
		const sql = readFileSync(join(migrationsDir, file), 'utf8');
		const appliedAt = nowUtcIso();
		const applyOne = db.transaction(() => {
			db.exec(sql);
			record.run(file, appliedAt);
		});
		try {
			applyOne();
		} catch (err) {
			log.error({
				event: 'db.migrate.failed',
				correlationId,
				file,
				error: {
					message: (err as Error).message,
					stack: (err as Error).stack
				}
			});
			throw err;
		}
		log.info({
			event: 'db.migrate.apply',
			correlationId,
			file,
			before: { applied: false },
			after: { applied: true, appliedAt }
		});
	}
}
