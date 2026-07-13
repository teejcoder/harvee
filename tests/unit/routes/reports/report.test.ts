// Report load: per-client hours + billable amount for a month.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { ulid } from '../../../../src/lib/ids';
import { load } from '../../../../src/routes/reports/[yyyyMm]/+page.server';

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-rep-'));
	process.env.DATABASE_PATH = join(tmpDir, 'data.sqlite');
	process.env.LOG_PATH = join(tmpDir, 'log.jsonl');
	_resetDbCacheForTests();
});
afterEach(() => {
	_resetDbCacheForTests();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATABASE_PATH;
	delete process.env.LOG_PATH;
});

function seedEntry(state: string, startedAt: string, stoppedAt: string): void {
	const db = getDb();
	const eid = ulid();
	db.prepare(
		`INSERT INTO time_entries (id, task_id, state, created_at, updated_at) VALUES (?, 't1', ?, 'now', 'now')`
	).run(eid, state);
	db.prepare(
		`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at) VALUES (?, ?, ?, ?)`
	).run(ulid(), eid, startedAt, stoppedAt);
}

describe('reports/[yyyyMm] load', () => {
	test('sums hours and billable amount per client, excluding discarded', async () => {
		const db = getDb();
		db.exec(`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1','Acme','now','now');
		         INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
		           VALUES ('p1','c1','P',12500,'now','now');
		         INSERT INTO tasks (id, project_id, name, created_at, updated_at)
		           VALUES ('t1','p1','T','now','now');`);
		// Two billable hours in mid-July (UTC noon → safely inside any tz's July).
		seedEntry('entry.stopped', '2026-07-15T12:00:00.000Z', '2026-07-15T14:00:00.000Z');
		// A discarded entry that must NOT count.
		seedEntry('entry.discarded', '2026-07-16T12:00:00.000Z', '2026-07-16T20:00:00.000Z');

		const result = (await load({ params: { yyyyMm: '2026-07' } } as never)) as {
			clients: { clientName: string; hours: number; amount: number }[];
			totals: { hours: number; amount: number };
		};

		expect(result.clients).toHaveLength(1);
		expect(result.clients[0].clientName).toBe('Acme');
		expect(result.clients[0].hours).toBeCloseTo(2, 5);
		expect(result.clients[0].amount).toBe(25000); // 2h × 12500 minor units
		expect(result.totals.amount).toBe(25000);
	});

	test('empty month yields no client rows', async () => {
		getDb().exec(
			`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1','Acme','now','now')`
		);
		const result = (await load({ params: { yyyyMm: '2026-01' } } as never)) as {
			clients: unknown[];
		};
		expect(result.clients).toHaveLength(0);
	});
});
