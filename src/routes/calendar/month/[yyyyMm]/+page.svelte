<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function shiftMonth(delta: number): string {
		const [y, m] = data.yyyyMm.split('-').map(Number);
		const total = y * 12 + (m - 1) + delta;
		const ny = Math.floor(total / 12);
		const nm = (total % 12) + 1;
		return `${ny}-${String(nm).padStart(2, '0')}`;
	}
</script>

<div class="mx-auto max-w-4xl p-6">
	<nav class="mb-4 flex items-center justify-between text-sm">
		<a
			href={resolve('/calendar/month/[yyyyMm]', { yyyyMm: shiftMonth(-1) })}
			class="text-blue-700 hover:underline">← {shiftMonth(-1)}</a
		>
		<h1 class="text-2xl font-semibold">{data.yyyyMm}</h1>
		<a
			href={resolve('/calendar/month/[yyyyMm]', { yyyyMm: shiftMonth(1) })}
			class="text-blue-700 hover:underline">{shiftMonth(1)} →</a
		>
	</nav>

	<p class="mb-6 text-sm text-gray-600">Total {data.totalHours.toFixed(2)}h</p>

	<div class="grid grid-cols-7 gap-1">
		{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as name (name)}
			<div class="text-center text-xs font-medium text-gray-500">{name}</div>
		{/each}
		{#each data.cells as cell, idx (idx)}
			{#if cell === null}
				<div class="min-h-16 rounded border border-transparent"></div>
			{:else}
				<a
					href={resolve('/calendar/day/[date]', { date: cell.date })}
					class="min-h-16 rounded border border-gray-200 p-2 hover:bg-gray-50"
				>
					<div class="text-xs text-gray-500">{cell.date.slice(-2)}</div>
					{#if cell.hours > 0}
						<div class="mt-1 font-mono text-sm">{cell.hours.toFixed(1)}h</div>
					{/if}
				</a>
			{/if}
		{/each}
	</div>
</div>
