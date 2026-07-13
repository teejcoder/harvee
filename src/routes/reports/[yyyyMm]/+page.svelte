<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatMoney } from '$lib/money';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function shiftMonth(delta: number): string {
		const [y, m] = data.month.split('-').map(Number);
		const d = new Date(Date.UTC(y, m - 1 + delta, 1));
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
	}
	const money = (minor: number): string =>
		formatMoney(minor, data.currency.code, data.currency.decimals, data.currency.locale);
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 flex items-center justify-between text-sm">
		<a
			href={resolve('/reports/[yyyyMm]', { yyyyMm: shiftMonth(-1) })}
			class="rounded px-2 py-1 text-blue-700 hover:bg-gray-100">←</a
		>
		<h1 class="text-2xl font-semibold">{data.month}</h1>
		<a
			href={resolve('/reports/[yyyyMm]', { yyyyMm: shiftMonth(1) })}
			class="rounded px-2 py-1 text-blue-700 hover:bg-gray-100">→</a
		>
	</nav>
	<p class="mb-4 text-sm text-gray-600">Hours and billable value per client this month.</p>

	{#if data.clients.length === 0}
		<p class="text-gray-500">No time tracked this month.</p>
	{:else}
		<table class="w-full text-sm">
			<thead class="border-b border-gray-200 text-left text-xs text-gray-500">
				<tr>
					<th class="py-2">Client</th>
					<th class="py-2 text-right">Hours</th>
					<th class="py-2 text-right">Billable</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-100">
				{#each data.clients as c (c.clientId)}
					<tr>
						<td class="py-2">
							<a
								href={resolve('/clients/[id]', { id: c.clientId })}
								class="text-blue-700 hover:underline">{c.clientName}</a
							>
						</td>
						<td class="py-2 text-right font-mono">{c.hours.toFixed(2)}h</td>
						<td class="py-2 text-right font-mono">{money(c.amount)}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot class="border-t-2 border-gray-300 font-medium">
				<tr>
					<td class="py-2">Total</td>
					<td class="py-2 text-right font-mono">{data.totals.hours.toFixed(2)}h</td>
					<td class="py-2 text-right font-mono">{money(data.totals.amount)}</td>
				</tr>
			</tfoot>
		</table>
	{/if}
</div>
