// Time entry lifecycle per .memory/state-transitions.md §2.
// Multi-segment resume model. Every operation emits a logTransition line
// (accepted or rejected) matching the schema.
//
// System-triggered ops (lockEntry, unlockToDiscarded) are called by the
// invoice state machine in Step 2.3.

import type { Database } from 'better-sqlite3';
import * as entriesQ from '../db/queries/entries';
import * as tasksQ from '../db/queries/tasks';
import type { EntryState } from '../db/queries/entries';
import { ulid } from '../ids';
import { log, logTransition } from '../log';
import { nowUtcIso } from '../time';
import { StateTransitionError } from './_error';

const USER_ACTOR = { type: 'user' as const, id: 'user_teej' };
const SYSTEM_FINALIZE = { type: 'system' as const, id: 'system.invoiceFinalize' };
const SYSTEM_VOID = { type: 'system' as const, id: 'system.invoiceVoid' };

interface Segment {
	id: string;
	entryId: string;
	startedAt: string;
	stoppedAt: string | null;
}

function currentState(
	db: Database,
	entryId: string
): { state: EntryState; entry: entriesQ.TimeEntry } {
	const entry = entriesQ.getEntry(db, entryId);
	if (!entry) throw new Error(`time entry ${entryId} not found`);
	return { state: entry.state, entry };
}

function segmentsOf(db: Database, entryId: string): Segment[] {
	return db
		.prepare(
			`SELECT id, entry_id AS entryId, started_at AS startedAt, stopped_at AS stoppedAt FROM time_entry_segments WHERE entry_id = ? ORDER BY started_at`
		)
		.all(entryId) as Segment[];
}

// ------------------------------------------------------------
// pickTask — create an entry.draft against a task
// ------------------------------------------------------------

export function pickTask(
	db: Database,
	args: { taskId: string; notes?: string },
	correlationId: string
): entriesQ.TimeEntry {
	log.debug({ event: 'state.entry.pickTask.enter', correlationId, taskId: args.taskId });

	const task = tasksQ.getTask(db, args.taskId);
	if (!task) throw new Error(`task ${args.taskId} not found`);
	const id = ulid();

	if (task.archivedAt) {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: id,
			previousState: null,
			newState: 'entry.draft',
			trigger: 'user.pickTask',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'task_archived'
		});
		throw new StateTransitionError('task_archived', `task ${args.taskId} is archived`);
	}

	const created = entriesQ.createEntry(
		db,
		{ id, taskId: args.taskId, notes: args.notes, state: 'entry.draft' },
		correlationId
	);
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: id,
		previousState: null,
		newState: 'entry.draft',
		trigger: 'user.pickTask',
		actor: USER_ACTOR,
		accepted: true
	});
	return created;
}

// ------------------------------------------------------------
// startTimer — entry.draft OR entry.stopped → entry.running
// ------------------------------------------------------------

export function startTimer(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.start.enter', correlationId, entityId: entryId });
	const { state: before, entry } = currentState(db, entryId);

	// entry.locked is the only §2-recognized rejection reason for "cannot start
	// this entry"; any other invalid state (running/editing/discarded) is a
	// programmer error at the call site and gets a plain Error.
	if (before === 'entry.locked') {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.running',
			trigger: 'user.startTimer',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'entry_locked_by_invoice'
		});
		throw new StateTransitionError(
			'entry_locked_by_invoice',
			`entry ${entryId} is locked; cannot start`
		);
	}
	if (before !== 'entry.draft' && before !== 'entry.stopped') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot start`);
	}

	// Reject if task is archived.
	const task = tasksQ.getTask(db, entry.taskId);
	if (task?.archivedAt) {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.running',
			trigger: 'user.startTimer',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'task_archived'
		});
		throw new StateTransitionError('task_archived', `task ${entry.taskId} is archived`);
	}

	// Reject if any OTHER entry is running.
	const otherRunning = db
		.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE state = 'entry.running' AND id != ?`)
		.get(entryId) as { n: number };
	if (otherRunning.n > 0) {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.running',
			trigger: 'user.startTimer',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'concurrent_timer_forbidden'
		});
		throw new StateTransitionError(
			'concurrent_timer_forbidden',
			`another entry is already running`
		);
	}

	const now = nowUtcIso();
	const segmentId = ulid();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at) VALUES (?, ?, ?, NULL)`
		).run(segmentId, entryId, now);
		db.prepare(`UPDATE time_entries SET state = 'entry.running', updated_at = ? WHERE id = ?`).run(
			now,
			entryId
		);
	})();

	log.info({
		event: 'entry.start',
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		before: { state: before },
		after: { state: 'entry.running', segmentId, startedAt: now }
	});
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: before,
		newState: 'entry.running',
		trigger: 'user.startTimer',
		actor: USER_ACTOR,
		accepted: true
	});
}

// ------------------------------------------------------------
// stopTimer — entry.running → entry.stopped
// ------------------------------------------------------------

export function stopTimer(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.stop.enter', correlationId, entityId: entryId });
	const { state: before } = currentState(db, entryId);
	if (before === 'entry.locked') {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.stopped',
			trigger: 'user.stopTimer',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'entry_locked_by_invoice'
		});
		throw new StateTransitionError(
			'entry_locked_by_invoice',
			`entry ${entryId} is locked; cannot stop`
		);
	}
	if (before !== 'entry.running') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot stop`);
	}

	const now = nowUtcIso();
	db.transaction(() => {
		db.prepare(
			`UPDATE time_entry_segments SET stopped_at = ? WHERE entry_id = ? AND stopped_at IS NULL`
		).run(now, entryId);
		db.prepare(`UPDATE time_entries SET state = 'entry.stopped', updated_at = ? WHERE id = ?`).run(
			now,
			entryId
		);
	})();

	log.info({
		event: 'entry.stop',
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		before: { state: 'entry.running' },
		after: { state: 'entry.stopped', stoppedAt: now }
	});
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: 'entry.running',
		newState: 'entry.stopped',
		trigger: 'user.stopTimer',
		actor: USER_ACTOR,
		accepted: true
	});
}

// ------------------------------------------------------------
// openEdit / saveEdit / cancelEdit
// ------------------------------------------------------------

export function openEdit(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.openEdit.enter', correlationId, entityId: entryId });
	const { state: before } = currentState(db, entryId);
	if (before === 'entry.locked') {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.editing',
			trigger: 'user.openEdit',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'entry_locked_by_invoice'
		});
		throw new StateTransitionError('entry_locked_by_invoice', `entry ${entryId} is locked`);
	}
	if (before === 'entry.running') {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.editing',
			trigger: 'user.openEdit',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'cannot_edit_running_entry'
		});
		throw new StateTransitionError(
			'cannot_edit_running_entry',
			`stop entry ${entryId} before editing`
		);
	}
	if (before !== 'entry.stopped') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot open edit`);
	}

	const snapshot = JSON.stringify(segmentsOf(db, entryId));
	const now = nowUtcIso();
	db.prepare(
		`UPDATE time_entries SET state = 'entry.editing', edit_form_snapshot = ?, updated_at = ? WHERE id = ?`
	).run(snapshot, now, entryId);

	log.info({
		event: 'entry.openEdit',
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		before: { state: 'entry.stopped' },
		after: { state: 'entry.editing' }
	});
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: 'entry.stopped',
		newState: 'entry.editing',
		trigger: 'user.openEdit',
		actor: USER_ACTOR,
		accepted: true
	});
}

export function saveEdit(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.saveEdit.enter', correlationId, entityId: entryId });
	const { state: before } = currentState(db, entryId);
	if (before !== 'entry.editing') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot save edit`);
	}
	const now = nowUtcIso();
	db.prepare(
		`UPDATE time_entries SET state = 'entry.stopped', edit_form_snapshot = NULL, updated_at = ? WHERE id = ?`
	).run(now, entryId);
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: 'entry.editing',
		newState: 'entry.stopped',
		trigger: 'user.saveEdit',
		actor: USER_ACTOR,
		accepted: true
	});
}

export function cancelEdit(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.cancelEdit.enter', correlationId, entityId: entryId });
	const { state: before, entry } = currentState(db, entryId);
	if (before !== 'entry.editing') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot cancel`);
	}
	const snapshot: Segment[] = entry.editFormSnapshot ? JSON.parse(entry.editFormSnapshot) : [];
	const now = nowUtcIso();
	db.transaction(() => {
		db.prepare(`DELETE FROM time_entry_segments WHERE entry_id = ?`).run(entryId);
		const insertStmt = db.prepare(
			`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at) VALUES (?, ?, ?, ?)`
		);
		for (const seg of snapshot) {
			insertStmt.run(seg.id, seg.entryId, seg.startedAt, seg.stoppedAt);
		}
		db.prepare(
			`UPDATE time_entries SET state = 'entry.stopped', edit_form_snapshot = NULL, updated_at = ? WHERE id = ?`
		).run(now, entryId);
	})();
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: 'entry.editing',
		newState: 'entry.stopped',
		trigger: 'user.cancelEdit',
		actor: USER_ACTOR,
		accepted: true
	});
}

// ------------------------------------------------------------
// Resume — entry.stopped → entry.running, opens a NEW segment
// ------------------------------------------------------------

export function resumeEntry(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.resume.enter', correlationId, entityId: entryId });
	const { state: before } = currentState(db, entryId);
	if (before === 'entry.locked') {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.running',
			trigger: 'user.resumeEntry',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'entry_locked_by_invoice'
		});
		throw new StateTransitionError(
			'entry_locked_by_invoice',
			`entry ${entryId} is locked; cannot resume`
		);
	}
	if (before !== 'entry.stopped') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot resume`);
	}

	const otherRunning = db
		.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE state = 'entry.running' AND id != ?`)
		.get(entryId) as { n: number };
	if (otherRunning.n > 0) {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.running',
			trigger: 'user.resumeEntry',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'concurrent_timer_forbidden'
		});
		throw new StateTransitionError('concurrent_timer_forbidden', 'another entry is running');
	}

	const now = nowUtcIso();
	const segmentId = ulid();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at) VALUES (?, ?, ?, NULL)`
		).run(segmentId, entryId, now);
		db.prepare(`UPDATE time_entries SET state = 'entry.running', updated_at = ? WHERE id = ?`).run(
			now,
			entryId
		);
	})();

	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: 'entry.stopped',
		newState: 'entry.running',
		trigger: 'user.resumeEntry',
		actor: USER_ACTOR,
		accepted: true
	});
}

// ------------------------------------------------------------
// Segment editing
// ------------------------------------------------------------

export function updateSegment(
	db: Database,
	args: { segmentId: string; startedAt: string; stoppedAt: string | null },
	correlationId: string
): void {
	log.debug({ event: 'state.entry.updateSegment.enter', correlationId, ...args });
	const seg = db
		.prepare(
			`SELECT id, entry_id AS entryId, started_at AS startedAt, stopped_at AS stoppedAt FROM time_entry_segments WHERE id = ?`
		)
		.get(args.segmentId) as Segment | undefined;
	if (!seg) throw new Error(`segment ${args.segmentId} not found`);

	const { state: entryState } = currentState(db, seg.entryId);
	if (entryState === 'entry.locked') {
		log.warn({
			event: 'segment.update.rejected',
			correlationId,
			entityType: 'segment',
			entityId: args.segmentId,
			rejectionReason: 'entry_locked_by_invoice'
		});
		throw new StateTransitionError('entry_locked_by_invoice', `parent entry is locked`);
	}

	if (args.stoppedAt !== null && args.stoppedAt < args.startedAt) {
		log.warn({
			event: 'segment.update.rejected',
			correlationId,
			entityType: 'segment',
			entityId: args.segmentId,
			rejectionReason: 'invalid_time_range'
		});
		throw new StateTransitionError('invalid_time_range', `stoppedAt < startedAt`);
	}

	// Overlap check: any OTHER segment of the same entry whose interval
	// intersects [startedAt, stoppedAt).
	const others = db
		.prepare(
			`SELECT id, started_at AS startedAt, stopped_at AS stoppedAt FROM time_entry_segments WHERE entry_id = ? AND id != ?`
		)
		.all(seg.entryId, args.segmentId) as {
		id: string;
		startedAt: string;
		stoppedAt: string | null;
	}[];
	const newStop = args.stoppedAt ?? '9999-12-31T23:59:59.999Z';
	for (const o of others) {
		const oStop = o.stoppedAt ?? '9999-12-31T23:59:59.999Z';
		if (args.startedAt < oStop && o.startedAt < newStop) {
			log.warn({
				event: 'segment.update.rejected',
				correlationId,
				entityType: 'segment',
				entityId: args.segmentId,
				rejectionReason: 'segment_overlap',
				overlappedSegmentId: o.id
			});
			throw new StateTransitionError('segment_overlap', `overlaps segment ${o.id}`);
		}
	}

	db.prepare(`UPDATE time_entry_segments SET started_at = ?, stopped_at = ? WHERE id = ?`).run(
		args.startedAt,
		args.stoppedAt,
		args.segmentId
	);
	log.info({
		event: 'segment.update',
		correlationId,
		entityType: 'segment',
		entityId: args.segmentId,
		before: seg,
		after: { ...seg, startedAt: args.startedAt, stoppedAt: args.stoppedAt }
	});
}

// ------------------------------------------------------------
// Discard — draft OR stopped → discarded
// ------------------------------------------------------------

export function discardEntry(db: Database, entryId: string, correlationId: string): void {
	log.debug({ event: 'state.entry.discard.enter', correlationId, entityId: entryId });
	const { state: before } = currentState(db, entryId);
	if (before === 'entry.locked') {
		logTransition({
			correlationId,
			entityType: 'timeEntry',
			entityId: entryId,
			previousState: before,
			newState: 'entry.discarded',
			trigger: 'user.discardEntry',
			actor: USER_ACTOR,
			accepted: false,
			rejectionReason: 'entry_locked_by_invoice'
		});
		throw new StateTransitionError('entry_locked_by_invoice', `entry ${entryId} is locked`);
	}
	if (before !== 'entry.draft' && before !== 'entry.stopped') {
		throw new Error(`entry ${entryId} is in state ${before}; cannot discard`);
	}
	const now = nowUtcIso();
	db.prepare(`UPDATE time_entries SET state = 'entry.discarded', updated_at = ? WHERE id = ?`).run(
		now,
		entryId
	);
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: before,
		newState: 'entry.discarded',
		trigger: 'user.discardEntry',
		actor: USER_ACTOR,
		accepted: true
	});
}

// ------------------------------------------------------------
// System-triggered ops — called by the invoice state machine
// ------------------------------------------------------------

export function lockEntry(
	db: Database,
	args: { entryId: string; invoiceId: string },
	correlationId: string
): void {
	const { state: before } = currentState(db, args.entryId);
	if (before !== 'entry.stopped') {
		throw new Error(`entry ${args.entryId} not in stopped state; cannot lock`);
	}
	const now = nowUtcIso();
	db.prepare(
		`UPDATE time_entries SET state = 'entry.locked', invoice_id = ?, updated_at = ? WHERE id = ?`
	).run(args.invoiceId, now, args.entryId);
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: args.entryId,
		previousState: 'entry.stopped',
		newState: 'entry.locked',
		trigger: 'system.invoiceFinalize',
		actor: SYSTEM_FINALIZE,
		accepted: true
	});
}

export function unlockToDiscarded(db: Database, entryId: string, correlationId: string): void {
	const { state: before } = currentState(db, entryId);
	if (before !== 'entry.locked') {
		throw new Error(`entry ${entryId} not in locked state; cannot unlock to discarded`);
	}
	const now = nowUtcIso();
	db.prepare(
		`UPDATE time_entries SET state = 'entry.discarded', invoice_id = NULL, updated_at = ? WHERE id = ?`
	).run(now, entryId);
	logTransition({
		correlationId,
		entityType: 'timeEntry',
		entityId: entryId,
		previousState: 'entry.locked',
		newState: 'entry.discarded',
		trigger: 'system.invoiceVoid',
		actor: SYSTEM_VOID,
		accepted: true
	});
}
