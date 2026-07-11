// Client lifecycle per .memory/state-transitions.md §1.
// States derived from `archived_at` (NULL → active, non-NULL → archived).
// `client.deleted` is a pseudo-state used only in transition-log lines
// (hard-delete removes the row; no persisted state).

import type { Database } from 'better-sqlite3';
import * as clientsQ from '../db/queries/clients';
import { ulid } from '../ids';
import { log, logTransition } from '../log';
import { nowUtcIso } from '../time';
import { StateTransitionError } from './_error';

export type ClientState = 'client.active' | 'client.archived' | 'client.deleted';

const ACTOR = { type: 'user' as const, id: 'user_teej' };

function stateOf(row: { archivedAt: string | null }): 'client.active' | 'client.archived' {
	return row.archivedAt ? 'client.archived' : 'client.active';
}

export function createClient(
	db: Database,
	args: { name: string },
	correlationId: string
): clientsQ.Client {
	log.debug({ event: 'state.client.create.enter', correlationId, name: args.name });
	const id = ulid();
	const created = clientsQ.createClient(db, { id, name: args.name }, correlationId);
	logTransition({
		correlationId,
		entityType: 'client',
		entityId: id,
		previousState: null,
		newState: 'client.active',
		trigger: 'user.createClient',
		actor: ACTOR,
		accepted: true
	});
	return created;
}

export function archiveClient(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.client.archive.enter', correlationId, entityId: id });
	const current = clientsQ.getClient(db, id);
	if (!current) throw new Error(`client ${id} not found`);
	const before = stateOf(current);

	const activeProjectCount = db
		.prepare(`SELECT COUNT(*) AS n FROM projects WHERE client_id = ? AND archived_at IS NULL`)
		.get(id) as { n: number };

	if (activeProjectCount.n > 0) {
		logTransition({
			correlationId,
			entityType: 'client',
			entityId: id,
			previousState: before,
			newState: 'client.archived',
			trigger: 'user.archiveClient',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'children_not_archived'
		});
		throw new StateTransitionError(
			'children_not_archived',
			`client ${id} has ${activeProjectCount.n} active project(s)`
		);
	}

	const now = nowUtcIso();
	db.prepare(`UPDATE clients SET archived_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
	log.info({
		event: 'client.archive',
		correlationId,
		entityType: 'client',
		entityId: id,
		before: { state: before, archivedAt: null },
		after: { state: 'client.archived', archivedAt: now }
	});
	logTransition({
		correlationId,
		entityType: 'client',
		entityId: id,
		previousState: before,
		newState: 'client.archived',
		trigger: 'user.archiveClient',
		actor: ACTOR,
		accepted: true
	});
}

export function unarchiveClient(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.client.unarchive.enter', correlationId, entityId: id });
	const current = clientsQ.getClient(db, id);
	if (!current) throw new Error(`client ${id} not found`);
	const before = stateOf(current);
	const now = nowUtcIso();
	db.prepare(`UPDATE clients SET archived_at = NULL, updated_at = ? WHERE id = ?`).run(now, id);
	log.info({
		event: 'client.unarchive',
		correlationId,
		entityType: 'client',
		entityId: id,
		before: { state: before, archivedAt: current.archivedAt },
		after: { state: 'client.active', archivedAt: null }
	});
	logTransition({
		correlationId,
		entityType: 'client',
		entityId: id,
		previousState: before,
		newState: 'client.active',
		trigger: 'user.unarchiveClient',
		actor: ACTOR,
		accepted: true
	});
}

/** Hard-delete. Rejected if any non-draft invoice references this client. */
export function deleteClient(db: Database, id: string, correlationId: string): void {
	log.debug({ event: 'state.client.delete.enter', correlationId, entityId: id });
	const current = clientsQ.getClient(db, id);
	if (!current) throw new Error(`client ${id} not found`);
	const before = stateOf(current);

	const nonDraftInvoiceCount = db
		.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE client_id = ? AND state != 'invoice.draft'`)
		.get(id) as { n: number };

	if (nonDraftInvoiceCount.n > 0) {
		logTransition({
			correlationId,
			entityType: 'client',
			entityId: id,
			previousState: before,
			newState: 'client.deleted',
			trigger: 'user.deleteClient',
			actor: ACTOR,
			accepted: false,
			rejectionReason: 'referenced_by_invoice'
		});
		throw new StateTransitionError(
			'referenced_by_invoice',
			`client ${id} appears on ${nonDraftInvoiceCount.n} non-draft invoice(s)`
		);
	}

	db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
	log.info({
		event: 'client.delete',
		correlationId,
		entityType: 'client',
		entityId: id,
		before: current,
		after: null
	});
	logTransition({
		correlationId,
		entityType: 'client',
		entityId: id,
		previousState: before,
		newState: 'client.deleted',
		trigger: 'user.deleteClient',
		actor: ACTOR,
		accepted: true
	});
}
