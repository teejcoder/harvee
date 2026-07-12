// Steps 6.1–6.5 and 6.7 gates — invoice generation, edit, finalize, void.
// Step 6.6 (PDF export) is covered separately.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetDbCacheForTests, getDb } from '../../../../src/lib/db';
import { ulid } from '../../../../src/lib/ids';
import { actions as clientActions } from '../../../../src/routes/clients/[id]/+page.server';
import { actions as invoiceActions } from '../../../../src/routes/invoices/[id]/+page.server';

const CID = '01HXZ8K3M9Q2R7VYABCDEFINV1';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-inv-'));
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
	vi.useRealTimers();
});

function eventFor(
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

describe('Step 6.1 — generate draft invoice', () => {
	test('redirects to /invoices/[id] on success', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		let redirected: { status: number; location: string } | undefined;
		try {
			await clientActions.generateInvoice(
				eventFor(
					`/clients/${clientId}?/generateInvoice`,
					{ id: clientId },
					{ startDate: '2026-07-01', endDate: '2026-07-31' }
				) as never
			);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
				redirected = err as { status: number; location: string };
			}
		}
		expect(redirected).toBeDefined();
		expect(redirected!.status).toBe(303);
		expect(redirected!.location).toMatch(/^\/invoices\/[0-9A-HJKMNP-TV-Z]{26}$/);

		const inv = getDb()
			.prepare(`SELECT state, subtotal, total FROM invoices LIMIT 1`)
			.get() as { state: string; subtotal: number; total: number };
		expect(inv.state).toBe('invoice.draft');
		expect(inv.subtotal).toBe(12500); // 1h × 12500 minor units
		expect(inv.total).toBe(12500);
	});
});

describe('Step 6.2 — no_billable_entries rejection', () => {
	test('client with no unbilled entries → 400 with rejectionReason=no_billable_entries', async () => {
		getDb().exec(
			`INSERT INTO clients (id, name, created_at, updated_at) VALUES ('c1', 'Empty', 'now', 'now')`
		);
		const result = (await clientActions.generateInvoice(
			eventFor(
				'/clients/c1?/generateInvoice',
				{ id: 'c1' },
				{ startDate: '2026-07-01', endDate: '2026-07-31' }
			) as never
		)) as { status: number; data: { rejectionReason: string } };
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('no_billable_entries');
	});
});

async function createDraft(clientId: string): Promise<string> {
	let redirected: { location: string } | undefined;
	try {
		await clientActions.generateInvoice(
			eventFor(
				`/clients/${clientId}?/generateInvoice`,
				{ id: clientId },
				{ startDate: '2026-07-01', endDate: '2026-07-31' }
			) as never
		);
	} catch (err) {
		redirected = err as { location: string };
	}
	return redirected!.location.split('/').at(-1)!;
}

describe('Step 6.3 — edit draft (discount lines)', () => {
	test('addDiscount then removeDiscount round-trips totals', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		const invId = await createDraft(clientId);

		await invoiceActions.addDiscount(
			eventFor(
				`/invoices/${invId}?/addDiscount`,
				{ id: invId },
				{ description: 'Early', amount: '5' }
			) as never
		);
		const withDiscount = getDb()
			.prepare(`SELECT discount_total, total FROM invoices WHERE id = ?`)
			.get(invId) as { discount_total: number; total: number };
		expect(withDiscount.discount_total).toBe(-500);
		expect(withDiscount.total).toBe(12000);

		await invoiceActions.removeDiscount(
			eventFor(`/invoices/${invId}?/removeDiscount`, { id: invId }) as never
		);
		const cleared = getDb()
			.prepare(`SELECT discount_total, total FROM invoices WHERE id = ?`)
			.get(invId) as { discount_total: number; total: number };
		expect(cleared.discount_total).toBe(0);
		expect(cleared.total).toBe(12500);
	});

	test('addDiscount twice → 400 with rejectionReason=invalid_discount_line', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		const invId = await createDraft(clientId);

		await invoiceActions.addDiscount(
			eventFor(
				`/invoices/${invId}?/addDiscount`,
				{ id: invId },
				{ description: 'D1', amount: '1' }
			) as never
		);
		const result = (await invoiceActions.addDiscount(
			eventFor(
				`/invoices/${invId}?/addDiscount`,
				{ id: invId },
				{ description: 'D2', amount: '1' }
			) as never
		)) as { status: number; data: { rejectionReason: string } };
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('invalid_discount_line');
	});
});

describe('Steps 6.4 / 6.5 — finalize + guards', () => {
	test('finalize assigns invoice_number and cascades entries to entry.locked', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		const invId = await createDraft(clientId);

		await invoiceActions.finalize(eventFor(`/invoices/${invId}?/finalize`, { id: invId }) as never);
		const inv = getDb()
			.prepare(`SELECT state, invoice_number FROM invoices WHERE id = ?`)
			.get(invId) as { state: string; invoice_number: string };
		expect(inv.state).toBe('invoice.finalized');
		expect(inv.invoice_number).toMatch(/^\d{8}-\d+$/);

		const locked = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE state = 'entry.locked'`)
			.get() as { n: number };
		expect(locked.n).toBe(1);
	});

	test('finalize with total <= 0 → 400 with rejectionReason=invoice_non_positive_total', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		const invId = await createDraft(clientId);
		// Discount equal to subtotal → total = 0
		await invoiceActions.addDiscount(
			eventFor(
				`/invoices/${invId}?/addDiscount`,
				{ id: invId },
				{ description: 'Full', amount: '125' }
			) as never
		);
		const result = (await invoiceActions.finalize(
			eventFor(`/invoices/${invId}?/finalize`, { id: invId }) as never
		)) as { status: number; data: { rejectionReason: string } };
		expect(result.status).toBe(400);
		expect(result.data.rejectionReason).toBe('invoice_non_positive_total');
	});
});

describe('Step 6.7 — void cascade', () => {
	test('voidInvoice cascades locked entries → discarded under a single correlationId', async () => {
		const { clientId } = seedClientWithStoppedEntry();
		const invId = await createDraft(clientId);
		await invoiceActions.finalize(eventFor(`/invoices/${invId}?/finalize`, { id: invId }) as never);

		const VOID_CID = '01HXZ8K3M9Q2R7VYABCDEFVOID';
		await invoiceActions.void(
			eventFor(`/invoices/${invId}?/void`, { id: invId }, {}, VOID_CID) as never
		);

		const inv = getDb()
			.prepare(`SELECT state FROM invoices WHERE id = ?`)
			.get(invId) as { state: string };
		expect(inv.state).toBe('invoice.voided');
		const discarded = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE state = 'entry.discarded'`)
			.get() as { n: number };
		expect(discarded.n).toBe(1);

		const voidCascade = transitionLines().filter((l) => l.correlationId === VOID_CID);
		const invoiceLine = voidCascade.find(
			(l) => l.trigger === 'user.voidInvoice' && l.accepted === true
		);
		const unlockLines = voidCascade.filter(
			(l) => l.trigger === 'system.invoiceVoid' && l.accepted === true
		);
		expect(invoiceLine).toBeDefined();
		expect(unlockLines).toHaveLength(1);
	});
});
