import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { nowUtcIso } from '../../time';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export interface Task {
	id: string;
	projectId: string;
	name: string;
	description: string;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export function createTask(
	db: Database,
	args: { id?: string; projectId: string; name: string; description?: string },
	correlationId: string
): Task {
	requireCorrelationId(correlationId, 'createTask');
	const id = args.id ?? ulid();
	const description = args.description ?? '';
	const now = nowUtcIso();
	prep(
		db,
		`INSERT INTO tasks (id, project_id, name, description, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(id, args.projectId, args.name, description, now, now);
	const created: Task = {
		id,
		projectId: args.projectId,
		name: args.name,
		description,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	log.info({
		event: 'task.create',
		correlationId,
		entityType: 'task',
		entityId: id,
		before: null,
		after: created
	});
	return created;
}

export function getTask(db: Database, id: string): Task | undefined {
	log.debug({ event: 'db.query.getTask', entityType: 'task', entityId: id });
	const row = prep(db, `SELECT * FROM tasks WHERE id = ?`).get(id);
	return row ? rowToCamel<Task>(row) : undefined;
}
