import { getDb } from '$lib/db';
import type { RunningEntryView, TaskOption } from '$lib/components/timer-types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const db = getDb();

	const activeTasks = db
		.prepare(
			`SELECT
				t.id AS id,
				t.name AS name,
				p.name AS projectName,
				c.name AS clientName
			 FROM tasks t
			 JOIN projects p ON t.project_id = p.id
			 JOIN clients c ON p.client_id = c.id
			 WHERE t.archived_at IS NULL
			   AND p.archived_at IS NULL
			   AND c.archived_at IS NULL
			 ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE, t.name COLLATE NOCASE`
		)
		.all() as TaskOption[];

	const running = db
		.prepare(
			`SELECT
				e.id AS id,
				e.task_id AS taskId,
				e.notes AS notes,
				t.name AS taskName,
				p.name AS projectName,
				c.name AS clientName,
				(SELECT started_at FROM time_entry_segments
				  WHERE entry_id = e.id AND stopped_at IS NULL LIMIT 1) AS openSegmentStartedAt
			 FROM time_entries e
			 JOIN tasks t ON e.task_id = t.id
			 JOIN projects p ON t.project_id = p.id
			 JOIN clients c ON p.client_id = c.id
			 WHERE e.state = 'entry.running'
			 LIMIT 1`
		)
		.get() as RunningEntryView | undefined;

	return { activeTasks, running: running ?? null };
};
