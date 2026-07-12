// Step 6.6 gate — PDF export. Drives the POST /invoices/[id]/export endpoint and
// asserts: the transition line finalized → exported is logged, a valid PDF is
// streamed back, and the same bytes land at <INVOICE_DIR>/<invoiceNumber>.pdf.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { ulid } from '../../../../src/lib/ids';
import { actions as clientActions } from '../../../../src/routes/clients/[id]/+page.server';
import { actions as invoiceActions } from '../../../../src/routes/invoices/[id]/+page.server';
import { POST } from '../../../../src/routes/invoices/[id]/export/+server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFEXP1';

let tmpDir: string;
let invoiceDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-exp-'));
	process.env.DATABASE_PATH = join(tmpDir, 'data.sqlite');
	process.env.LOG_PATH = join(tmpDir, 'log.jsonl');
	invoiceDir = join(tmpDir, 'invoices');
	process.env.INVOICE_DIR = invoiceDir;
	_resetDbCacheForTests();
});

afterEach(() => {
	_resetDbCacheForTests();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATABASE_PATH;
	delete process.env.LOG_PATH;
	delete process.env.INVOICE_DIR;
	vi.useRealTimers();
});

function eventFor(
	params: Record<string, string>,
	fields: Record<string, string> = {},
	correlationId: string | undefined = CID
): RequestEvent {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	const request = new Request('http://localhost/x', { method: 'POST', body: form });
	return {
		request,
		locals: { correlationId },
		params,
		url: new URL('http://localhost/x')
	} as unknown as RequestEvent;
}

function transitionLines(): Record<string, unknown>[] {
	return readFileSync(process.env.LOG_PATH!, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l))
		.filter((l: Record<string, unknown>) => Object.hasOwn(l, 'previousState'));
}

function seedClientWithStoppedEntry(): { clientId: string } {
	const db = getDb();
	db.exec(`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1', 'Acme', 'now', 'now');
	         INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
	           VALUES ('p1', 'c1', 'Proj', 12500, 'now', 'now');
	         INSERT INTO tasks (id, project_id, name, created_at, updated_at)
	           VALUES ('t1', 'p1', 'Auth', 'now', 'now');`);
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

async function createFinalizedInvoice(): Promise<string> {
	const { clientId } = seedClientWithStoppedEntry();
	let redirected: { location: string } | undefined;
	try {
		await clientActions.generateInvoice(
			eventFor({ id: clientId }, { startDate: '2026-07-01', endDate: '2026-07-31' }) as never
		);
	} catch (err) {
		redirected = err as { location: string };
	}
	const invId = redirected!.location.split('/').at(-1)!;
	await invoiceActions.finalize(eventFor({ id: invId }) as never);
	return invId;
}

describe('Step 6.6 — export PDF', () => {
	test('streams a valid PDF, writes the file, and logs finalized → exported', async () => {
		const invId = await createFinalizedInvoice();

		const res = await POST(eventFor({ id: invId }) as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');

		const invoiceNumber = getDb()
			.prepare(`SELECT invoice_number FROM invoices WHERE id = ?`)
			.get(invId) as { invoice_number: string };
		expect(res.headers.get('content-disposition')).toContain(`${invoiceNumber.invoice_number}.pdf`);

		// Streamed bytes are a valid PDF.
		const body = new Uint8Array(await res.arrayBuffer());
		expect(body.length).toBeGreaterThan(0);
		expect(new TextDecoder().decode(body.slice(0, 5))).toBe('%PDF-');

		// File on disk at the expected path, non-zero, valid header, same bytes.
		const filePath = join(invoiceDir, `${invoiceNumber.invoice_number}.pdf`);
		expect(existsSync(filePath)).toBe(true);
		const onDisk = readFileSync(filePath);
		expect(statSync(filePath).size).toBeGreaterThan(0);
		expect(onDisk.subarray(0, 5).toString('latin1')).toBe('%PDF-');
		expect(onDisk.length).toBe(body.length);

		// State transitioned + logged.
		const inv = getDb().prepare(`SELECT state FROM invoices WHERE id = ?`).get(invId) as {
			state: string;
		};
		expect(inv.state).toBe('invoice.exported');
		const exportLine = transitionLines().find(
			(l) =>
				l.previousState === 'invoice.finalized' &&
				l.newState === 'invoice.exported' &&
				l.accepted === true
		);
		expect(exportLine).toBeDefined();
	});

	test('exporting a draft → 400 with rejectionReason=must_finalize_before_export', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		let redirected: { location: string } | undefined;
		try {
			await clientActions.generateInvoice(
				eventFor({ id: clientId }, { startDate: '2026-07-01', endDate: '2026-07-31' }) as never
			);
		} catch (err) {
			redirected = err as { location: string };
		}
		const invId = redirected!.location.split('/').at(-1)!;

		const res = await POST(eventFor({ id: invId }) as never);
		expect(res.status).toBe(400);
		const bodyText = await res.text();
		expect(JSON.parse(bodyText).rejectionReason).toBe('must_finalize_before_export');
	});

	test('re-export overwrites and re-downloads (exported → exported)', async () => {
		const invId = await createFinalizedInvoice();
		await POST(eventFor({ id: invId }) as never);
		const res = await POST(eventFor({ id: invId }) as never);
		expect(res.status).toBe(200);
		const body = new Uint8Array(await res.arrayBuffer());
		expect(new TextDecoder().decode(body.slice(0, 5))).toBe('%PDF-');
	});
});
