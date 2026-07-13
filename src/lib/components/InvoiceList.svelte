<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatMoney } from '$lib/money';
	import type { InvoiceListItem } from '$lib/db/queries/invoices';

	interface Props {
		invoices: InvoiceListItem[];
		showClient?: boolean;
	}
	let { invoices, showClient = true }: Props = $props();

	const badge: Record<string, string> = {
		'invoice.draft': 'bg-gray-100 text-gray-700',
		'invoice.finalized': 'bg-blue-100 text-blue-800',
		'invoice.exported': 'bg-emerald-100 text-emerald-800',
		'invoice.voided': 'bg-red-100 text-red-700'
	};
	const label = (state: string): string => state.replace('invoice.', '');
</script>

{#if invoices.length === 0}
	<p class="text-sm text-gray-500">No invoices yet.</p>
{:else}
	<ul class="divide-y divide-gray-200 rounded border border-gray-200">
		{#each invoices as inv (inv.id)}
			<li>
				<a
					href={resolve('/invoices/[id]', { id: inv.id })}
					class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-gray-50"
					class:opacity-60={inv.state === 'invoice.voided'}
				>
					<span class="rounded px-2 py-0.5 text-xs font-medium {badge[inv.state] ?? 'bg-gray-100'}">
						{label(inv.state)}
					</span>
					<span class="font-mono text-sm">{inv.invoiceNumber ?? 'Draft'}</span>
					{#if showClient}
						<span class="text-sm font-medium text-gray-900">{inv.clientName}</span>
					{/if}
					<span class="text-xs text-gray-500">{inv.startDate} – {inv.endDate}</span>
					<span
						class="ml-auto font-mono text-sm"
						class:line-through={inv.state === 'invoice.voided'}
					>
						{formatMoney(inv.total, inv.currencyCode, inv.currencyDecimals, inv.invoiceLocale)}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}
