// Step 3.4 AI-FB gate — POST /projects/[id] ?/create creates a task
// and rejects when parent project is archived.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { createClient } from '../../../../src/lib/state/client';
import { archiveProject, createProject } from '../../../../src/lib/state/project';
import { actions } from '../../../../src/routes/projects/[id]/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFPRJ1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-prj-'));
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

function makeCreateEvent(
	projectId: string,
	fields: Record<string, string>,
	correlationId: string | undefined
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request(`http://localhost/projects/${projectId}?/create`, {
		method: 'POST',
		body: form
	});
	return {
		request,
		locals: { correlationId },
		params: { id: projectId },
		url: new URL(`http://localhost/projects/${projectId}`)
	} as unknown as RequestEvent;
}

function transitionLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l))
		.filter((l: Record<string, unknown>) => Object.hasOwn(l, 'previousState'));
}

describe('POST /projects/[id] ?/create', () => {
	test('creates a task under an active project', async () => {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'P', hourlyRate: 10000 },
			CID
		);
		const event = makeCreateEvent(project.id, { name: 'Auth' }, CID);
		const result = (await actions.create(event as never)) as {
			success: boolean;
			taskId: string;
		};
		expect(result.success).toBe(true);
		expect(result.taskId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	test('rejects a task under an archived project with rejectionReason=parent_archived', async () => {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'P', hourlyRate: 10000 },
			CID
		);
		archiveProject(getDb(), project.id, CID);

		const event = makeCreateEvent(project.id, { name: 'X' }, CID);
		const result = (await actions.create(event as never)) as {
			status: number;
			data: { rejectionReason: string };
		};
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('parent_archived');

		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'task',
			trigger: 'user.createTask',
			accepted: false,
			rejectionReason: 'parent_archived'
		});
	});

	test('rejects empty name', async () => {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'P', hourlyRate: 10000 },
			CID
		);
		const event = makeCreateEvent(project.id, { name: '   ' }, CID);
		const result = (await actions.create(event as never)) as { status: number };
		expect(result.status).toBe(400);
	});
});
