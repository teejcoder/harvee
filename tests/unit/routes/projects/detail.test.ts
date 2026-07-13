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

	test('creates a task with a description', async () => {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'P', hourlyRate: 10000 },
			CID
		);
		await actions.create(
			makeCreateEvent(project.id, { name: 'Auth', description: 'Login + sessions' }, CID) as never
		);
		const row = getDb()
			.prepare(`SELECT name, description FROM tasks WHERE project_id = ?`)
			.get(project.id) as { name: string; description: string };
		expect(row).toMatchObject({ name: 'Auth', description: 'Login + sessions' });
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

describe('POST /projects/[id] ?/editProject and ?/deleteTask', () => {
	test('editProject updates name + rate (rate entered in major units → minor)', async () => {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'Old', hourlyRate: 10000 },
			CID
		);
		const event = makeCreateEvent(project.id, { name: 'New', hourlyRate: '150' }, CID);
		const res = (await actions.editProject(event as never)) as { success: boolean };
		expect(res.success).toBe(true);
		const row = getDb()
			.prepare(`SELECT name, hourly_rate AS r FROM projects WHERE id = ?`)
			.get(project.id) as { name: string; r: number };
		expect(row).toEqual({ name: 'New', r: 15000 }); // $150 → 15000 minor units (USD)
	});

	test('deleteTask removes an unreferenced task', async () => {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'P', hourlyRate: 10000 },
			CID
		);
		const created = (await actions.create(
			makeCreateEvent(project.id, { name: 'T' }, CID) as never
		)) as { taskId: string };
		const res = (await actions.deleteTask(
			makeCreateEvent(project.id, { taskId: created.taskId }, CID) as never
		)) as { success: boolean };
		expect(res.success).toBe(true);
		const gone = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE id = ?`)
			.get(created.taskId) as {
			n: number;
		};
		expect(gone.n).toBe(0);
	});
});

describe('POST /projects/[id] ?/updateTask', () => {
	async function seedTask(): Promise<{ projectId: string; taskId: string }> {
		const client = createClient(getDb(), { name: 'A' }, CID);
		const project = createProject(
			getDb(),
			{ clientId: client.id, name: 'P', hourlyRate: 10000 },
			CID
		);
		const created = (await actions.create(
			makeCreateEvent(project.id, { name: 'Old', description: 'old desc' }, CID) as never
		)) as { taskId: string };
		return { projectId: project.id, taskId: created.taskId };
	}

	test('renames a task and edits its description', async () => {
		const { projectId, taskId } = await seedTask();
		const result = (await actions.updateTask(
			makeCreateEvent(projectId, { taskId, name: 'New', description: 'new desc' }, CID) as never
		)) as { success: boolean };
		expect(result.success).toBe(true);

		const row = getDb().prepare(`SELECT name, description FROM tasks WHERE id = ?`).get(taskId) as {
			name: string;
			description: string;
		};
		expect(row).toEqual({ name: 'New', description: 'new desc' });

		const updateLine = readFileSync(logFile, 'utf8')
			.split('\n')
			.filter((l) => l.length > 0)
			.map((l) => JSON.parse(l))
			.find((l: Record<string, unknown>) => l.event === 'task.update');
		expect(updateLine).toMatchObject({ after: { name: 'New', description: 'new desc' } });
	});

	test('rejects empty name', async () => {
		const { projectId, taskId } = await seedTask();
		const result = (await actions.updateTask(
			makeCreateEvent(projectId, { taskId, name: '  ', description: 'x' }, CID) as never
		)) as { status: number };
		expect(result.status).toBe(400);
	});
});
