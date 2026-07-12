<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 text-sm">
		<a href={resolve('/clients')} class="text-blue-700 hover:underline">← Clients</a>
	</nav>

	<h1 class="mb-1 text-2xl font-semibold">{data.client.name}</h1>
	{#if data.client.archivedAt}
		<p class="mb-4 text-sm text-gray-500">Archived {data.client.archivedAt}</p>
	{/if}

	<h2 class="mt-8 mb-3 text-lg font-medium">Projects</h2>

	{#if form?.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">
			Project created.
		</div>
	{/if}
	{#if form?.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{form.error}
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
					<span class="text-sm text-gray-600">
						{(project.hourlyRate / 100).toFixed(2)}/hr
						{#if project.archivedAt}<span class="ml-2 text-xs">archived</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
