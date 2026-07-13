<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import TimerWidget from '$lib/components/TimerWidget.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const navLinks = $derived([
		{ label: 'Home', href: resolve('/'), match: '/' },
		{ label: 'Clients', href: resolve('/clients'), match: '/clients' },
		{ label: 'Invoices', href: resolve('/invoices'), match: '/invoices' },
		{
			label: 'Calendar',
			href: resolve('/calendar/day/[date]', { date: data.today }),
			match: '/calendar'
		},
		{ label: 'Settings', href: resolve('/settings'), match: '/settings' }
	]);

	// Highlight the active section by matching the current path's first segment.
	const section = $derived('/' + (page.url.pathname.split('/')[1] ?? ''));

	// The Timer's start/stop actions live on /timer. When either action
	// returns an ActionFailure, $page.form contains the error object. We
	// forward it to the widget for display.
	const formError = $derived(
		page.form && typeof page.form === 'object' && 'error' in page.form
			? String((page.form as { error: unknown }).error)
			: undefined
	);

	// Global toast: surface any enhanced action's result regardless of scroll
	// position (the per-page banners stay for on-page context). page.form updates
	// in place on every use:enhance submit.
	let toast = $state<{ kind: 'success' | 'error'; msg: string } | null>(null);
	let lastForm: unknown = undefined;
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const f = page.form;
		if (f === lastForm) return;
		lastForm = f;
		if (!f || typeof f !== 'object') return;
		const next =
			'error' in f && f.error
				? { kind: 'error' as const, msg: String((f as { error: unknown }).error) }
				: 'success' in f && (f as { success?: unknown }).success
					? { kind: 'success' as const, msg: 'Saved' }
					: null;
		if (!next) return;
		toast = next;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3000);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<nav class="w-full border-b border-gray-200 bg-gray-50">
	<div class="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2">
		<a href={resolve('/')} class="mr-3 font-semibold text-gray-900">harvee</a>
		{#each navLinks as link (link.href)}
			<a
				href={link.href}
				class="rounded px-3 py-1 text-sm hover:bg-gray-200"
				class:bg-gray-200={section === link.match}
				class:font-medium={section === link.match}
				aria-current={section === link.match ? 'page' : undefined}
			>
				{link.label}
			</a>
		{/each}
	</div>
</nav>

<TimerWidget
	activeTasks={data.activeTasks}
	running={data.running}
	todayHours={data.todayHours}
	{formError}
/>

{@render children()}

{#if toast}
	<div
		role="status"
		aria-live="polite"
		class="fixed right-4 bottom-4 z-50 rounded px-4 py-2 text-sm font-medium text-white shadow-lg"
		class:bg-gray-800={toast.kind === 'success'}
		class:bg-red-600={toast.kind === 'error'}
	>
		{toast.msg}
	</div>
{/if}
