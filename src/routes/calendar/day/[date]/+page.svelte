<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function shiftDate(days: number): string {
		const [y, m, d] = data.date.split('-').map(Number);
		const dt = new Date(Date.UTC(y, m - 1, d + days));
		return dt.toISOString().slice(0, 10);
	}

	function fmtTime(iso: string): string {
		const d = new Date(iso);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
</script>

<div class="mx-auto max-w-4xl p-6">
	<nav class="mb-4 flex items-center justify-between text-sm">
		<a
			href={resolve('/calendar/day/[date]', { date: shiftDate(-1) })}
			class="text-blue-700 hover:underline">← {shiftDate(-1)}</a
		>
		<h1 class="text-2xl font-semibold">{data.date}</h1>
		<a
			href={resolve('/calendar/day/[date]', { date: shiftDate(1) })}
			class="text-blue-700 hover:underline">{shiftDate(1)} →</a
		>
	</nav>

	<section class="mb-6">
		<h2 class="mb-2 text-sm font-medium text-gray-700">Totals by project</h2>
		{#if data.projectTotals.length === 0}
			<p class="text-gray-500">No time logged.</p>
		{:else}
			<ul class="divide-y divide-gray-200 rounded border border-gray-200">
				{#each data.projectTotals as p (p.clientName + p.projectName)}
					<li class="flex items-center justify-between px-4 py-2">
						<span>{p.clientName} · {p.projectName}</span>
						<span class="font-mono text-sm">{p.hours.toFixed(2)}h</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2 class="mb-2 text-sm font-medium text-gray-700">Segments</h2>
		{#if data.segments.length === 0}
			<p class="text-gray-500">Nothing to show.</p>
		{:else}
			<ul class="divide-y divide-gray-200 rounded border border-gray-200">
				{#each data.segments as s (s.segmentId)}
					<li class="flex items-center justify-between px-4 py-2 text-sm">
						<a
							href={resolve('/entries/[id]', { id: s.entryId })}
							class="flex-1 text-blue-700 hover:underline"
						>
							<span class="text-xs text-gray-500"
								>{s.clientName} · {s.projectName} · {s.taskName}</span
							><br />
							<span class="font-mono">{fmtTime(s.startedAt)} – {fmtTime(s.stoppedAt)}</span>
							{#if s.notes}<span class="ml-2 text-gray-600">{s.notes}</span>{/if}
						</a>
						<span class="font-mono">{(s.durationMs / 3_600_000).toFixed(2)}h</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
