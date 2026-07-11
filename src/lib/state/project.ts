// Project lifecycle per .memory/state-transitions.md §1.

import type { Database } from 'better-sqlite3';
import * as projectsQ from '../db/queries/projects';
import * as clientsQ from '../db/queries/clients';
import { ulid } from '../ids';
import { log, logTransition } from '../log';
import { nowUtcIso } from '../time';
import { StateTransitionError } from './_error';

export type ProjectState = 'project.active' | 'project.archived' | 'project.deleted';

const ACTOR = { type: 'user' as const, id: 'user_teej' };

function stateOf(row: { archivedAt: string | null }): 'project.active' | 'project.archived' {
	return row.archivedAt ? 'project.archived' : 'project.active';
}

export function createProject(
	db: Database,
	args: { clientId: string; name: string; hourlyRate: number },
	correlationId: string
): projectsQ.Project {
	log.debug({ event: 'state.project.create.enter', correlationId, ...args });

	const parent = clientsQ.getClient(db, args.clientId);
	if (!parent) throw new Error(`parent client ${args.clientId} not found`);

	const id = ulid();

	if (parent.archivedAt) {
		logTransition({
			correlationId,
			entityType: 'project',
			entityId: id,
			previousState: null,
			newState: 'project.active',
			trigger: 'user.createProject',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'parent_archived'
		});
		throw new StateTransitionError(
			'parent_archived',
			`client ${args.clientId} is archived; cannot create project`
		);
	}

	const created = projectsQ.createProject(db, { id, ...args }, correlationId);
	logTransition({
		correlationId,
		entityType: 'project',
		entityId: id,
		previousState: null,
		newState: 'project.active',
		trigger: 'user.createProject',
		actor: ACTOR,
		accepted: true
	});
	return created;
}

export function archiveProject(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.project.archive.enter', correlationId, entityId: id });
	const current = projectsQ.getProject(db, id);
	if (!current) throw new Error(`project ${id} not found`);
	const before = stateOf(current);

	const activeTaskCount = db
		.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND archived_at IS NULL`)
		.get(id) as { n: number };

	if (activeTaskCount.n > 0) {
		logTransition({
			correlationId,
			entityType: 'project',
			entityId: id,
			previousState: before,
			newState: 'project.archived',
			trigger: 'user.archiveProject',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'children_not_archived'
		});
		throw new StateTransitionError(
			'children_not_archived',
			`project ${id} has ${activeTaskCount.n} active task(s)`
		);
	}

	const now = nowUtcIso();
	db.prepare(`UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
	log.info({
		event: 'project.archive',
		correlationId,
		entityType: 'project',
		entityId: id,
		before: { state: before, archivedAt: null },
		after: { state: 'project.archived', archivedAt: now }
	});
	logTransition({
		correlationId,
		entityType: 'project',
		entityId: id,
		previousState: before,
		newState: 'project.archived',
		trigger: 'user.archiveProject',
		actor: ACTOR,
		accepted: true
	});
}

export function unarchiveProject(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.project.unarchive.enter', correlationId, entityId: id });
	const current = projectsQ.getProject(db, id);
	if (!current) throw new Error(`project ${id} not found`);
	const before = stateOf(current);
	const now = nowUtcIso();
	db.prepare(`UPDATE projects SET archived_at = NULL, updated_at = ? WHERE id = ?`).run(now, id);
	log.info({
		event: 'project.unarchive',
		correlationId,
		entityType: 'project',
		entityId: id,
		before: { state: before, archivedAt: current.archivedAt },
		after: { state: 'project.active', archivedAt: null }
	});
	logTransition({
		correlationId,
		entityType: 'project',
		entityId: id,
		previousState: before,
		newState: 'project.active',
		trigger: 'user.unarchiveProject',
		actor: ACTOR,
		accepted: true
	});
}

export function deleteProject(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.project.delete.enter', correlationId, entityId: id });
	const current = projectsQ.getProject(db, id);
	if (!current) throw new Error(`project ${id} not found`);
	const before = stateOf(current);

	const referencing = db
		.prepare(
			`SELECT COUNT(*) AS n
			 FROM invoice_line_items li
			 JOIN tasks t ON li.task_id = t.id
			 JOIN invoices inv ON li.invoice_id = inv.id
			 WHERE t.project_id = ? AND inv.state != 'invoice.draft'`
		)
		.get(id) as { n: number };

	if (referencing.n > 0) {
		logTransition({
			correlationId,
			entityType: 'project',
			entityId: id,
			previousState: before,
			newState: 'project.deleted',
			trigger: 'user.deleteProject',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'referenced_by_invoice'
		});
		throw new StateTransitionError(
			'referenced_by_invoice',
			`project ${id} referenced by ${referencing.n} line item(s) on non-draft invoice(s)`
		);
	}

	db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
	log.info({
		event: 'project.delete',
		correlationId,
		entityType: 'project',
		entityId: id,
		before: current,
		after: null
	});
	logTransition({
		correlationId,
		entityType: 'project',
		entityId: id,
		previousState: before,
		newState: 'project.deleted',
		trigger: 'user.deleteProject',
		actor: ACTOR,
		accepted: true
	});
}
