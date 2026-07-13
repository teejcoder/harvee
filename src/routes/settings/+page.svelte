<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-2xl font-semibold">Settings</h1>

	{#if form?.success}
		<div class="mb-4 rounded border border-green-300 bg-green-50 p-3 text-green-800">Saved.</div>
	{/if}
	{#if form?.error}
		<div class="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
			{form.error}
		</div>
	{/if}

	<form method="post" use:enhance action="?/update" class="space-y-4">
		<fieldset class="space-y-3 rounded border border-gray-200 p-4">
			<legend class="px-2 text-sm font-medium text-gray-600">Sender</legend>

			<label class="block">
				<span class="text-sm">Name</span>
				<input
					name="senderName"
					value={data.settings.senderName}
					class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
					required
				/>
			</label>

			<label class="block">
				<span class="text-sm">Address</span>
				<textarea
					name="senderAddress"
					rows="3"
					class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
					required>{data.settings.senderAddress}</textarea
				>
			</label>

			<label class="block">
				<span class="text-sm">Email</span>
				<input
					name="senderEmail"
					type="email"
					value={data.settings.senderEmail}
					class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
					required
				/>
			</label>

			<label class="block">
				<span class="text-sm">Phone (optional)</span>
				<input
					name="senderPhone"
					value={data.settings.senderPhone ?? ''}
					class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
				/>
			</label>

			<label class="block">
				<span class="text-sm">Payment instructions</span>
				<textarea
					name="paymentInstructions"
					rows="3"
					class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
					required>{data.settings.paymentInstructions}</textarea
				>
			</label>
		</fieldset>

		<fieldset class="space-y-3 rounded border border-gray-200 p-4">
			<legend class="px-2 text-sm font-medium text-gray-600">Money</legend>

			<div class="grid grid-cols-3 gap-3">
				<label class="block">
					<span class="text-sm">Currency</span>
					<input
						name="currencyCode"
						value={data.settings.currencyCode}
						class="mt-1 w-full rounded border border-gray-300 px-2 py-1 uppercase"
						maxlength="3"
						required
					/>
				</label>
				<label class="block">
					<span class="text-sm">Decimals</span>
					<input
						name="currencyDecimals"
						type="number"
						value={data.settings.currencyDecimals}
						class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
						min="0"
						max="4"
						required
					/>
				</label>
				<label class="block">
					<span class="text-sm">Default payment terms (days)</span>
					<input
						name="defaultPaymentTermsDays"
						type="number"
						value={data.settings.defaultPaymentTermsDays}
						class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
						min="0"
						required
					/>
				</label>
			</div>

			<label class="block">
				<span class="text-sm">Invoice locale (e.g. en-US)</span>
				<input
					name="invoiceLocale"
					value={data.settings.invoiceLocale}
					class="mt-1 w-full rounded border border-gray-300 px-2 py-1"
					required
				/>
			</label>
		</fieldset>

		<button
			type="submit"
			class="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
		>
			Save
		</button>
	</form>
</div>
