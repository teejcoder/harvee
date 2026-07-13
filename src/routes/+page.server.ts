import { getDb } from '$lib/db';
import { segmentsInRange } from '$lib/calendar';
import { log } from '$lib/log';
import { localDateOf, localDayBounds, localWeekBounds, nowUtcIso } from '$lib/time';
import type { PageServerLoad } from './$types';

export interface RecentEntry {
	id: string;
	state: string;
	notes: string;
	taskName: string;
	projectName: string;
	clientName: string;
	lastStartedAt: string;
	durationSec: number;
}

export const load: PageServerLoad = () => {
	const db = getDb();
	log.debug({ event: 'routes.home.load' });

	const today = localDateOf(nowUtcIso());
	const day = localDayBounds(today);
	const week = localWeekBounds(today);
	const hours = (start: string, end: string): number =>
		segmentsInRange(db, start, end).reduce((sum, s) => sum + s.durationMs, 0) / 3_600_000;

	// Recent activity — the entries a user most likely wants to revisit/edit.
	const recent = db
		.prepare(
			`SELECT
				e.id AS id,
				e.state AS state,
				e.notes AS notes,
				t.name AS taskName,
				p.name AS projectName,
				c.name AS clientName,
				MAX(s.started_at) AS lastStartedAt,
				COALESCE(SUM(
					CASE WHEN s.stopped_at IS NOT NULL
						THEN strftime('%s', s.stopped_at) - strftime('%s', s.started_at)
						ELSE 0 END
				), 0) AS durationSec
			 FROM time_entries e
			 JOIN tasks t ON e.task_id = t.id
			 JOIN projects p ON t.project_id = p.id
			 JOIN clients c ON p.client_id = c.id
			 LEFT JOIN time_entry_segments s ON s.entry_id = e.id
			 WHERE e.state NOT IN ('entry.draft', 'entry.discarded')
			 GROUP BY e.id
			 ORDER BY lastStartedAt DESC
			 LIMIT 8`
		)
		.all() as RecentEntry[];

	return {
		todayHours: hours(day.startUtcIso, day.endUtcIso),
		weekHours: hours(week.startUtcIso, week.endUtcIso),
		recent
	};
};
