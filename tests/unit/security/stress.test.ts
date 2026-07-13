// Security stress test. Exercises attacker-shaped inputs against the real
// route actions + state machines and asserts the HARDENED behavior:
//   - PDF export degrades gracefully on non-WinAnsi text (no unhandled throw)
//   - a bad snapshotted currency/locale does not 500 the export
//   - rejected state transitions are logged at WARN with a correlationId
//   - malformed input rejections are logged at WARN
//   - no secrets in logs; correlationId present on security events

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../src/lib/db';
import { ulid } from '../../../src/lib/ids';
import { actions as clientActions } from '../../../src/routes/clients/[id]/+page.server';
import { actions as invoiceActions } from '../../../src/routes/invoices/[id]/+page.server';
import { actions as settingsActions } from '../../../src/routes/settings/+page.server';
import { POST as exportPOST } from '../../../src/routes/invoices/[id]/export/+server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFSEC1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-sec-'));
	process.env.DATABASE_PATH = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
	process.env.INVOICE_DIR = join(tmpDir, 'invoices');
	_resetDbCacheForTests();
});

afterEach(() => {
	_resetDbCacheForTests();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATABASE_PATH;
	delete process.env.LOG_PATH;
	delete process.env.INVOICE_DIR;
});

function ev(params: Record<string, string>, fields: Record<string, string> = {}): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return {
		request: new Request('http://localhost/x', { method: 'POST', body: form }),
		locals: { correlationId: CID },
		params,
		url: new URL('http://localhost/x')
	} as unknown as RequestEvent;
}

function lines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

function seed(opts: { currencyCode?: string; invoiceLocale?: string } = {}): { clientId: string } {
	const db = getDb();
	if (opts.currencyCode || opts.invoiceLocale) {
		db.prepare(`UPDATE settings SET currency_code = ?, invoice_locale = ? WHERE id = 1`).run(
			opts.currencyCode ?? 'USD',
			opts.invoiceLocale ?? 'en-US'
		);
	}
	db.exec(`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1','Acme','now','now');
	         INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
	           VALUES ('p1','c1','Proj',12500,'now','now');
	         INSERT INTO tasks (id, project_id, name, created_at, updated_at)
	           VALUES ('t1','p1','Auth','now','now');`);
	const eid = ulid();
	db.prepare(
		`INSERT INTO time_entries (id, task_id, state, created_at, updated_at)
		 VALUES (?, 't1', 'entry.stopped', 'now', 'now')`
	).run(eid);
	db.prepare(
		`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
		 VALUES (?, ?, '2026-07-10T04:00:00.000Z', '2026-07-10T05:00:00.000Z')`
	).run(ulid(), eid);
	return { clientId: 'c1' };
}

async function draftFor(clientId: string): Promise<string> {
	let loc: string | undefined;
	try {
		await clientActions.generateInvoice(
			ev({ id: clientId }, { startDate: '2026-07-01', endDate: '2026-07-31' }) as never
		);
	} catch (e) {
		loc = (e as { location: string }).location;
	}
	return loc!.split('/').at(-1)!;
}

describe('Output manipulation — PDF render must not be DoS-able by unencodable text', () => {
	test('emoji / curly quotes / arrows in a line description still export a valid PDF', async () => {
		const { clientId } = seed();
		const invId = await draftFor(clientId);
		// Inject characters outside WinAnsi (CP1252): emoji, arrow, curly quotes.
		const lineId = (
			getDb()
				.prepare(`SELECT id FROM invoice_line_items WHERE invoice_id = ? AND kind='task'`)
				.get(invId) as { id: string }
		).id;
		await invoiceActions.updateLine(
			ev(
				{ id: invId },
				{ lineId, description: '🚀 “launch” → ship', hours: '1', rate: '125' }
			) as never
		);
		await invoiceActions.finalize(ev({ id: invId }) as never);

		const res = await exportPOST(ev({ id: invId }) as never);
		expect(res.status).toBe(200);
		const body = new Uint8Array(await res.arrayBuffer());
		expect(new TextDecoder().decode(body.slice(0, 5))).toBe('%PDF-');
	});

	test('a bad snapshotted currency code does not crash the export', async () => {
		const { clientId } = seed({ currencyCode: 'ZZ', invoiceLocale: 'en-US' });
		const invId = await draftFor(clientId);
		await invoiceActions.finalize(ev({ id: invId }) as never);
		const res = await exportPOST(ev({ id: invId }) as never);
		expect(res.status).toBe(200);
	});
});

describe('Logging — security events at WARN with a correlationId', () => {
	test('a rejected state transition emits a WARN line carrying the rejectionReason + correlationId', async () => {
		const { clientId } = seed();
		const invId = await draftFor(clientId);
		await invoiceActions.addDiscount(ev({ id: invId }, { description: 'a', amount: '1' }) as never);
		// Second discount line → invalid_discount_line rejection.
		await invoiceActions.addDiscount(ev({ id: invId }, { description: 'b', amount: '1' }) as never);

		const warn = lines().find(
			(l) => l.level === 'warn' && l.rejectionReason === 'invalid_discount_line'
		);
		expect(warn).toBeDefined();
		expect(warn!.correlationId).toBe(CID);
	});

	test('a malformed-input rejection is logged at WARN with a correlationId', async () => {
		const { clientId } = seed();
		const invId = await draftFor(clientId);
		const res = (await invoiceActions.addDiscount(
			ev({ id: invId }, { description: 'x', amount: 'not-a-number' }) as never
		)) as { status: number };
		expect(res.status).toBe(400);
		const warn = lines().find(
			(l) => l.level === 'warn' && String(l.event).includes('validation') && l.correlationId === CID
		);
		expect(warn).toBeDefined();
	});

	test('invalid currency/locale in settings is rejected and logged at WARN', async () => {
		const res = (await settingsActions.update(
			ev(
				{},
				{
					senderName: 'me',
					senderAddress: 'addr',
					senderEmail: 'a@b.c',
					senderPhone: '',
					paymentInstructions: 'pay',
					currencyCode: 'ZZZZ',
					currencyDecimals: '2',
					defaultPaymentTermsDays: '30',
					invoiceLocale: 'not a locale!!'
				}
			) as never
		)) as { status: number };
		expect(res.status).toBe(400);
		expect(lines().some((l) => l.level === 'warn' && l.correlationId === CID)).toBe(true);
	});
});

describe('Logs never contain secrets', () => {
	test('no log line contains a raw password/token/secret key', () => {
		seed();
		const raw = readFileSync(logFile, 'utf8');
		expect(/password|passwd|secret|api[_-]?key|bearer|authorization/i.test(raw)).toBe(false);
	});
});
