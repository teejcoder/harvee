// Task lifecycle per .memory/state-transitions.md §1.

import type { Database } from 'better-sqlite3';
import * as tasksQ from '../db/queries/tasks';
import * as projectsQ from '../db/queries/projects';
import { ulid } from '../ids';
import { log, logTransition } from '../log';
import { nowUtcIso } from '../time';
import { StateTransitionError } from './_error';

export type TaskState = 'task.active' | 'task.archived' | 'task.deleted';

const ACTOR = { type: 'user' as const, id: 'user_teej' };

function stateOf(row: { archivedAt: string | null }): 'task.active' | 'task.archived' {
	return row.archivedAt ? 'task.archived' : 'task.active';
}

export function createTask(
	db: Database,
	args: { projectId: string; name: string },
	correlationId: string
): tasksQ.Task {
	log.debug({ event: 'state.task.create.enter', correlationId, ...args });

	const parent = projectsQ.getProject(db, args.projectId);
	if (!parent) throw new Error(`parent project ${args.projectId} not found`);

	const id = ulid();

	if (parent.archivedAt) {
		logTransition({
			correlationId,
			entityType: 'task',
			entityId: id,
			previousState: null,
			newState: 'task.active',
			trigger: 'user.createTask',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'parent_archived'
		});
		throw new StateTransitionError(
			'parent_archived',
			`project ${args.projectId} is archived; cannot create task`
		);
	}

	const created = tasksQ.createTask(db, { id, ...args }, correlationId);
	logTransition({
		correlationId,
		entityType: 'task',
		entityId: id,
		previousState: null,
		newState: 'task.active',
		trigger: 'user.createTask',
		actor: ACTOR,
		accepted: true
	});
	return created;
}

export function archiveTask(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.task.archive.enter', correlationId, entityId: id });
	const current = tasksQ.getTask(db, id);
	if (!current) throw new Error(`task ${id} not found`);
	const before = stateOf(current);

	const runningCount = db
		.prepare(`SELECT COUNT(*) AS n FROM time_entries WHERE task_id = ? AND state = 'entry.running'`)
		.get(id) as { n: number };

	if (runningCount.n > 0) {
		logTransition({
			correlationId,
			entityType: 'task',
			entityId: id,
			previousState: before,
			newState: 'task.archived',
			trigger: 'user.archiveTask',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'task_has_running_timer'
		});
		throw new StateTransitionError('task_has_running_timer', `task ${id} has a running timer`);
	}

	const now = nowUtcIso();
	db.prepare(`UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
	log.info({
		event: 'task.archive',
		correlationId,
		entityType: 'task',
		entityId: id,
		before: { state: before, archivedAt: null },
		after: { state: 'task.archived', archivedAt: now }
	});
	logTransition({
		correlationId,
		entityType: 'task',
		entityId: id,
		previousState: before,
		newState: 'task.archived',
		trigger: 'user.archiveTask',
		actor: ACTOR,
		accepted: true
	});
}

export function unarchiveTask(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.task.unarchive.enter', correlationId, entityId: id });
	const current = tasksQ.getTask(db, id);
	if (!current) throw new Error(`task ${id} not found`);
	const before = stateOf(current);
	const now = nowUtcIso();
	db.prepare(`UPDATE tasks SET archived_at = NULL, updated_at = ? WHERE id = ?`).run(now, id);
	log.info({
		event: 'task.unarchive',
		correlationId,
		entityType: 'task',
		entityId: id,
		before: { state: before, archivedAt: current.archivedAt },
		after: { state: 'task.active', archivedAt: null }
	});
	logTransition({
		correlationId,
		entityType: 'task',
		entityId: id,
		previousState: before,
		newState: 'task.active',
		trigger: 'user.unarchiveTask',
		actor: ACTOR,
		accepted: true
	});
}

export function deleteTask(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.task.delete.enter', correlationId, entityId: id });
	const current = tasksQ.getTask(db, id);
	if (!current) throw new Error(`task ${id} not found`);
	const before = stateOf(current);

	const referencing = db
		.prepare(
			`SELECT COUNT(*) AS n
			 FROM invoice_line_items li
			 JOIN invoices inv ON li.invoice_id = inv.id
			 WHERE li.task_id = ? AND inv.state != 'invoice.draft'`
		)
		.get(id) as { n: number };

	if (referencing.n > 0) {
		logTransition({
			correlationId,
			entityType: 'task',
			entityId: id,
			previousState: before,
			newState: 'task.deleted',
			trigger: 'user.deleteTask',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'referenced_by_invoice'
		});
		throw new StateTransitionError(
			'referenced_by_invoice',
			`task ${id} referenced by ${referencing.n} line item(s) on non-draft invoice(s)`
		);
	}

	db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
	log.info({
		event: 'task.delete',
		correlationId,
		entityType: 'task',
		entityId: id,
		before: current,
		after: null
	});
	logTransition({
		correlationId,
		entityType: 'task',
		entityId: id,
		previousState: before,
		newState: 'task.deleted',
		trigger: 'user.deleteTask',
		actor: ACTOR,
		accepted: true
	});
}
