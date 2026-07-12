import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { nowUtcIso } from '../../time';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export type EntryState =
	| 'entry.draft'
	| 'entry.running'
	| 'entry.stopped'
	| 'entry.editing'
	| 'entry.locked'
	| 'entry.discarded';

export interface TimeEntry {
	id: string;
	taskId: string;
	notes: string;
	state: EntryState;
	invoiceId: string | null;
	editFormSnapshot: string | null;
	createdAt: string;
	updatedAt: string;
}

export function createEntry(
	db: Database,
	args: { id?: string; taskId: string; notes?: string; state: EntryState },
	correlationId: string
): TimeEntry {
	requireCorrelationId(correlationId, 'createEntry');
	const id = args.id ?? ulid();
	const now = nowUtcIso();
	const notes = args.notes ?? '';
	prep(
		db,
		`INSERT INTO time_entries (id, task_id, notes, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(id, args.taskId, notes, args.state, now, now);
	const created: TimeEntry = {
		id,
		taskId: args.taskId,
		notes,
		state: args.state,
		invoiceId: null,
		editFormSnapshot: null,
		createdAt: now,
		updatedAt: now
	};
	log.info({
		event: 'entry.create',
		correlationId,
		entityType: 'timeEntry',
		entityId: id,
		before: null,
		after: created
	});
	return created;
}

export function getEntry(db: Database, id: string): TimeEntry | undefined {
	log.debug({ event: 'db.query.getEntry', entityType: 'timeEntry', entityId: id });
	const row = prep(db, `SELECT * FROM time_entries WHERE id = ?`).get(id);
	return row ? rowToCamel<TimeEntry>(row) : undefined;
}
