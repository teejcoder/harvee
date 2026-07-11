import type { Database } from 'better-sqlite3';
import { ulid } from '../../ids';
import { log } from '../../log';
import { nowUtcIso } from '../../time';
import { prep, requireCorrelationId, rowToCamel } from './_helpers';

export interface Client {
	id: string;
	name: string;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export function createClient(
	db: Database,
	args: { id?: string; name: string },
	correlationId: string
): Client {
	requireCorrelationId(correlationId, 'createClient');
	const id = args.id ?? ulid();
	const now = nowUtcIso();
	prep(db, `INSERT INTO clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
		id,
		args.name,
		now,
		now
	);
	const created: Client = {
		id,
		name: args.name,
		archivedAt: null,
		createdAt: now,
		updatedAt: now
	};
	log.info({
		event: 'client.create',
		correlationId,
		entityType: 'client',
		entityId: id,
		before: null,
		after: created
	});
	return created;
}

export function getClient(db: Database, id: string): Client | undefined {
	log.debug({ event: 'db.query.getClient', entityType: 'client', entityId: id });
	const row = prep(db, `SELECT * FROM clients WHERE id = ?`).get(id);
	return row ? rowToCamel<Client>(row) : undefined;
}
