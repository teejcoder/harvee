<script lang="ts">
	import { resolve } from '$app/paths';
	import InvoiceList from '$lib/components/InvoiceList.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 text-sm">
		<a href={resolve('/clients')} class="text-blue-700 hover:underline">← Clients</a>
	</nav>

	<div class="mb-1 flex items-center justify-between">
		<h1 class="text-2xl font-semibold">{data.client.name}</h1>
		{#if data.client.archivedAt}
			<form method="post" action="?/unarchiveClient">
				<button
					type="submit"
					class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
				>
					Unarchive
				</button>
			</form>
		{:else}
			<form method="post" action="?/archiveClient">
				<button
					type="submit"
					class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
				>
					Archive
				</button>
			</form>
		{/if}
	</div>
	{#if data.client.archivedAt}
		<p class="mb-4 text-sm text-gray-500">Archived {data.client.archivedAt}</p>
	{/if}

	<section class="mt-6 rounded border border-gray-200 p-4">
		<h2 class="mb-2 text-sm font-medium text-gray-700">Generate invoice</h2>
		<form method="post" action="?/generateInvoice" class="flex flex-wrap items-end gap-2">
			<label>
				<span class="block text-xs text-gray-600">Start date</span>
				<input
					name="startDate"
					type="date"
					class="rounded border border-gray-300 px-3 py-2"
					required
				/>
			</label>
			<label>
				<span class="block text-xs text-gray-600">End date</span>
				<input
					name="endDate"
					type="date"
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

	<form method="post" action="?/create" class="mb-6 flex flex-wrap items-end gap-2">
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
						<span>{(project.hourlyRate / 100).toFixed(2)}/hr</span>
						{#if project.archivedAt}
							<form method="post" action="?/unarchiveProject">
								<input type="hidden" name="projectId" value={project.id} />
								<button
									type="submit"
									class="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
								>
									Unarchive
								</button>
							</form>
						{:else}
							<form method="post" action="?/archiveProject">
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
