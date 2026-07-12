<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 text-sm">
		<a
			href={resolve('/clients/[id]', { id: data.project.clientId })}
			class="text-blue-700 hover:underline">← Client</a
		>
	</nav>

	<h1 class="mb-1 text-2xl font-semibold">{data.project.name}</h1>
	<p class="mb-4 text-sm text-gray-600">
		{(data.project.hourlyRate / 100).toFixed(2)}/hr
		{#if data.project.archivedAt}<span class="ml-2 text-xs text-gray-500">archived</span>{/if}
	</p>

	<h2 class="mt-8 mb-3 text-lg font-medium">Tasks</h2>

	{#if form?.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">
			Task created.
		</div>
	{/if}
	{#if form?.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{form.error}
		</div>
	{/if}

	<form method="post" action="?/create" class="mb-6 flex flex-wrap items-end gap-2">
		<input
			name="name"
			placeholder="Task name"
			class="flex-1 rounded border border-gray-300 px-3 py-2"
			required
		/>
		<button
			type="submit"
			class="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
		>
			Add task
		</button>
	</form>

	{#if data.tasks.length === 0}
		<p class="text-gray-500">No tasks yet.</p>
	{:else}
		<ul class="divide-y divide-gray-200 rounded border border-gray-200">
			{#each data.tasks as task (task.id)}
				<li class="flex items-center justify-between px-4 py-3">
					<span class:opacity-50={task.archivedAt !== null}>{task.name}</span>
					{#if task.archivedAt}
						<span class="text-xs text-gray-500">archived</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
