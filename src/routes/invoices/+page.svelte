<script lang="ts">
	import InvoiceList from '$lib/components/InvoiceList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const states = ['all', 'draft', 'finalized', 'exported', 'voided'] as const;
	let filter = $state<(typeof states)[number]>('all');

	const shown = $derived(
		filter === 'all' ? data.invoices : data.invoices.filter((i) => i.state === `invoice.${filter}`)
	);
</script>

<div class="mx-auto max-w-3xl p-6">
	<h1 class="mb-1 text-2xl font-semibold">Invoices</h1>
	<p class="mb-4 text-sm text-gray-600">
		Every invoice you've generated. Create one from a client's page.
	</p>

	<div class="mb-4 flex flex-wrap gap-1">
		{#each states as s (s)}
			<button
				type="button"
				onclick={() => (filter = s)}
				class="rounded px-3 py-1 text-sm capitalize hover:bg-gray-100"
				class:bg-gray-200={filter === s}
				class:font-medium={filter === s}
			>
				{s}
			</button>
		{/each}
	</div>

	<InvoiceList invoices={shown} showClient={true} />
</div>
