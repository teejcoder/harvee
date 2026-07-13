<script lang="ts">
	import { enhance } from '$app/forms';
	import type { RunningEntryView, TaskOption } from './timer-types';

	interface Props {
		activeTasks: TaskOption[];
		recentTasks: TaskOption[];
		running: RunningEntryView | null;
		todayHours: number;
		formError?: string;
	}

	let { activeTasks, recentTasks, running, todayHours, formError }: Props = $props();

	const todayLabel = $derived(fmtHm(todayHours));
	function fmtHm(hours: number): string {
		const totalMin = Math.round(hours * 60);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	// Live elapsed-time display for a running entry.
	let now = $state(Date.now());
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const elapsed = $derived(
		running ? Math.max(0, now - new Date(running.openSegmentStartedAt).getTime()) : 0
	);
	const elapsedLabel = $derived(formatDuration(elapsed));

	function formatDuration(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	// Reflect the running timer in the browser tab so a background tab is obvious.
	$effect(() => {
		document.title = running ? `▶ ${elapsedLabel} · ${running.taskName}` : 'harvee';
		return () => {
			document.title = 'harvee';
		};
	});

	// Alt+S toggles: stop if running, else quick-start the most-recent task.
	let stopFormEl: HTMLFormElement | undefined = $state();
	let quickStartFormEl: HTMLFormElement | undefined = $state();
	function onKeydown(e: KeyboardEvent): void {
		if (!e.altKey || e.key.toLowerCase() !== 's') return;
		const tag = (e.target as HTMLElement | null)?.tagName ?? '';
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
		if (running) {
			e.preventDefault();
			stopFormEl?.requestSubmit();
		} else if (recentTasks.length > 0) {
			e.preventDefault();
			quickStartFormEl?.requestSubmit();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="w-full border-b border-gray-200 bg-white">
	<div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
		{#if running}
			<div class="flex-1">
				<div class="text-xs text-gray-500">{running.clientName} · {running.projectName}</div>
				<div class="font-medium">{running.taskName}</div>
			</div>
			<div class="font-mono text-lg tabular-nums" data-testid="elapsed">{elapsedLabel}</div>
			<form method="post" use:enhance action="/timer?/stop" bind:this={stopFormEl}>
				<input type="hidden" name="entryId" value={running.id} />
				<button
					type="submit"
					class="rounded bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
					title="Stop (Alt+S)">Stop</button
				>
			</form>
		{:else if activeTasks.length === 0}
			<div class="flex-1 text-sm text-gray-500">
				No active tasks. Create a client → project → task to begin.
			</div>
		{:else}
			<form method="post" use:enhance action="/timer?/start" class="flex flex-1 items-center gap-2">
				<select
					name="taskId"
					class="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
					required
				>
					{#each activeTasks as t (t.id)}
						<option value={t.id}>{t.clientName} · {t.projectName} · {t.name}</option>
					{/each}
				</select>
				<input
					name="notes"
					placeholder="Notes (optional)"
					class="hidden w-48 rounded border border-gray-300 px-3 py-2 sm:block"
				/>
				<button
					type="submit"
					class="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
					title="Start (Alt+S starts your most-recent task)">Start</button
				>
			</form>
		{/if}

		<div class="hidden text-right sm:block">
			<div class="text-xs text-gray-500">Today</div>
			<div class="font-mono text-sm tabular-nums">{todayLabel}</div>
		</div>
	</div>

	<!-- Hidden quick-start form (most-recent task) driven by the Alt+S shortcut. -->
	{#if !running && recentTasks.length > 0}
		<form
			method="post"
			use:enhance
			action="/timer?/start"
			bind:this={quickStartFormEl}
			class="hidden"
		>
			<input type="hidden" name="taskId" value={recentTasks[0].id} />
		</form>
	{/if}

	<!-- Recent-task quick-start chips (idle only) -->
	{#if !running && recentTasks.length > 0}
		<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 pb-3">
			<span class="text-xs text-gray-400">Recent:</span>
			{#each recentTasks as t (t.id)}
				<form method="post" use:enhance action="/timer?/start">
					<input type="hidden" name="taskId" value={t.id} />
					<button
						type="submit"
						class="rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-100"
						title="{t.clientName} · {t.projectName}">{t.name}</button
					>
				</form>
			{/each}
		</div>
	{/if}

	{#if formError}
		<div class="mx-auto max-w-5xl px-4 py-2 text-sm text-red-700">{formError}</div>
	{/if}
</div>
