import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { nowUtcIso } from '../../time';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export interface Project {
	id: string;
	clientId: string;
	name: string;
	hourlyRate: number;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export function createProject(
	db: Database,
	args: { clientId: string; name: string; hourlyRate: number },
	correlationId: string
): Project {
	requireCorrelationId(correlationId, 'createProject');
	const id = ulid();
	const now = nowUtcIso();
	prep(
		db,
		`INSERT INTO projects (id, client_id, name, hourly_rate, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(id, args.clientId, args.name, args.hourlyRate, now, now);
	const created: Project = {
		id,
		clientId: args.clientId,
		name: args.name,
		hourlyRate: args.hourlyRate,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	log.info({
		event: 'project.create',
		correlationId,
		entityType: 'project',
		entityId: id,
		before: null,
		after: created
	});
	return created;
}

export function getProject(db: Database, id: string): Project | undefined {
	log.debug({ event: 'db.query.getProject', entityType: 'project', entityId: id });
	const row = prep(db, `SELECT * FROM projects WHERE id = ?`).get(id);
	return row ? rowToCamel<Project>(row) : undefined;
}
