// Calendar aggregation helpers. Not pure — reads from the DB — but has
// no external side effects other than logging is emitted at call site.
// Exempt from state-transition logging (read-only, no mutations).

import type { Database } from 'better-sqlite3';
import { localDateOf } from './time';

export interface CalendarSegment {
	segmentId: string;
	entryId: string;
	startedAt: string;
	stoppedAt: string;
	durationMs: number;
	taskId: string;
	taskName: string;
	projectName: string;
	clientName: string;
	notes: string;
}

/**
 * Return all closed segments whose `started_at` falls within [startUtcIso, endUtcIso).
 * Attaches entry / task / project / client display fields.
 */
export function segmentsInRange(
	db: Database,
	startUtcIso: string,
	endUtcIso: string
): CalendarSegment[] {
	const rows = db
		.prepare(
			`SELECT
				s.id AS segmentId,
				s.entry_id AS entryId,
				s.started_at AS startedAt,
				s.stopped_at AS stoppedAt,
				e.notes AS notes,
				t.id AS taskId,
				t.name AS taskName,
				p.name AS projectName,
				c.name AS clientName
			 FROM time_entry_segments s
			 JOIN time_entries e ON s.entry_id = e.id
			 JOIN tasks t ON e.task_id = t.id
			 JOIN projects p ON t.project_id = p.id
			 JOIN clients c ON p.client_id = c.id
			 WHERE s.stopped_at IS NOT NULL
			   AND s.started_at >= ?
			   AND s.started_at < ?
			   AND e.state != 'entry.discarded'
			 ORDER BY s.started_at`
		)
		.all(startUtcIso, endUtcIso) as Omit<CalendarSegment, 'durationMs'>[];

	return rows.map((r) => ({
		...r,
		durationMs: new Date(r.stoppedAt).getTime() - new Date(r.startedAt).getTime()
	}));
}

export interface ProjectTotal {
	clientName: string;
	projectName: string;
	hours: number;
}

export function totalsByProject(segments: CalendarSegment[]): ProjectTotal[] {
	const map = new Map<string, ProjectTotal>();
	for (const s of segments) {
		const key = `${s.clientName} · ${s.projectName}`;
		const existing = map.get(key);
		if (existing) existing.hours += s.durationMs / 3_600_000;
		else
			map.set(key, {
				clientName: s.clientName,
				projectName: s.projectName,
				hours: s.durationMs / 3_600_000
			});
	}
	return [...map.values()].sort((a, b) => b.hours - a.hours);
}

export function totalsByLocalDate(segments: CalendarSegment[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const s of segments) {
		const d = localDateOf(s.startedAt);
		out[d] = (out[d] ?? 0) + s.durationMs / 3_600_000;
	}
	return out;
}
