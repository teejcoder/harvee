// Step 3.5 AI-FB gate — archive/unarchive routes reject with the
// canonical rejection reasons when preconditions aren't met.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../src/lib/db';
import { createClient } from '../../../src/lib/state/client';
import { createProject } from '../../../src/lib/state/project';
import { createTask } from '../../../src/lib/state/task';
import { pickTask, startTimer } from '../../../src/lib/state/entry';
import { actions as clientActions } from '../../../src/routes/clients/[id]/+page.server';
import { actions as projectActions } from '../../../src/routes/projects/[id]/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFARC1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-arc-'));
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
	params: Record<string, string>,
	fields: Record<string, string> = {},
	correlationId: string | undefined = CID
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request(`http://localhost${path}`, { method: 'POST', body: form });
	return {
		request,
		locals: { correlationId },
		params,
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

describe('archive rejections', () => {
	test('archiveClient with an active project → children_not_archived', async () => {
		const c = createClient(getDb(), { name: 'A' }, CID);
		createProject(getDb(), { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);

		const result = (await clientActions.archiveClient(
			makeEvent(`/clients/${c.id}?/archiveClient`, { id: c.id }) as never
		)) as { status: number; data: { rejectionReason: string } };

		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('children_not_archived');

		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'client',
			accepted: false,
			rejectionReason: 'children_not_archived'
		});
	});

	test('archiveProject with an active task → children_not_archived', async () => {
		const c = createClient(getDb(), { name: 'A' }, CID);
		const p = createProject(getDb(), { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
		createTask(getDb(), { projectId: p.id, name: 'T' }, CID);

		const result = (await projectActions.archiveProject(
			makeEvent(`/projects/${p.id}?/archiveProject`, { id: p.id }) as never
		)) as { status: number; data: { rejectionReason: string } };

		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('children_not_archived');
	});

	test('archiveTask with a running timer → task_has_running_timer', async () => {
		const c = createClient(getDb(), { name: 'A' }, CID);
		const p = createProject(getDb(), { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
		const t = createTask(getDb(), { projectId: p.id, name: 'T' }, CID);
		const e = pickTask(getDb(), { taskId: t.id }, CID);
		startTimer(getDb(), e.id, CID);

		const result = (await projectActions.archiveTask(
			makeEvent(`/projects/${p.id}?/archiveTask`, { id: p.id }, { taskId: t.id }) as never
		)) as { status: number; data: { rejectionReason: string } };

		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('task_has_running_timer');

		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'task',
			accepted: false,
			rejectionReason: 'task_has_running_timer'
		});
	});

	test('archiveClient with no active children succeeds', async () => {
		const c = createClient(getDb(), { name: 'A' }, CID);
		const result = (await clientActions.archiveClient(
			makeEvent(`/clients/${c.id}?/archiveClient`, { id: c.id }) as never
		)) as { success: boolean };
		expect(result.success).toBe(true);

		// Round-trip: unarchive works too.
		const un = (await clientActions.unarchiveClient(
			makeEvent(`/clients/${c.id}?/unarchiveClient`, { id: c.id }) as never
		)) as { success: boolean };
		expect(un.success).toBe(true);
	});
});
