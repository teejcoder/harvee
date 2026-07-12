// Step 2.4 gate: a scripted scenario exercising every state machine end
// to end, asserting the transition-log emits the expected sequence of
// lines.
//
// Flow: createClient → createProject → createTask → pickTask →
// startTimer → stopTimer → openEdit → saveEdit → generateDraftInvoice →
// finalizeInvoice → (system: entry.stopped → entry.locked cascade)

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb } from '../../../../src/lib/db';
import { createClient } from '../../../../src/lib/state/client';
import { createProject } from '../../../../src/lib/state/project';
import { createTask } from '../../../../src/lib/state/task';
import {
	openEdit,
	pickTask,
	saveEdit,
	startTimer,
	stopTimer
} from '../../../../src/lib/state/entry';
import { finalizeInvoice, generateDraftInvoice } from '../../../../src/lib/state/invoice';

const CID = '01HXZ8K3M9Q2R7VYABCDEFETE1';

let tmpDir: string;
let dbPath: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-e2e-'));
	dbPath = join(tmpDir, 'data.sqlite');
	logFile = join(tmpDir, 'log.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
	vi.useRealTimers();
});

function transitionLines(): Record<string, unknown>[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l))
		.filter((l: Record<string, unknown>) => Object.hasOwn(l, 'previousState'));
}

describe('Step 2.4 — end-to-end scripted scenario', () => {
	test('the full pipeline emits the expected transition sequence', () => {
		const db = openDb(dbPath, 'db/migrations');

		// --- Setup ---
		const client = createClient(db, { name: 'Acme' }, CID);
		const project = createProject(
			db,
			{ clientId: client.id, name: 'Web build', hourlyRate: 12500 },
			CID
		);
		const task = createTask(db, { projectId: project.id, name: 'Auth work' }, CID);

		// --- Timer: two separate entries so the finalize cascade has N > 1 ---
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-10T14:00:00.000Z'));
		const entry1 = pickTask(db, { taskId: task.id, notes: 'oauth flow' }, CID);
		startTimer(db, entry1.id, CID);
		vi.setSystemTime(new Date('2026-07-10T15:30:00.000Z'));
		stopTimer(db, entry1.id, CID);

		vi.setSystemTime(new Date('2026-07-10T16:00:00.000Z'));
		const entry2 = pickTask(db, { taskId: task.id, notes: 'jwt fixes' }, CID);
		startTimer(db, entry2.id, CID);
		vi.setSystemTime(new Date('2026-07-10T17:00:00.000Z'));
		stopTimer(db, entry2.id, CID);
		vi.useRealTimers();

		// --- Edit + save (no-op edit on entry1; segments unchanged) ---
		openEdit(db, entry1.id, CID);
		saveEdit(db, entry1.id, CID);

		// --- Invoice ---
		const invoice = generateDraftInvoice(
			db,
			{ clientId: client.id, startDate: '2026-07-01', endDate: '2026-07-31' },
			CID
		);
		finalizeInvoice(db, invoice.id, CID);

		// --- Verify the transition-log sequence ---
		// Expected in order — actor.type indicated in parens.
		//  1. — → client.active            user.createClient          (user)
		//  2. — → project.active           user.createProject         (user)
		//  3. — → task.active              user.createTask            (user)
		//  4. — → entry.draft              user.pickTask              (user)   ← entry1
		//  5. entry.draft → running        user.startTimer            (user)
		//  6. running → stopped            user.stopTimer             (user)
		//  7. — → entry.draft              user.pickTask              (user)   ← entry2
		//  8. entry.draft → running        user.startTimer            (user)
		//  9. running → stopped            user.stopTimer             (user)
		// 10. stopped → editing            user.openEdit              (user)   ← entry1 edit
		// 11. editing → stopped            user.saveEdit              (user)
		// 12. — → invoice.draft            user.generateInvoice       (user)
		// 13. stopped → locked             system.invoiceFinalize     (system) ← entry1 or entry2
		// 14. stopped → locked             system.invoiceFinalize     (system) ← the other entry
		// 15. invoice.draft → finalized    user.finalizeInvoice       (user)   ← after cascade
		const lines = transitionLines();
		const summary = lines.map((l) => ({
			previousState: l.previousState,
			newState: l.newState,
			trigger: l.trigger,
			actorType: (l.actor as { type: string }).type,
			accepted: l.accepted
		}));

		expect(summary).toEqual([
			{
				previousState: null,
				newState: 'client.active',
				trigger: 'user.createClient',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: null,
				newState: 'project.active',
				trigger: 'user.createProject',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: null,
				newState: 'task.active',
				trigger: 'user.createTask',
				actorType: 'user',
				accepted: true
			},
			// entry1: pick → start → stop
			{
				previousState: null,
				newState: 'entry.draft',
				trigger: 'user.pickTask',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: 'entry.draft',
				newState: 'entry.running',
				trigger: 'user.startTimer',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: 'entry.running',
				newState: 'entry.stopped',
				trigger: 'user.stopTimer',
				actorType: 'user',
				accepted: true
			},
			// entry2: pick → start → stop
			{
				previousState: null,
				newState: 'entry.draft',
				trigger: 'user.pickTask',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: 'entry.draft',
				newState: 'entry.running',
				trigger: 'user.startTimer',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: 'entry.running',
				newState: 'entry.stopped',
				trigger: 'user.stopTimer',
				actorType: 'user',
				accepted: true
			},
			// entry1 edit round-trip
			{
				previousState: 'entry.stopped',
				newState: 'entry.editing',
				trigger: 'user.openEdit',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: 'entry.editing',
				newState: 'entry.stopped',
				trigger: 'user.saveEdit',
				actorType: 'user',
				accepted: true
			},
			// invoice generation + finalize cascade
			{
				previousState: null,
				newState: 'invoice.draft',
				trigger: 'user.generateInvoice',
				actorType: 'user',
				accepted: true
			},
			{
				previousState: 'entry.stopped',
				newState: 'entry.locked',
				trigger: 'system.invoiceFinalize',
				actorType: 'system',
				accepted: true
			},
			{
				previousState: 'entry.stopped',
				newState: 'entry.locked',
				trigger: 'system.invoiceFinalize',
				actorType: 'system',
				accepted: true
			},
			{
				previousState: 'invoice.draft',
				newState: 'invoice.finalized',
				trigger: 'user.finalizeInvoice',
				actorType: 'user',
				accepted: true
			}
		]);

		// The two entry.locked cascade lines carry the same correlationId as
		// the outer user.finalizeInvoice — the "N cascade lines share one CID"
		// invariant from state-transitions.md §Structured Transition Log.
		const cascadeLockLines = lines.filter(
			(l) => l.trigger === 'system.invoiceFinalize' && l.accepted === true
		);
		expect(cascadeLockLines).toHaveLength(2);
		const distinctLockedEntryIds = new Set(cascadeLockLines.map((l) => l.entityId));
		expect(distinctLockedEntryIds.size).toBe(2);

		// Every line carries the same correlationId (this scenario uses one CID).
		for (const line of lines) expect(line.correlationId).toBe(CID);

		// Every accepted line has rejectionReason: null; every entityId is a ULID.
		const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
		for (const line of lines) {
			expect(line.accepted).toBe(true);
			expect(line.rejectionReason).toBeNull();
			expect(line.entityId).toMatch(ULID);
		}

		db.close();
	});
});
