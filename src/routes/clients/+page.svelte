<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto max-w-3xl p-6">
	<h1 class="mb-6 text-2xl font-semibold">Clients</h1>

	{#if form?.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">
			Client created.
		</div>
	{/if}
	{#if form?.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{form.error}
		</div>
	{/if}

	<form method="post" use:enhance action="?/create" class="mb-8 flex gap-2">
		<input
			name="name"
			placeholder="Client name"
			class="flex-1 rounded border border-gray-300 px-3 py-2"
			required
		/>
		<button
			type="submit"
			class="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
		>
			Add
		</button>
	</form>

	{#if data.clients.length === 0}
		<p class="text-gray-500">No clients yet. Add one above.</p>
	{:else}
		<ul class="divide-y divide-gray-200 rounded border border-gray-200">
			{#each data.clients as client (client.id)}
				<li class="flex items-center justify-between px-4 py-3">
					<a
						href={resolve('/clients/[id]', { id: client.id })}
						class="text-blue-700 hover:underline"
						class:opacity-50={client.archivedAt !== null}
					>
						{client.name}
					</a>
					{#if client.archivedAt}
						<span class="text-xs text-gray-500">archived</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
