// Steps 4.4, 4.5, 4.6 gates — /entries/[id] actions.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { createClient } from '../../../../src/lib/state/client';
import { createProject } from '../../../../src/lib/state/project';
import { createTask } from '../../../../src/lib/state/task';
import { lockEntry, pickTask, startTimer, stopTimer } from '../../../../src/lib/state/entry';
import { actions } from '../../../../src/routes/entries/[id]/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFENT1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-ent-'));
	process.env.DATABASE_PATH = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
	_resetDbCacheForTests();
});

afterEach(() => {
	_resetDbCacheForTests();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATABASE_PATH;
	delete process.env.LOG_PATH;
	vi.useRealTimers();
});

function makeEvent(
	entryId: string,
	fields: Record<string, string> = {},
	correlationId: string | undefined = CID
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request(`http://localhost/entries/${entryId}`, {
		method: 'POST',
		body: form
	});
	return {
		request,
		locals: { correlationId },
		params: { id: entryId },
		url: new URL(`http://localhost/entries/${entryId}`)
	} as unknown as RequestEvent;
}

function allLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function seedStoppedEntry(): string {
	const c = createClient(getDb(), { name: 'A' }, CID);
	const p = createProject(getDb(), { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
	const t = createTask(getDb(), { projectId: p.id, name: 'T' }, CID);
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-10T10:00:00.000Z'));
	const e = pickTask(getDb(), { taskId: t.id }, CID);
	startTimer(getDb(), e.id, CID);
	vi.setSystemTime(new Date('2026-07-10T11:00:00.000Z'));
	stopTimer(getDb(), e.id, CID);
	vi.useRealTimers();
	return e.id;
}

describe('Step 4.4 — updateNotes', () => {
	test('updates notes on a stopped entry', async () => {
		const id = seedStoppedEntry();
		const result = (await actions.updateNotes(
			makeEvent(id, { notes: 'refactored auth flow' }) as never
		)) as { success: boolean };
		expect(result.success).toBe(true);

		const row = getDb().prepare(`SELECT notes FROM time_entries WHERE id = ?`).get(id) as {
			notes: string;
		};
		expect(row.notes).toBe('refactored auth flow');
	});

	test('rejects notes edit on a locked entry with entry_locked_by_invoice', async () => {
		const id = seedStoppedEntry();
		// Set up a finalized invoice so we can lock the entry.
		const clientId = getDb()
			.prepare(
				`SELECT c.id FROM clients c JOIN projects p ON p.client_id = c.id
				 JOIN tasks t ON t.project_id = p.id JOIN time_entries e ON e.task_id = t.id
				 WHERE e.id = ?`
			)
			.get(id) as { id: string };
		getDb()
			.prepare(
				`INSERT INTO invoices (
					id, client_id, state, start_date, end_date, invoice_number,
					payment_terms_days, currency_code, currency_decimals, invoice_locale,
					subtotal, discount_total, total, finalized_at, created_at, updated_at
				) VALUES ('inv1', ?, 'invoice.finalized', '2026-07-01', '2026-07-31', '20260711-1',
					30, 'USD', 2, 'en-US', 10000, 0, 10000,
					'2026-07-11T00:00:00.000Z', 'now', 'now')`
			)
			.run(clientId.id);
		lockEntry(getDb(), { entryId: id, invoiceId: 'inv1' }, CID);

		const result = (await actions.updateNotes(makeEvent(id, { notes: 'no' }) as never)) as {
			status: number;
			data: { rejectionReason: string };
		};
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('entry_locked_by_invoice');
	});
});

describe('Step 4.5 — openEdit / updateSegment / saveEdit / cancelEdit', () => {
	test('openEdit → invalid time range → segment_overlap', async () => {
		const id = seedStoppedEntry();

		// openEdit
		const opened = (await actions.openEdit(makeEvent(id) as never)) as { success: boolean };
		expect(opened.success).toBe(true);
		const state1 = getDb().prepare(`SELECT state FROM time_entries WHERE id = ?`).get(id) as {
			state: string;
		};
		expect(state1.state).toBe('entry.editing');

		const seg = getDb()
			.prepare(`SELECT id FROM time_entry_segments WHERE entry_id = ?`)
			.get(id) as { id: string };

		// Invalid time range (stopped < started)
		const bad = (await actions.updateSegment(
			makeEvent(id, {
				segmentId: seg.id,
				startedAt: '2026-07-10T15:00:00.000Z',
				stoppedAt: '2026-07-10T10:00:00.000Z'
			}) as never
		)) as { status: number };
		expect(bad.status).toBe(400);
		const warns = allLines().filter(
			(l) => l.event === 'segment.update.rejected' && l.rejectionReason === 'invalid_time_range'
		);
		expect(warns.length).toBeGreaterThan(0);

		// Cancel — segments restored, state back to stopped
		await actions.cancelEdit(makeEvent(id) as never);
		const state2 = getDb().prepare(`SELECT state FROM time_entries WHERE id = ?`).get(id) as {
			state: string;
		};
		expect(state2.state).toBe('entry.stopped');
	});
});

describe('Step 4.6 — Resume', () => {
	test('Resume opens a new segment; two-segment total = sum of segments', async () => {
		const id = seedStoppedEntry();
		// One segment so far: 10:00 → 11:00 = 1h

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const resumed = (await actions.resume(makeEvent(id) as never)) as { success: boolean };
		expect(resumed.success).toBe(true);

		// Now running with a second (open) segment.
		vi.setSystemTime(new Date('2026-07-10T13:00:00.000Z'));
		stopTimer(getDb(), id, CID); // close the second segment
		vi.useRealTimers();

		const segCount = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ?`)
			.get(id) as { n: number };
		expect(segCount.n).toBe(2);

		// Total hours = 1h + 1h = 2h.
		const totalMs = getDb()
			.prepare(
				`SELECT SUM(strftime('%s', stopped_at) - strftime('%s', started_at)) AS s
				 FROM time_entry_segments WHERE entry_id = ?`
			)
			.get(id) as { s: number };
		expect(totalMs.s).toBe(2 * 3600);
	});
});
