<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	// `data` inherits the layout load (activeTasks, today, running) plus this
	// page's load (todayHours, weekHours, recent).
	let { data }: PageProps = $props();

	function fmtHours(hours: number): string {
		const totalMin = Math.round(hours * 60);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
	function fmtSec(sec: number): string {
		return fmtHours(sec / 3600);
	}

	const stateBadge: Record<string, string> = {
		'entry.running': 'bg-emerald-100 text-emerald-800',
		'entry.stopped': 'bg-gray-100 text-gray-700',
		'entry.editing': 'bg-amber-100 text-amber-800',
		'entry.locked': 'bg-blue-100 text-blue-800'
	};
</script>

<div class="mx-auto max-w-3xl p-6">
	<h1 class="mb-1 text-2xl font-semibold">harvee</h1>
	<p class="mb-6 text-sm text-gray-600">
		Track billable hours and turn them into invoices. Pick a task in the timer bar above to start
		the clock.
	</p>

	{#if data.activeTasks.length === 0}
		<div class="mb-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
			No active tasks yet. Head to <a href={resolve('/clients')} class="font-medium underline"
				>Clients</a
			> and create a client → project → task to begin.
		</div>
	{/if}

	<!-- Totals -->
	<div class="mb-8 grid grid-cols-2 gap-4">
		<div class="rounded border border-gray-200 p-4">
			<div class="text-xs tracking-wide text-gray-500 uppercase">Today</div>
			<div class="mt-1 font-mono text-2xl">{fmtHours(data.todayHours)}</div>
		</div>
		<a
			href={resolve('/calendar/week/[date]', { date: data.today })}
			class="rounded border border-gray-200 p-4 hover:bg-gray-50"
		>
			<div class="text-xs tracking-wide text-gray-500 uppercase">This week</div>
			<div class="mt-1 font-mono text-2xl">{fmtHours(data.weekHours)}</div>
		</a>
	</div>

	<!-- Recent activity -->
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-lg font-medium">Recent activity</h2>
		<a
			href={resolve('/calendar/day/[date]', { date: data.today })}
			class="text-sm text-blue-700 hover:underline">Calendar →</a
		>
	</div>

	{#if data.recent.length === 0}
		<p class="text-sm text-gray-500">No time tracked yet.</p>
	{:else}
		<ul class="divide-y divide-gray-200 rounded border border-gray-200">
			{#each data.recent as e (e.id)}
				<li>
					<a
						href={resolve('/entries/[id]', { id: e.id })}
						class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-gray-50"
					>
						<span
							class="rounded px-2 py-0.5 text-xs font-medium {stateBadge[e.state] ?? 'bg-gray-100'}"
						>
							{e.state.replace('entry.', '')}
						</span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium text-gray-900">{e.taskName}</div>
							<div class="truncate text-xs text-gray-500">
								{e.clientName} · {e.projectName}{e.notes ? ` — ${e.notes}` : ''}
							</div>
						</div>
						<span class="ml-auto font-mono text-sm">{fmtSec(e.durationSec)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
