// Step 3.1 AI-FB gate: verifies the /settings ?/update action writes to
// the DB and emits an INFO log line with before/after per conventions §6.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { getSettings } from '../../../../src/lib/db/queries/settings';
import { actions } from '../../../../src/routes/settings/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFACT1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-set-'));
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
	const request = new Request('http://localhost/settings?/update', {
		method: 'POST',
		body: form
	});
	return {
		request,
		locals: { correlationId },
		url: new URL('http://localhost/settings')
	} as unknown as RequestEvent;
}

function readLogLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

describe('POST /settings ?/update', () => {
	test('persists the submitted values to the DB', async () => {
		const event = makeFormEvent(
			{
				senderName: 'T.J. Contract Dev',
				senderAddress: '1 Main St\nAnywhere',
				senderEmail: 'teej@example.com',
				senderPhone: '',
				paymentInstructions: 'Wire to bank X',
				currencyCode: 'eur',
				currencyDecimals: '2',
				defaultPaymentTermsDays: '14',
				invoiceLocale: 'de-DE'
			},
			CID
		);
		const result = (await actions.update(event as never)) as {
			success: boolean;
			settings: { senderName: string };
		};
		expect(result.success).toBe(true);

		const settings = getSettings(getDb());
		expect(settings.senderName).toBe('T.J. Contract Dev');
		expect(settings.senderAddress.replace(/\r\n/g, '\n')).toBe('1 Main St\nAnywhere');
		expect(settings.senderEmail).toBe('teej@example.com');
		expect(settings.senderPhone).toBeNull();
		expect(settings.paymentInstructions).toBe('Wire to bank X');
		expect(settings.currencyCode).toBe('EUR'); // uppercased by action
		expect(settings.currencyDecimals).toBe(2);
		expect(settings.defaultPaymentTermsDays).toBe(14);
		expect(settings.invoiceLocale).toBe('de-DE');
	});

	test('emits an INFO log line with before/after', async () => {
		const event = makeFormEvent(
			{
				senderName: 'New Name',
				senderAddress: 'A',
				senderEmail: 'a@b.c',
				senderPhone: '',
				paymentInstructions: 'p',
				currencyCode: 'USD',
				currencyDecimals: '2',
				defaultPaymentTermsDays: '30',
				invoiceLocale: 'en-US'
			},
			CID
		);
		await actions.update(event as never);

		const infoLine = readLogLines().find(
			(l) => l.event === 'settings.update' && l.level === 'info'
		) as Record<string, unknown>;
		expect(infoLine).toBeDefined();
		expect(infoLine.correlationId).toBe(CID);
		expect(infoLine.entityType).toBe('settings');
		expect(infoLine.entityId).toBe('1');
		expect(infoLine.before).toMatchObject({ senderName: 'Your Name' }); // seeded placeholder
		expect(infoLine.after).toMatchObject({ senderName: 'New Name' });
	});

	test('rejects with 500 when correlationId is missing', async () => {
		const event = makeFormEvent(
			{
				senderName: 'X',
				senderAddress: 'X',
				senderEmail: 'X',
				senderPhone: '',
				paymentInstructions: 'X',
				currencyCode: 'USD',
				currencyDecimals: '2',
				defaultPaymentTermsDays: '30',
				invoiceLocale: 'en-US'
			},
			undefined
		);
		const result = (await actions.update(event as never)) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(500);
	});
});
