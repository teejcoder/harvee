import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'harvest-log-'));
	logFile = join(tmpDir, 'transitions.jsonl');
	process.env.LOG_PATH = logFile;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.LOG_PATH;
});

function readLines(): unknown[] {
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

describe('log.<level>()', () => {
	test('every level appends a JSON line with timestamp + level + event', async () => {
		const { log } = await import('../../../src/lib/log');
		log.debug({ event: 'db.query', correlationId: 'corr-1' });
		log.info({ event: 'entry.start', correlationId: 'corr-1' });
		log.warn({ event: 'db.slow', correlationId: 'corr-1' });
		log.error({ event: 'db.fail', correlationId: 'corr-1' });

		const lines = readLines() as Record<string, unknown>[];
		expect(lines).toHaveLength(4);
		const levels = lines.map((l) => l.level);
		expect(levels).toEqual(['debug', 'info', 'warn', 'error']);

		for (const line of lines) {
			expect(typeof line.timestamp).toBe('string');
			expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			expect(typeof line.event).toBe('string');
			expect(typeof line.level).toBe('string');
		}
	});

	test('correlationId is optional on read paths', async () => {
		const { log } = await import('../../../src/lib/log');
		log.debug({ event: 'page.load' }); // no correlationId — allowed for GETs

		const [line] = readLines() as Record<string, unknown>[];
		expect(line.event).toBe('page.load');
		expect(line.correlationId).toBeUndefined();
	});
});

describe('logTransition()', () => {
	test('accepted transition writes previousState/newState/accepted with rejectionReason null', async () => {
		const { logTransition } = await import('../../../src/lib/log');
		logTransition({
			correlationId: '01HXZ8K3M9Q2R7VYABCDEF1234',
			entityType: 'timeEntry',
			entityId: '01HXZ8K3M9Q2R7VYABCDEF9999',
			previousState: 'entry.running',
			newState: 'entry.stopped',
			trigger: 'user.stopTimer',
			actor: { type: 'user', id: 'user_teej' },
			accepted: true
		});

		const [line] = readLines() as Record<string, unknown>[];
		expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(line.previousState).toBe('entry.running');
		expect(line.newState).toBe('entry.stopped');
		expect(line.accepted).toBe(true);
		expect(line.rejectionReason).toBeNull();
		expect(line.correlationId).toBe('01HXZ8K3M9Q2R7VYABCDEF1234');
	});

	test('rejected transition writes rejectionReason from the canonical list', async () => {
		const { logTransition, REJECTION_REASONS } = await import('../../../src/lib/log');
		logTransition({
			correlationId: '01HXZ7A1B2C3D4E5F6G7H8J9K0',
			entityType: 'timeEntry',
			entityId: '01HXZ7A1B2C3D4E5F6G7H8AAAA',
			previousState: 'entry.draft',
			newState: 'entry.running',
			trigger: 'user.startTimer',
			actor: { type: 'user', id: 'user_teej' },
			accepted: false,
			rejectionReason: 'concurrent_timer_forbidden'
		});

		const [line] = readLines() as Record<string, unknown>[];
		expect(line.accepted).toBe(false);
		expect(line.rejectionReason).toBe('concurrent_timer_forbidden');
		expect(REJECTION_REASONS).toContain(line.rejectionReason);
	});

	test('all lines share a file with general log lines', async () => {
		const { log, logTransition } = await import('../../../src/lib/log');
		log.info({ event: 'app.boot', correlationId: 'corr-x' });
		logTransition({
			correlationId: 'corr-x',
			entityType: 'invoice',
			entityId: 'inv-1',
			previousState: 'invoice.draft',
			newState: 'invoice.finalized',
			trigger: 'user.finalizeInvoice',
			actor: { type: 'user', id: 'user_teej' },
			accepted: true
		});

		const lines = readLines() as Record<string, unknown>[];
		expect(lines).toHaveLength(2);
		expect(lines[0].previousState).toBeUndefined();
		expect(lines[1].previousState).toBe('invoice.draft');
	});
});
