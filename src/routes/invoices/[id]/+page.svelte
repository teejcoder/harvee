<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatMoney, fromMinorUnits } from '$lib/money';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const fmtMoney = (minor: number): string =>
		formatMoney(
			minor,
			data.invoice.currencyCode,
			data.invoice.currencyDecimals,
			data.invoice.invoiceLocale
		);

	// Confirm before a destructive, enhanced submit; cancel keeps the page untouched.
	const confirmSubmit =
		(message: string): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(message)) cancel();
		};

	const isDraft = $derived(data.invoice.state === 'invoice.draft');
	const isFinalizedish = $derived(
		data.invoice.state === 'invoice.finalized' || data.invoice.state === 'invoice.exported'
	);
</script>

<div class="mx-auto max-w-3xl p-6">
	<nav class="mb-4 text-sm">
		<a href={resolve('/clients/[id]', { id: data.client.id })} class="text-blue-700 hover:underline"
			>← {data.client.name}</a
		>
	</nav>

	<div class="mb-2 flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{data.invoice.invoiceNumber ?? 'Draft invoice'}
		</h1>
		<span class="rounded bg-gray-100 px-2 py-1 font-mono text-xs">{data.invoice.state}</span>
	</div>
	<p class="mb-6 text-sm text-gray-600">
		{data.invoice.startDate} → {data.invoice.endDate} · Terms Net {data.invoice.paymentTermsDays}
	</p>

	{#if form && 'success' in form && form.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">Saved.</div>
	{/if}
	{#if form && 'error' in form && form.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{String(form.error)}
		</div>
	{/if}

	<!-- Line items -->
	<section class="mb-6 rounded border border-gray-200">
		<table class="w-full text-sm">
			<thead class="bg-gray-50 text-left text-xs text-gray-600">
				<tr>
					<th class="px-3 py-2">Description</th>
					<th class="px-3 py-2 text-right">Hours</th>
					<th class="px-3 py-2 text-right">Rate</th>
					<th class="px-3 py-2 text-right">Amount</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-200">
				{#each data.lines as line (line.id)}
					<tr>
						<td class="px-3 py-2">{line.description}</td>
						<td class="px-3 py-2 text-right font-mono">
							{line.hours !== null ? line.hours.toFixed(2) : ''}
						</td>
						<td class="px-3 py-2 text-right font-mono">
							{line.rate !== null ? fmtMoney(line.rate) : ''}
						</td>
						<td class="px-3 py-2 text-right font-mono">{fmtMoney(line.amount)}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot class="border-t-2 border-gray-300 bg-gray-50">
				<tr>
					<td colspan="3" class="px-3 py-2 text-right text-xs text-gray-600">Subtotal</td>
					<td class="px-3 py-2 text-right font-mono">{fmtMoney(data.invoice.subtotal)}</td>
				</tr>
				{#if data.invoice.discountTotal !== 0}
					<tr>
						<td colspan="3" class="px-3 py-2 text-right text-xs text-gray-600">Discount</td>
						<td class="px-3 py-2 text-right font-mono">{fmtMoney(data.invoice.discountTotal)}</td>
					</tr>
				{/if}
				<tr class="font-semibold">
					<td colspan="3" class="px-3 py-2 text-right">Total</td>
					<td class="px-3 py-2 text-right font-mono">{fmtMoney(data.invoice.total)}</td>
				</tr>
			</tfoot>
		</table>
	</section>

	<!-- Draft-only editing -->
	{#if isDraft}
		<section class="mb-6 rounded border border-gray-200 p-4">
			<h2 class="mb-3 text-sm font-medium text-gray-700">Edit task lines</h2>
			<ul class="space-y-3">
				{#each data.lines.filter((l) => l.kind === 'task') as line (line.id)}
					<li>
						<form
							method="post"
							use:enhance
							action="?/updateLine"
							class="flex flex-wrap items-end gap-2"
						>
							<input type="hidden" name="lineId" value={line.id} />
							<label class="flex-1">
								<span class="block text-xs text-gray-600">Description</span>
								<input
									name="description"
									value={line.description}
									class="w-full rounded border border-gray-300 px-2 py-1"
									required
								/>
							</label>
							<label>
								<span class="block text-xs text-gray-600">Hours</span>
								<input
									name="hours"
									type="number"
									min="0.01"
									step="0.01"
									value={line.hours}
									class="w-24 rounded border border-gray-300 px-2 py-1"
									required
								/>
							</label>
							<label>
								<span class="block text-xs text-gray-600">Rate ({data.invoice.currencyCode})</span>
								<input
									name="rate"
									type="number"
									min="0"
									step={(10 ** -data.invoice.currencyDecimals).toString()}
									value={fromMinorUnits(line.rate ?? 0, data.invoice.currencyDecimals).toFixed(
										data.invoice.currencyDecimals
									)}
									class="w-28 rounded border border-gray-300 px-2 py-1"
									required
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
		</section>

		<section class="mb-6 rounded border border-gray-200 p-4">
			<h2 class="mb-2 text-sm font-medium text-gray-700">Discount line</h2>
			{#if data.lines.some((l) => l.kind === 'discount')}
				<form method="post" use:enhance action="?/removeDiscount">
					<button
						type="submit"
						class="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
					>
						Remove discount
					</button>
				</form>
			{:else}
				<form
					method="post"
					use:enhance
					action="?/addDiscount"
					class="flex flex-wrap items-end gap-2"
				>
					<label class="flex-1">
						<span class="block text-xs text-gray-600">Description</span>
						<input
							name="description"
							placeholder="Early-pay discount"
							class="w-full rounded border border-gray-300 px-3 py-2"
						/>
					</label>
					<label>
						<span class="block text-xs text-gray-600">Amount ({data.invoice.currencyCode})</span>
						<input
							name="amount"
							type="number"
							min="0"
							step={(10 ** -data.invoice.currencyDecimals).toString()}
							class="w-32 rounded border border-gray-300 px-3 py-2"
							required
						/>
					</label>
					<button
						type="submit"
						class="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
					>
						Add
					</button>
				</form>
			{/if}
		</section>
	{/if}

	<!-- Actions -->
	<section class="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
		{#if isDraft}
			<form
				method="post"
				use:enhance={confirmSubmit(
					'Finalize this invoice? It gets a number, locks its time entries, and can no longer be edited.'
				)}
				action="?/finalize"
			>
				<button
					type="submit"
					class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
				>
					Finalize
				</button>
			</form>
			<form
				method="post"
				use:enhance={confirmSubmit('Delete this draft invoice? This cannot be undone.')}
				action="?/delete"
			>
				<button
					type="submit"
					class="rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
				>
					Delete draft
				</button>
			</form>
		{/if}
		{#if isFinalizedish}
			<form method="post" action={resolve('/invoices/[id]/export', { id: data.invoice.id })}>
				<button
					type="submit"
					class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
				>
					Export PDF
				</button>
			</form>
			<form
				method="post"
				use:enhance={confirmSubmit(
					'Void this invoice? Its time entries will be discarded. This cannot be undone.'
				)}
				action="?/void"
			>
				<button
					type="submit"
					class="rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
				>
					Void
				</button>
			</form>
		{/if}
	</section>
</div>
