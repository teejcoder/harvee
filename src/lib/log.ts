// Structured logger. camelCase JSON lines, one per event, appended to
// logs/transitions.jsonl. General logs and transition-log entries share
// the same file; transition lines are distinguishable by the presence
// of `previousState` (see .memory/state-transitions.md §Structured Transition Log).
//
// Exempt from the "every function logs" rule (logger self-exemption)
// per .memory/conventions.md §6. Errors from fs.appendFileSync propagate
// to the caller — loud failure over silent observability loss.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { nowUtcIso } from './time';

const DEFAULT_LOG_PATH = 'logs/transitions.jsonl';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type EntityType =
	'timeEntry' | 'segment' | 'invoice' | 'client' | 'project' | 'task' | 'settings';

// Every rejection reason accepted by logTransition. Mirrors the list
// in .memory/state-transitions.md §Rejection reasons.
export const REJECTION_REASONS = [
	'parent_archived',
	'children_not_archived',
	'task_has_running_timer',
	'referenced_by_invoice',
	'concurrent_timer_forbidden',
	'entry_locked_by_invoice',
	'invalid_time_range',
	'segment_overlap',
	'task_archived',
	'cannot_edit_running_entry',
	'no_billable_entries',
	'invoice_locked',
	'invoice_non_positive_total',
	'invalid_discount_line',
	'must_finalize_before_export',
	'void_requires_finalized'
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface LogEntry {
	event: string;
	correlationId?: string;
	entityType?: EntityType;
	entityId?: string;
	[key: string]: unknown;
}

export interface AcceptedTransition {
	correlationId: string;
	entityType: EntityType;
	entityId: string;
	previousState: string | null;
	newState: string;
	trigger: string;
	actor: { type: 'user' | 'system'; id: string };
	accepted: true;
}

export interface RejectedTransition {
	correlationId: string;
	entityType: EntityType;
	entityId: string;
	previousState: string | null;
	newState: string;
	trigger: string;
	actor: { type: 'user' | 'system'; id: string };
	accepted: false;
	rejectionReason: RejectionReason;
}

export type TransitionEntry = AcceptedTransition | RejectedTransition;

function logPath(): string {
	return process.env.LOG_PATH ?? DEFAULT_LOG_PATH;
}

let ensuredDirFor: string | null = null;
function ensureDir(path: string): void {
	if (ensuredDirFor === path) return;
	mkdirSync(dirname(path), { recursive: true });
	ensuredDirFor = path;
}

function writeLine(obj: Record<string, unknown>): void {
	const path = logPath();
	ensureDir(path);
	appendFileSync(path, JSON.stringify(obj) + '\n');
}

function emit(level: LogLevel, entry: LogEntry): void {
	writeLine({ timestamp: nowUtcIso(), level, ...entry });
}

export const log = {
	debug: (entry: LogEntry): void => emit('debug', entry),
	info: (entry: LogEntry): void => emit('info', entry),
	warn: (entry: LogEntry): void => emit('warn', entry),
	error: (entry: LogEntry): void => emit('error', entry)
};

export function logTransition(entry: TransitionEntry): void {
	writeLine({
		timestamp: nowUtcIso(),
		correlationId: entry.correlationId,
		entityType: entry.entityType,
		entityId: entry.entityId,
		previousState: entry.previousState,
		newState: entry.newState,
		trigger: entry.trigger,
		actor: entry.actor,
		accepted: entry.accepted,
		rejectionReason: entry.accepted ? null : entry.rejectionReason
	});
}
