// Step 3.3 AI-FB gate — POST /clients/[id] ?/create must reject when
// the parent client is archived (rejectionReason=parent_archived).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { archiveClient, createClient } from '../../../../src/lib/state/client';
import { actions } from '../../../../src/routes/clients/[id]/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFCDT1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-cdt-'));
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
	clientId: string,
	fields: Record<string, string>,
	correlationId: string | undefined
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request(`http://localhost/clients/${clientId}?/create`, {
		method: 'POST',
		body: form
	});
	return {
		request,
		locals: { correlationId },
		params: { id: clientId },
		url: new URL(`http://localhost/clients/${clientId}`)
	} as unknown as RequestEvent;
}

function transitionLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l))
		.filter((l: Record<string, unknown>) => Object.hasOwn(l, 'previousState'));
}

describe('POST /clients/[id] ?/create', () => {
	test('creates a project under an active client', async () => {
		const client = createClient(getDb(), { name: 'Acme' }, CID);
		const event = makeCreateEvent(client.id, { name: 'Web', hourlyRate: '125' }, CID);
		const result = (await actions.create(event as never)) as {
			success: boolean;
			projectId: string;
		};
		expect(result.success).toBe(true);
		expect(result.projectId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

		const rate = getDb()
			.prepare(`SELECT hourly_rate FROM projects WHERE id = ?`)
			.get(result.projectId) as { hourly_rate: number };
		expect(rate.hourly_rate).toBe(12500);
	});

	test('rejects creating a project under an archived client with rejectionReason=parent_archived', async () => {
		const client = createClient(getDb(), { name: 'Acme' }, CID);
		archiveClient(getDb(), client.id, CID);

		const event = makeCreateEvent(client.id, { name: 'Web', hourlyRate: '125' }, CID);
		const result = (await actions.create(event as never)) as {
			status: number;
			data: { error: string; rejectionReason: string };
		};
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('parent_archived');

		const rejected = transitionLines().at(-1)!;
		expect(rejected).toMatchObject({
			entityType: 'project',
			trigger: 'user.createProject',
			accepted: false,
			rejectionReason: 'parent_archived'
		});
	});

	test('rejects empty name', async () => {
		const client = createClient(getDb(), { name: 'Acme' }, CID);
		const event = makeCreateEvent(client.id, { name: '   ', hourlyRate: '100' }, CID);
		const result = (await actions.create(event as never)) as { status: number };
		expect(result.status).toBe(400);
	});

	test('rejects a non-numeric rate', async () => {
		const client = createClient(getDb(), { name: 'Acme' }, CID);
		const event = makeCreateEvent(client.id, { name: 'X', hourlyRate: 'abc' }, CID);
		const result = (await actions.create(event as never)) as { status: number };
		expect(result.status).toBe(400);
	});
});
