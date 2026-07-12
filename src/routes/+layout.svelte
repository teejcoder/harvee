<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import TimerWidget from '$lib/components/TimerWidget.svelte';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

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

<TimerWidget activeTasks={data.activeTasks} running={data.running} {formError} />

{@render children()}
