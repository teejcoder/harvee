// Steps 5.1 / 5.2 / 5.3 gates — calendar totals correctness.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { ulid } from '../../../../src/lib/ids';
import { load as loadDay } from '../../../../src/routes/calendar/day/[date]/+page.server';
import { load as loadWeek } from '../../../../src/routes/calendar/week/[date]/+page.server';
import { load as loadMonth } from '../../../../src/routes/calendar/month/[yyyyMm]/+page.server';

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-cal-'));
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

/** Seed a client/project/task chain and one stopped entry per segment. */
function seed(segments: { startedAt: string; hours: number }[]): void {
	const db = getDb();
	db.exec(`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1', 'A', 'now', 'now');
	         INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
	           VALUES ('p1', 'c1', 'P', 10000, 'now', 'now');
	         INSERT INTO tasks (id, project_id, name, created_at, updated_at)
	           VALUES ('t1', 'p1', 'T', 'now', 'now');`);

	const insertEntry = db.prepare(
		`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
		 VALUES (?, 't1', 'entry.stopped', 'now', 'now')`
	);
	const insertSeg = db.prepare(
		`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
		 VALUES (?, ?, ?, ?)`
	);
	for (const s of segments) {
		const eid = ulid();
		insertEntry.run(eid);
		const stoppedAt = new Date(new Date(s.startedAt).getTime() + s.hours * 3_600_000).toISOString();
		insertSeg.run(ulid(), eid, s.startedAt, stoppedAt);
	}
}

describe('Step 5.1 — day view totals', () => {
	test('day totals sum segments falling in local-day range', async () => {
		seed([
			{ startedAt: '2026-07-10T04:00:00.000Z', hours: 1 },
			{ startedAt: '2026-07-10T05:00:00.000Z', hours: 1 }
		]);

		const result = (await loadDay({
			params: { date: '2026-07-10' }
		} as never)) as {
			segments: { durationMs: number }[];
			projectTotals: { hours: number }[];
		};

		expect(result.segments.length).toBeGreaterThan(0);
		const total = result.segments.reduce((sum, s) => sum + s.durationMs / 3_600_000, 0);
		expect(total).toBeCloseTo(2, 4);
		expect(result.projectTotals).toHaveLength(1);
		expect(result.projectTotals[0].hours).toBeCloseTo(2, 4);
	});
});

describe('Step 5.2 — week view totals', () => {
	test('week total = sum of day totals; per-day list has 7 entries Monday-anchored', async () => {
		seed([
			{ startedAt: '2026-07-06T04:00:00.000Z', hours: 1 },
			{ startedAt: '2026-07-08T04:00:00.000Z', hours: 2 },
			{ startedAt: '2026-07-10T04:00:00.000Z', hours: 3 }
		]);

		const week = (await loadWeek({
			params: { date: '2026-07-08' }
		} as never)) as {
			days: { date: string; hours: number }[];
			totalHours: number;
		};

		expect(week.days).toHaveLength(7);
		const summed = week.days.reduce((s, d) => s + d.hours, 0);
		expect(week.totalHours).toBeCloseTo(summed, 4);
		expect(week.totalHours).toBeGreaterThan(0);
	});
});

describe('Step 5.3 — month view', () => {
	test('cells reflect per-day hours; leading blanks pad Monday-start', async () => {
		seed([{ startedAt: '2026-07-15T04:00:00.000Z', hours: 1 }]);

		const month = (await loadMonth({
			params: { yyyyMm: '2026-07' }
		} as never)) as {
			cells: ({ date: string; hours: number } | null)[];
		};

		// 2026-07-01 is a Wednesday → 2 leading blanks (Mon, Tue).
		expect(month.cells.slice(0, 2)).toEqual([null, null]);
		expect(month.cells[2]).toMatchObject({ date: '2026-07-01' });

		const jul15 = month.cells.find((c) => c !== null && c.date === '2026-07-15');
		expect(jul15).toBeDefined();
		expect(jul15!.hours).toBeGreaterThan(0);
	});
});
