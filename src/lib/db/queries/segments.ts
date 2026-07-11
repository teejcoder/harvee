import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export interface Segment {
	id: string;
	entryId: string;
	startedAt: string;
	stoppedAt: string | null;
}

export function createSegment(
	db: Database,
	args: { entryId: string; startedAt: string; stoppedAt?: string | null },
	correlationId: string
): Segment {
	requireCorrelationId(correlationId, 'createSegment');
	const id = ulid();
	const stoppedAt = args.stoppedAt ?? null;
	prep(
		db,
		`INSERT INTO time_entry_segments (id, entry_id, started_at, stopped_at)
		 VALUES (?, ?, ?, ?)`
	).run(id, args.entryId, args.startedAt, stoppedAt);
	const created: Segment = {
		id,
		entryId: args.entryId,
		startedAt: args.startedAt,
		stoppedAt
	};
	log.info({
		event: 'segment.create',
		correlationId,
		entityType: 'segment',
		entityId: id,
		before: null,
		after: created
	});
	return created;
}

export function getSegment(db: Database, id: string): Segment | undefined {
	log.debug({ event: 'db.query.getSegment', entityType: 'segment', entityId: id });
	const row = prep(db, `SELECT * FROM time_entry_segments WHERE id = ?`).get(id);
	return row ? rowToCamel<Segment>(row) : undefined;
}
