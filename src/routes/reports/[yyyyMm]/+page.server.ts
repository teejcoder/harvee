import { getDb } from '$lib/db';
import { getSettings } from '$lib/db/queries/settings';
import { log } from '$lib/log';
import { localMonthBounds } from '$lib/time';
import type { PageServerLoad } from './$types';

interface ReportRow {
	clientId: string;
	clientName: string;
	sec: number;
	amountMinor: number;
}

export const load: PageServerLoad = ({ params }) => {
	log.debug({ event: 'routes.reports.load', month: params.yyyyMm });
	const db = getDb();
	const { startUtcIso, endUtcIso } = localMonthBounds(params.yyyyMm);

	// Per-client hours + billable amount for the month (rate × hours, current
	// project rate — a "what could I bill" snapshot, independent of invoices).
	const rows = db
		.prepare(
			`SELECT
				c.id AS clientId,
				c.name AS clientName,
				COALESCE(SUM(strftime('%s', s.stopped_at) - strftime('%s', s.started_at)), 0) AS sec,
				COALESCE(SUM(
					(strftime('%s', s.stopped_at) - strftime('%s', s.started_at)) / 3600.0 * p.hourly_rate
				), 0) AS amountMinor
			 FROM time_entry_segments s
			 JOIN time_entries e ON s.entry_id = e.id
			 JOIN tasks t ON e.task_id = t.id
			 JOIN projects p ON t.project_id = p.id
			 JOIN clients c ON p.client_id = c.id
			 WHERE s.stopped_at IS NOT NULL
			   AND s.started_at >= ? AND s.started_at < ?
			   AND e.state != 'entry.discarded'
			 GROUP BY c.id
			 HAVING sec > 0
			 ORDER BY amountMinor DESC`
		)
		.all(startUtcIso, endUtcIso) as ReportRow[];

	const settings = getSettings(db);
	const clients = rows.map((r) => ({
		clientId: r.clientId,
		clientName: r.clientName,
		hours: r.sec / 3600,
		amount: Math.round(r.amountMinor)
	}));

	return {
		month: params.yyyyMm,
		clients,
		totals: {
			hours: clients.reduce((s, c) => s + c.hours, 0),
			amount: clients.reduce((s, c) => s + c.amount, 0)
		},
		currency: {
			code: settings.currencyCode,
			decimals: settings.currencyDecimals,
			locale: settings.invoiceLocale
		}
	};
};
