// Step 3.2 AI-FB gate — POST /clients ?/create action.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests } from '../../../../src/lib/db';
import { actions } from '../../../../src/routes/clients/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFCLN1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-cln-'));
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

function makeFormEvent(fields: Record<string, string>, correlationId?: string): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request('http://localhost/clients?/create', {
		method: 'POST',
		body: form
	});
	return {
		request,
		locals: { correlationId },
		url: new URL('http://localhost/clients')
	} as unknown as RequestEvent;
}

function readLogLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

describe('POST /clients ?/create', () => {
	test('creates a client and emits an accepted transition-log line', async () => {
		const event = makeFormEvent({ name: 'Acme Corp' }, CID);
		const result = (await actions.create(event as never)) as {
			success: boolean;
			clientId: string;
		};
		expect(result.success).toBe(true);
		expect(result.clientId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

		const transitions = readLogLines().filter((l) => Object.hasOwn(l, 'previousState'));
		const created = transitions.find(
			(l) => l.entityId === result.clientId && l.trigger === 'user.createClient'
		);
		expect(created).toMatchObject({
			entityType: 'client',
			previousState: null,
			newState: 'client.active',
			accepted: true
		});
	});

	test('rejects empty name with 400', async () => {
		const event = makeFormEvent({ name: '   ' }, CID);
		const result = (await actions.create(event as never)) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(400);
	});

	test('rejects missing correlationId with 500', async () => {
		const event = makeFormEvent({ name: 'X' }, undefined);
		const result = (await actions.create(event as never)) as { status: number };
		expect(result.status).toBe(500);
	});
});
