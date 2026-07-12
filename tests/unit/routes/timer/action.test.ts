// Steps 4.1 / 4.2 / 4.3 gate — /timer ?/start and ?/stop actions.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { createClient } from '../../../../src/lib/state/client';
import { createProject } from '../../../../src/lib/state/project';
import { createTask } from '../../../../src/lib/state/task';
import { actions } from '../../../../src/routes/timer/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFTMR1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-tmr-'));
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
});

function makeEvent(
	path: string,
	fields: Record<string, string>,
	correlationId: string | undefined = CID
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request(`http://localhost${path}`, { method: 'POST', body: form });
	return {
		request,
		locals: { correlationId },
		params: {},
		url: new URL(`http://localhost${path}`)
	} as unknown as RequestEvent;
}

function transitionLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l))
		.filter((l: Record<string, unknown>) => Object.hasOwn(l, 'previousState'));
}

function seedTaskChain(): string {
	const c = createClient(getDb(), { name: 'A' }, CID);
	const p = createProject(getDb(), { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
	const t = createTask(getDb(), { projectId: p.id, name: 'T' }, CID);
	return t.id;
}

describe('POST /timer ?/start (Step 4.1)', () => {
	test('creates a draft, starts it, opens exactly one segment', async () => {
		const taskId = seedTaskChain();
		const result = (await actions.start(makeEvent('/timer?/start', { taskId }) as never)) as {
			success: boolean;
			entryId: string;
		};
		expect(result.success).toBe(true);

		const entry = getDb()
			.prepare(`SELECT state FROM time_entries WHERE id = ?`)
			.get(result.entryId) as { state: string };
		expect(entry.state).toBe('entry.running');

		const segments = getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ? AND stopped_at IS NULL`
			)
			.get(result.entryId) as { n: number };
		expect(segments.n).toBe(1);

		// AI-FB gate: entry.draft → entry.running transition line present
		const transitions = transitionLines();
		expect(
			transitions.some(
				(l) =>
					l.entityId === result.entryId &&
					l.previousState === 'entry.draft' &&
					l.newState === 'entry.running'
			)
		).toBe(true);
	});
});

describe('POST /timer ?/stop (Step 4.2)', () => {
	test('closes the open segment and returns to entry.stopped', async () => {
		const taskId = seedTaskChain();
		const started = (await actions.start(makeEvent('/timer?/start', { taskId }) as never)) as {
			success: boolean;
			entryId: string;
		};

		const stopped = (await actions.stop(
			makeEvent('/timer?/stop', { entryId: started.entryId }) as never
		)) as { success: boolean };
		expect(stopped.success).toBe(true);

		const entry = getDb()
			.prepare(`SELECT state FROM time_entries WHERE id = ?`)
			.get(started.entryId) as { state: string };
		expect(entry.state).toBe('entry.stopped');

		const open = getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM time_entry_segments WHERE entry_id = ? AND stopped_at IS NULL`
			)
			.get(started.entryId) as { n: number };
		expect(open.n).toBe(0);

		// Transition line: entry.running → entry.stopped
		const transitions = transitionLines();
		expect(
			transitions.some(
				(l) =>
					l.entityId === started.entryId &&
					l.previousState === 'entry.running' &&
					l.newState === 'entry.stopped'
			)
		).toBe(true);
	});
});

describe('POST /timer ?/start rejection (Step 4.3)', () => {
	test('starting a second timer while another is running → concurrent_timer_forbidden', async () => {
		const taskId = seedTaskChain();
		await actions.start(makeEvent('/timer?/start', { taskId }) as never);

		// Second start with the same task — concurrent_timer_forbidden
		const result = (await actions.start(makeEvent('/timer?/start', { taskId }) as never)) as {
			status: number;
			data: { rejectionReason: string };
		};
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('concurrent_timer_forbidden');

		const rejected = transitionLines()
			.filter((l) => l.accepted === false)
			.at(-1)!;
		expect(rejected).toMatchObject({
			accepted: false,
			rejectionReason: 'concurrent_timer_forbidden'
		});
	});
});
