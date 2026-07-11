// Shared helpers for query modules.
// - requireCorrelationId: runtime guard for write queries (conventions.md §7).
// - rowToCamel:           SQL snake_case → TS camelCase (conventions.md §2).
// - prep:                 per-DB prepared-statement cache.

import type { Database, Statement } from 'better-sqlite3';
import { log } from '../../log';

export function requireCorrelationId(
	correlationId: string | undefined,
	fnName: string
): asserts correlationId is string {
	if (typeof correlationId === 'string' && correlationId.length > 0) return;
	log.error({
		event: 'db.query.missing_correlation_id',
		function: fnName,
		error: {
			message: `Write query "${fnName}" was called without a correlationId`
		}
	});
	throw new Error(`Write query "${fnName}" was called without a correlationId`);
}

export function rowToCamel<T>(row: unknown): T {
	const src = row as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(src)) {
		out[snakeToCamel(key)] = src[key];
	}
	return out as T;
}

function snakeToCamel(s: string): string {
	return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const stmtCache = new WeakMap<Database, Map<string, Statement>>();

/** Return a prepared statement for `sql`, cached per DB connection. */
export function prep(db: Database, sql: string): Statement {
	let perDb = stmtCache.get(db);
	if (!perDb) {
		perDb = new Map();
		stmtCache.set(db, perDb);
	}
	let stmt = perDb.get(sql);
	if (!stmt) {
		stmt = db.prepare(sql);
		perDb.set(sql, stmt);
	}
	return stmt;
}
