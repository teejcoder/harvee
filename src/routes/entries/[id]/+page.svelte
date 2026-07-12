<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	function fmtHours(startedAt: string, stoppedAt: string | null): string {
		if (!stoppedAt) return 'open';
		const ms = new Date(stoppedAt).getTime() - new Date(startedAt).getTime();
		return `${(ms / 3_600_000).toFixed(2)}h`;
	}

	const totalHours = $derived(
		data.segments.reduce((sum, s) => {
			if (!s.stoppedAt) return sum;
			return sum + (new Date(s.stoppedAt).getTime() - new Date(s.startedAt).getTime()) / 3_600_000;
		}, 0)
	);
</script>

<div class="mx-auto max-w-3xl p-6">
	<div class="mb-4 text-sm text-gray-500">
		{data.context.clientName} · {data.context.projectName}
	</div>
	<h1 class="mb-1 text-2xl font-semibold">{data.context.taskName}</h1>
	<p class="mb-6 text-sm text-gray-600">
		State: <span class="font-mono">{data.entry.state}</span> · Total {totalHours.toFixed(2)}h
	</p>

	{#if form && 'success' in form && form.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">Saved.</div>
	{/if}
	{#if form && 'error' in form && form.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{String(form.error)}
		</div>
	{/if}

	<!-- Notes editor (always visible unless locked) -->
	{#if data.entry.state !== 'entry.locked'}
		<section class="mb-6">
			<h2 class="mb-2 text-sm font-medium text-gray-700">Notes</h2>
			<form method="post" action="?/updateNotes" class="space-y-2">
				<textarea
					name="notes"
					rows="4"
					class="w-full rounded border border-gray-300 px-3 py-2"
					placeholder="What did you work on?">{data.entry.notes}</textarea
				>
				<button
					type="submit"
					class="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
				>
					Save notes
				</button>
			</form>
		</section>
	{/if}

	<!-- Segments -->
	<section class="mb-6">
		<h2 class="mb-2 text-sm font-medium text-gray-700">Segments</h2>
		{#if data.segments.length === 0}
			<p class="text-gray-500">No segments.</p>
		{:else if data.entry.state === 'entry.editing'}
			<ul class="space-y-2">
				{#each data.segments as seg (seg.id)}
					<li class="rounded border border-gray-200 p-3">
						<form method="post" action="?/updateSegment" class="flex flex-wrap items-end gap-2">
							<input type="hidden" name="segmentId" value={seg.id} />
							<label class="flex-1">
								<span class="block text-xs text-gray-600">Started (UTC ISO)</span>
								<input
									name="startedAt"
									value={seg.startedAt}
									class="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
								/>
							</label>
							<label class="flex-1">
								<span class="block text-xs text-gray-600">Stopped (UTC ISO)</span>
								<input
									name="stoppedAt"
									value={seg.stoppedAt ?? ''}
									class="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
								/>
							</label>
							<button
								type="submit"
								class="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
							>
								Save
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<ul class="divide-y divide-gray-200 rounded border border-gray-200">
				{#each data.segments as seg (seg.id)}
					<li class="flex items-center justify-between px-4 py-2 font-mono text-sm">
						<span>{seg.startedAt} → {seg.stoppedAt ?? '(open)'}</span>
						<span>{fmtHours(seg.startedAt, seg.stoppedAt)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Actions -->
	<section class="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
		{#if data.entry.state === 'entry.stopped'}
			<form method="post" action="?/openEdit">
				<button
					type="submit"
					class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
				>
					Edit segments
				</button>
			</form>
			<form method="post" action="?/resume">
				<button
					type="submit"
					class="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
				>
					Resume
				</button>
			</form>
			<form method="post" action="?/discard">
				<button
					type="submit"
					class="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
				>
					Discard
				</button>
			</form>
		{/if}
		{#if data.entry.state === 'entry.editing'}
			<form method="post" action="?/saveEdit">
				<button
					type="submit"
					class="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
				>
					Done editing
				</button>
			</form>
			<form method="post" action="?/cancelEdit">
				<button
					type="submit"
					class="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
				>
					Cancel edits
				</button>
			</form>
		{/if}
	</section>
</div>
