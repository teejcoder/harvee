<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	// `data` inherits the layout load (activeTasks, today).
	let { data }: PageProps = $props();

	const cards = $derived([
		{
			label: 'Clients',
			href: resolve('/clients'),
			blurb: 'Set up clients, projects, and tasks — then bill them.'
		},
		{
			label: 'Calendar',
			href: resolve('/calendar/day/[date]', { date: data.today }),
			blurb: 'Review tracked time by day, week, or month.'
		},
		{
			label: 'Settings',
			href: resolve('/settings'),
			blurb: 'Your sender details, currency, and payment terms.'
		}
	]);
</script>

<div class="mx-auto max-w-5xl p-6">
	<h1 class="mb-1 text-2xl font-semibold">harvest-clone</h1>
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

	<div class="grid gap-4 sm:grid-cols-3">
		{#each cards as card (card.href)}
			<a
				href={card.href}
				class="block rounded border border-gray-200 p-4 transition hover:border-gray-300 hover:bg-gray-50"
			>
				<div class="mb-1 font-medium text-gray-900">{card.label}</div>
				<div class="text-sm text-gray-600">{card.blurb}</div>
			</a>
		{/each}
	</div>
</div>
