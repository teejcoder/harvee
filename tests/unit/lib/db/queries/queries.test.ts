import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../../../../../src/lib/db';
import { createClient, getClient } from '../../../../../src/lib/db/queries/clients';
import { createProject, getProject } from '../../../../../src/lib/db/queries/projects';
import { createTask, getTask } from '../../../../../src/lib/db/queries/tasks';
import { createEntry, getEntry } from '../../../../../src/lib/db/queries/entries';
import { createSegment, getSegment } from '../../../../../src/lib/db/queries/segments';
import { createDraftInvoice, getInvoice } from '../../../../../src/lib/db/queries/invoices';
import {
	createDiscountLine,
	createTaskLine,
	listInvoiceLines
} from '../../../../../src/lib/db/queries/lineItems';
import { getSettings, updateSettings } from '../../../../../src/lib/db/queries/settings';

const CID = '01HXZ8K3M9Q2R7VYABCDEF1234';

let tmpDir: string;
let dbPath: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-q-'));
	dbPath = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

function readLogLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

describe('query modules — insert + read back per entity, camelCase mapping', () => {
	test('clients: create → get returns camelCase Client', () => {
		const db = openDb(dbPath, 'db/migrations');
		const created = createClient(db, { name: 'Acme' }, CID);
		const fetched = getClient(db, created.id);

		expect(fetched).toBeDefined();
		expect(fetched).toMatchObject({
			id: created.id,
			name: 'Acme',
			archivedAt: null
		});
		expect(typeof fetched!.createdAt).toBe('string');
		expect(typeof fetched!.updatedAt).toBe('string');
		expect(fetched).not.toHaveProperty('archived_at');

		db.close();
	});

	test('projects: create under a client → get returns camelCase with hourlyRate', () => {
		const db = openDb(dbPath, 'db/migrations');
		const client = createClient(db, { name: 'C' }, CID);
		const created = createProject(db, { clientId: client.id, name: 'P', hourlyRate: 12500 }, CID);
		const fetched = getProject(db, created.id);

		expect(fetched).toMatchObject({
			id: created.id,
			clientId: client.id,
			name: 'P',
			hourlyRate: 12500,
			archivedAt: null
		});
		expect(fetched).not.toHaveProperty('client_id');
		expect(fetched).not.toHaveProperty('hourly_rate');

		db.close();
	});

	test('tasks: create under a project → get returns camelCase with projectId', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'C' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
		const created = createTask(db, { projectId: p.id, name: 'T' }, CID);
		const fetched = getTask(db, created.id);

		expect(fetched).toMatchObject({
			id: created.id,
			projectId: p.id,
			name: 'T',
			archivedAt: null
		});
		expect(fetched).not.toHaveProperty('project_id');

		db.close();
	});

	test('entries: create draft → get returns camelCase with taskId, invoiceId null, editFormSnapshot null', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'C' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
		const t = createTask(db, { projectId: p.id, name: 'T' }, CID);
		const created = createEntry(db, { taskId: t.id, state: 'entry.draft' }, CID);
		const fetched = getEntry(db, created.id);

		expect(fetched).toMatchObject({
			id: created.id,
			taskId: t.id,
			notes: '',
			state: 'entry.draft',
			invoiceId: null,
			editFormSnapshot: null
		});
		expect(fetched).not.toHaveProperty('task_id');
		expect(fetched).not.toHaveProperty('invoice_id');
		expect(fetched).not.toHaveProperty('edit_form_snapshot');

		db.close();
	});

	test('segments: create → get returns camelCase with entryId, startedAt', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'C' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
		const t = createTask(db, { projectId: p.id, name: 'T' }, CID);
		const e = createEntry(db, { taskId: t.id, state: 'entry.running' }, CID);
		const created = createSegment(
			db,
			{ entryId: e.id, startedAt: '2026-07-11T10:00:00.000Z' },
			CID
		);
		const fetched = getSegment(db, created.id);

		expect(fetched).toMatchObject({
			id: created.id,
			entryId: e.id,
			startedAt: '2026-07-11T10:00:00.000Z',
			stoppedAt: null
		});
		expect(fetched).not.toHaveProperty('entry_id');
		expect(fetched).not.toHaveProperty('started_at');

		db.close();
	});

	test('invoices: create draft → get returns camelCase draft', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'C' }, CID);
		const inv = createDraftInvoice(
			db,
			{
				clientId: c.id,
				startDate: '2026-07-01',
				endDate: '2026-07-31',
				paymentTermsDays: 30,
				currencyCode: 'USD',
				currencyDecimals: 2,
				invoiceLocale: 'en-US',
				subtotal: 10000,
				discountTotal: 0,
				total: 10000
			},
			CID
		);
		const fetched = getInvoice(db, inv.id);

		expect(fetched).toMatchObject({
			id: inv.id,
			clientId: c.id,
			state: 'invoice.draft',
			invoiceNumber: null,
			paymentTermsDays: 30,
			currencyCode: 'USD',
			subtotal: 10000,
			discountTotal: 0,
			total: 10000,
			finalizedAt: null,
			voidedAt: null
		});
		expect(fetched).not.toHaveProperty('client_id');
		expect(fetched).not.toHaveProperty('invoice_number');
		expect(fetched).not.toHaveProperty('finalized_at');

		db.close();
	});

	test('lineItems: create task + discount → list returns both in sort order with camelCase', () => {
		const db = openDb(dbPath, 'db/migrations');
		const c = createClient(db, { name: 'C' }, CID);
		const p = createProject(db, { clientId: c.id, name: 'P', hourlyRate: 10000 }, CID);
		const t = createTask(db, { projectId: p.id, name: 'T' }, CID);
		const inv = createDraftInvoice(
			db,
			{
				clientId: c.id,
				startDate: '2026-07-01',
				endDate: '2026-07-31',
				paymentTermsDays: 30,
				currencyCode: 'USD',
				currencyDecimals: 2,
				invoiceLocale: 'en-US',
				subtotal: 10000,
				discountTotal: -500,
				total: 9500
			},
			CID
		);

		createTaskLine(
			db,
			{
				invoiceId: inv.id,
				taskId: t.id,
				description: 'Work',
				hours: 1.0,
				rate: 10000,
				amount: 10000,
				sortOrder: 0
			},
			CID
		);
		createDiscountLine(
			db,
			{ invoiceId: inv.id, description: 'Early-pay discount', amount: -500, sortOrder: 1 },
			CID
		);

		const lines = listInvoiceLines(db, inv.id);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({
			kind: 'task',
			taskId: t.id,
			hours: 1.0,
			rate: 10000,
			amount: 10000,
			sortOrder: 0
		});
		expect(lines[1]).toMatchObject({
			kind: 'discount',
			taskId: null,
			hours: null,
			rate: null,
			amount: -500,
			sortOrder: 1
		});
		expect(lines[0]).not.toHaveProperty('invoice_id');
		expect(lines[0]).not.toHaveProperty('sort_order');

		db.close();
	});

	test('settings: get → update → get returns camelCase Settings with new values', () => {
		const db = openDb(dbPath, 'db/migrations');
		const initial = getSettings(db);
		expect(initial.id).toBe(1);
		expect(initial.senderName).toBe('Your Name');
		expect(initial).not.toHaveProperty('sender_name');

		const updated = updateSettings(
			db,
			{
				senderName: 'T.J. Contract Dev',
				senderAddress: '1 Main St',
				senderEmail: 'teejcoder@gmail.com',
				senderPhone: null,
				paymentInstructions: 'Wire to X',
				currencyCode: 'USD',
				currencyDecimals: 2,
				defaultPaymentTermsDays: 15,
				invoiceLocale: 'en-US'
			},
			CID
		);
		expect(updated.senderName).toBe('T.J. Contract Dev');
		expect(updated.defaultPaymentTermsDays).toBe(15);

		const refetched = getSettings(db);
		expect(refetched).toEqual(updated);

		db.close();
	});
});

describe('query modules — correlationId enforcement', () => {
	test.each([
		[
			'createClient',
			(db: ReturnType<typeof openDb>) =>
				createClient(db, { name: 'X' }, undefined as unknown as string)
		],
		[
			'createProject',
			(db: ReturnType<typeof openDb>) =>
				createProject(
					db,
					{ clientId: 'nonexistent', name: 'X', hourlyRate: 1 },
					undefined as unknown as string
				)
		],
		[
			'createTask',
			(db: ReturnType<typeof openDb>) =>
				createTask(db, { projectId: 'nonexistent', name: 'X' }, undefined as unknown as string)
		],
		[
			'createEntry',
			(db: ReturnType<typeof openDb>) =>
				createEntry(
					db,
					{ taskId: 'nonexistent', state: 'entry.draft' },
					undefined as unknown as string
				)
		],
		[
			'createSegment',
			(db: ReturnType<typeof openDb>) =>
				createSegment(
					db,
					{ entryId: 'nonexistent', startedAt: '2026-07-11T10:00:00.000Z' },
					undefined as unknown as string
				)
		],
		[
			'createDraftInvoice',
			(db: ReturnType<typeof openDb>) =>
				createDraftInvoice(
					db,
					{
						clientId: 'nonexistent',
						startDate: '2026-07-01',
						endDate: '2026-07-31',
						paymentTermsDays: 30,
						currencyCode: 'USD',
						currencyDecimals: 2,
						invoiceLocale: 'en-US',
						subtotal: 0,
						discountTotal: 0,
						total: 0
					},
					undefined as unknown as string
				)
		],
		[
			'createTaskLine',
			(db: ReturnType<typeof openDb>) =>
				createTaskLine(
					db,
					{
						invoiceId: 'x',
						taskId: 'x',
						description: 'x',
						hours: 1,
						rate: 1,
						amount: 1,
						sortOrder: 0
					},
					undefined as unknown as string
				)
		],
		[
			'createDiscountLine',
			(db: ReturnType<typeof openDb>) =>
				createDiscountLine(
					db,
					{ invoiceId: 'x', description: 'x', amount: -1, sortOrder: 0 },
					undefined as unknown as string
				)
		],
		[
			'updateSettings',
			(db: ReturnType<typeof openDb>) =>
				updateSettings(
					db,
					{
						senderName: 'x',
						senderAddress: 'x',
						senderEmail: 'x',
						senderPhone: null,
						paymentInstructions: 'x',
						currencyCode: 'USD',
						currencyDecimals: 2,
						defaultPaymentTermsDays: 30,
						invoiceLocale: 'en-US'
					},
					undefined as unknown as string
				)
		]
	])('%s throws and logs an ERROR when called with undefined correlationId', (fnName, call) => {
		const db = openDb(dbPath, 'db/migrations');
		expect(() => call(db)).toThrow(/correlationId/i);

		const lines = readLogLines();
		const errorLine = lines.find(
			(l) => l.level === 'error' && l.event === 'db.query.missing_correlation_id'
		);
		expect(errorLine).toBeDefined();
		expect(errorLine!.function).toBe(fnName);

		db.close();
	});
});
