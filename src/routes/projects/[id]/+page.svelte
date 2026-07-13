<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { fromMinorUnits } from '$lib/money';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const confirmSubmit =
		(message: string): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(message)) cancel();
		};

	const rateStep = $derived((10 ** -data.currency.decimals).toString());
	const rateValue = $derived(
		fromMinorUnits(data.project.hourlyRate, data.currency.decimals).toFixed(data.currency.decimals)
	);
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 text-sm">
		<a
			href={resolve('/clients/[id]', { id: data.project.clientId })}
			class="text-blue-700 hover:underline">← Client</a
		>
	</nav>

	<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<form method="post" use:enhance action="?/editProject" class="flex flex-wrap items-end gap-2">
			<label>
				<span class="block text-xs text-gray-600">Project</span>
				<input
					name="name"
					value={data.project.name}
					class="rounded border border-gray-300 px-2 py-1 text-xl font-semibold"
					required
					aria-label="Project name"
				/>
			</label>
			<label>
				<span class="block text-xs text-gray-600">Rate/hr ({data.currency.code})</span>
				<input
					name="hourlyRate"
					type="number"
					min="0"
					step={rateStep}
					value={rateValue}
					class="w-28 rounded border border-gray-300 px-2 py-1"
					required
				/>
			</label>
			<button
				type="submit"
				class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50">Save</button
			>
		</form>
		<div class="flex gap-2">
			{#if data.project.archivedAt}
				<form method="post" use:enhance action="?/unarchiveProject">
					<button
						type="submit"
						class="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
					>
						Unarchive
					</button>
				</form>
			{:else}
				<form method="post" use:enhance action="?/archiveProject">
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
					'Delete this project? Its tasks must be removed first. This cannot be undone.'
				)}
				action="?/deleteProject"
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
	{#if data.project.archivedAt}
		<p class="mb-4 text-xs text-gray-500">Archived {data.project.archivedAt}</p>
	{/if}

	<h2 class="mt-8 mb-3 text-lg font-medium">Tasks</h2>

	{#if form && 'success' in form && form.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">
			Task created.
		</div>
	{/if}
	{#if form && 'error' in form && form.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{String(form.error)}
		</div>
	{/if}

	<form method="post" use:enhance action="?/create" class="mb-6 flex flex-wrap items-end gap-2">
		<input
			name="name"
			placeholder="Task name"
			class="rounded border border-gray-300 px-3 py-2"
			required
		/>
		<input
			name="description"
			placeholder="Description (optional)"
			class="flex-1 rounded border border-gray-300 px-3 py-2"
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
				<li class="px-4 py-3">
					{#if task.archivedAt}
						<div class="flex items-center justify-between gap-2 opacity-50">
							<div>
								<div>{task.name}</div>
								{#if task.description}
									<div class="text-xs text-gray-500">{task.description}</div>
								{/if}
							</div>
							<form method="post" use:enhance action="?/unarchiveTask">
								<input type="hidden" name="taskId" value={task.id} />
								<button
									type="submit"
									class="rounded border border-gray-300 px-2 py-0.5 text-xs opacity-100 hover:bg-gray-50"
								>
									Unarchive
								</button>
							</form>
						</div>
					{:else}
						<div class="flex flex-wrap items-end gap-2">
							{#if !data.running}
								<form method="post" use:enhance action="/timer?/start">
									<input type="hidden" name="taskId" value={task.id} />
									<input type="hidden" name="goToEntry" value="1" />
									<button
										type="submit"
										class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
									>
										Start
									</button>
								</form>
							{/if}
							<form
								method="post"
								use:enhance
								action="?/updateTask"
								class="flex flex-1 flex-wrap items-end gap-2"
							>
								<input type="hidden" name="taskId" value={task.id} />
								<label>
									<span class="block text-xs text-gray-600">Name</span>
									<input
										name="name"
										value={task.name}
										class="rounded border border-gray-300 px-2 py-1"
										required
									/>
								</label>
								<label class="flex-1">
									<span class="block text-xs text-gray-600">Description</span>
									<input
										name="description"
										value={task.description}
										placeholder="—"
										class="w-full rounded border border-gray-300 px-2 py-1"
									/>
								</label>
								<button
									type="submit"
									class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
								>
									Save
								</button>
							</form>
							<form method="post" use:enhance action="?/archiveTask">
								<input type="hidden" name="taskId" value={task.id} />
								<button
									type="submit"
									class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
								>
									Archive
								</button>
							</form>
							<form
								method="post"
								use:enhance={confirmSubmit('Delete this task? This cannot be undone.')}
								action="?/deleteTask"
							>
								<input type="hidden" name="taskId" value={task.id} />
								<button
									type="submit"
									class="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
								>
									Delete
								</button>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
