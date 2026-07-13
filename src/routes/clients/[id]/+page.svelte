<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import InvoiceList from '$lib/components/InvoiceList.svelte';
	import { formatMoney } from '$lib/money';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const rate = (minor: number): string =>
		formatMoney(minor, data.currency.code, data.currency.decimals, data.currency.locale);

	const confirmSubmit =
		(message: string): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(message)) cancel();
		};

	// Invoice-range presets. Uses the browser's local date (matches the app's
	// system-local day convention on a single machine).
	let startDate = $state('');
	let endDate = $state('');
	const pad = (n: number): string => String(n).padStart(2, '0');
	const iso = (d: Date): string =>
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	function preset(kind: 'thisMonth' | 'lastMonth' | 'last7'): void {
		const now = new Date();
		if (kind === 'thisMonth') {
			startDate = iso(new Date(now.getFullYear(), now.getMonth(), 1));
			endDate = iso(now);
		} else if (kind === 'lastMonth') {
			startDate = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
			endDate = iso(new Date(now.getFullYear(), now.getMonth(), 0));
		} else {
			// Constructor with day arithmetic (rolls over months) — no Date mutation.
			startDate = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
			endDate = iso(now);
		}
	}
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 text-sm">
		<a href={resolve('/clients')} class="text-blue-700 hover:underline">← Clients</a>
	</nav>

	<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
		<form method="post" use:enhance action="?/rename" class="flex items-center gap-2">
			<input
				name="name"
				value={data.client.name}
				class="rounded border border-gray-300 px-2 py-1 text-2xl font-semibold"
				required
				aria-label="Client name"
			/>
			<button
				type="submit"
				class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Rename</button
			>
		</form>
		<div class="flex gap-2">
			{#if data.client.archivedAt}
				<form method="post" use:enhance action="?/unarchiveClient">
					<button
						type="submit"
						class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
					>
						Unarchive
					</button>
				</form>
			{:else}
				<form method="post" use:enhance action="?/archiveClient">
					<button
						type="submit"
						class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
					>
						Archive
					</button>
				</form>
			{/if}
			<form
				method="post"
				use:enhance={confirmSubmit(
					'Delete this client? This cannot be undone. (Its projects must be removed first.)'
				)}
				action="?/deleteClient"
			>
				<button
					type="submit"
					class="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
				>
					Delete
				</button>
			</form>
		</div>
	</div>
	{#if data.client.archivedAt}
		<p class="mb-4 text-sm text-gray-500">Archived {data.client.archivedAt}</p>
	{/if}

	<section class="mt-6 rounded border border-gray-200 p-4">
		<h2 class="mb-1 text-sm font-medium text-gray-700">Generate invoice</h2>
		<p class="mb-3 text-xs text-gray-500">
			{#if data.unbilled.entries > 0}
				{data.unbilled.hours.toFixed(2)}h of unbilled time ready to bill ({data.unbilled.entries}
				{data.unbilled.entries === 1 ? 'entry' : 'entries'}).
			{:else}
				No unbilled time for this client yet.
			{/if}
		</p>

		<div class="mb-3 flex flex-wrap gap-1">
			{#each [['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['last7', 'Last 7 days']] as [kind, label] (kind)}
				<button
					type="button"
					onclick={() => preset(kind as 'thisMonth' | 'lastMonth' | 'last7')}
					class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
				>
					{label}
				</button>
			{/each}
		</div>

		<form
			method="post"
			use:enhance
			action="?/generateInvoice"
			class="flex flex-wrap items-end gap-2"
		>
			<label>
				<span class="block text-xs text-gray-600">Start date</span>
				<input
					name="startDate"
					type="date"
					bind:value={startDate}
					class="rounded border border-gray-300 px-3 py-2"
					required
				/>
			</label>
			<label>
				<span class="block text-xs text-gray-600">End date</span>
				<input
					name="endDate"
					type="date"
					bind:value={endDate}
					class="rounded border border-gray-300 px-3 py-2"
					required
				/>
			</label>
			<button
				type="submit"
				class="rounded bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
			>
				Generate
			</button>
		</form>
	</section>

	<div class="mt-8 mb-3 flex items-center justify-between">
		<h2 class="text-lg font-medium">Invoices</h2>
		{#if data.invoices.length > 0}
			<a href={resolve('/invoices')} class="text-sm text-blue-700 hover:underline">All invoices →</a
			>
		{/if}
	</div>
	<InvoiceList invoices={data.invoices} showClient={false} />

	<h2 class="mt-8 mb-3 text-lg font-medium">Projects</h2>

	{#if form && 'success' in form && form.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">
			Project created.
		</div>
	{/if}
	{#if form && 'error' in form && form.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{String(form.error)}
		</div>
	{/if}

	<form method="post" use:enhance action="?/create" class="mb-6 flex flex-wrap items-end gap-2">
		<label class="flex-1">
			<span class="block text-xs text-gray-600">Name</span>
			<input
				name="name"
				placeholder="Project name"
				class="w-full rounded border border-gray-300 px-3 py-2"
				required
			/>
		</label>
		<label>
			<span class="block text-xs text-gray-600">Rate (per hour)</span>
			<input
				name="hourlyRate"
				type="number"
				min="0"
				step="0.01"
				placeholder="125.00"
				class="w-40 rounded border border-gray-300 px-3 py-2"
				required
			/>
		</label>
		<button
			type="submit"
			class="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
		>
			Add project
		</button>
	</form>

	{#if data.projects.length === 0}
		<p class="text-gray-500">No projects yet.</p>
	{:else}
		<ul class="divide-y divide-gray-200 rounded border border-gray-200">
			{#each data.projects as project (project.id)}
				<li class="flex items-center justify-between px-4 py-3">
					<a
						href={resolve('/projects/[id]', { id: project.id })}
						class="text-blue-700 hover:underline"
						class:opacity-50={project.archivedAt !== null}
					>
						{project.name}
					</a>
					<span class="flex items-center gap-3 text-sm text-gray-600">
						<span>{rate(project.hourlyRate)}/hr</span>
						{#if project.archivedAt}
							<form method="post" use:enhance action="?/unarchiveProject">
								<input type="hidden" name="projectId" value={project.id} />
								<button
									type="submit"
									class="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
								>
									Unarchive
								</button>
							</form>
						{:else}
							<form method="post" use:enhance action="?/archiveProject">
								<input type="hidden" name="projectId" value={project.id} />
								<button
									type="submit"
									class="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
								>
									Archive
								</button>
							</form>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
