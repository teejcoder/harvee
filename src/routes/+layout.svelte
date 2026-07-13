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

<TimerWidget activeTasks={data.activeTasks} running={data.running} {formError} />

{@render children()}
