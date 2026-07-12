<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function shiftWeek(deltaDays: number): string {
		const [y, m, d] = data.monday.split('-').map(Number);
		const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
		return dt.toISOString().slice(0, 10);
	}
</script>

<div class="mx-auto max-w-4xl p-6">
	<nav class="mb-4 flex items-center justify-between text-sm">
		<a
			href={resolve('/calendar/week/[date]', { date: shiftWeek(-7) })}
			class="text-blue-700 hover:underline">← Previous week</a
		>
		<h1 class="text-2xl font-semibold">Week of {data.monday}</h1>
		<a
			href={resolve('/calendar/week/[date]', { date: shiftWeek(7) })}
			class="text-blue-700 hover:underline">Next week →</a
		>
	</nav>

	<p class="mb-6 text-sm text-gray-600">Total {data.totalHours.toFixed(2)}h</p>

	<div class="grid grid-cols-7 gap-2">
		{#each data.days as day (day.date)}
			<a
				href={resolve('/calendar/day/[date]', { date: day.date })}
				class="rounded border border-gray-200 p-3 text-center hover:bg-gray-50"
			>
				<div class="text-xs text-gray-500">{day.date}</div>
				<div class="mt-2 font-mono text-lg">{day.hours.toFixed(1)}h</div>
			</a>
		{/each}
	</div>
</div>
