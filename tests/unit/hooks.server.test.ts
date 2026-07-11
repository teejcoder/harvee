import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { handle } from '../../src/hooks.server';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-hook-'));
	process.env.LOG_PATH = join(tmpDir, 'transitions.jsonl');
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

function mockEvent(method: string, path = '/test'): RequestEvent {
	const request = new Request(`http://localhost${path}`, { method });
	return {
		request,
		locals: {},
		url: new URL(`http://localhost${path}`)
	} as unknown as RequestEvent;
}

async function callHandle(method: string): Promise<{ event: RequestEvent; response: Response }> {
	const event = mockEvent(method);
	const response = await handle({
		event,
		resolve: async () => new Response('ok', { status: 200 })
	});
	return { event, response };
}

describe('hooks.server.ts — handle()', () => {
	test('POST mints a ULID correlation ID, sets locals, and attaches X-Correlation-Id header', async () => {
		const { event, response } = await callHandle('POST');

		expect(event.locals.correlationId).toMatch(ULID_REGEX);
		expect(response.headers.get('X-Correlation-Id')).toBe(event.locals.correlationId);
	});

	test.each(['GET', 'HEAD'])(
		'%s request does NOT get a correlation ID (locals undefined, no header)',
		async (method) => {
			const { event, response } = await callHandle(method);

			expect(event.locals.correlationId).toBeUndefined();
			expect(response.headers.get('X-Correlation-Id')).toBeNull();
		}
	);

	test.each(['PUT', 'PATCH', 'DELETE'])(
		'%s request also mints a correlation ID',
		async (method) => {
			const { event, response } = await callHandle(method);

			expect(event.locals.correlationId).toMatch(ULID_REGEX);
			expect(response.headers.get('X-Correlation-Id')).toBe(event.locals.correlationId);
		}
	);

	test('correlation IDs are unique across two POSTs', async () => {
		const first = await callHandle('POST');
		const second = await callHandle('POST');

		expect(first.event.locals.correlationId).not.toBe(second.event.locals.correlationId);
	});
});
