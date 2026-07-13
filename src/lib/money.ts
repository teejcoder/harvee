// Money helpers. All monetary values are integer minor units (cents for USD);
// formatting/parsing happens at the edges. One place for the minor↔major math so
// non-2-decimal currencies (JPY=0, etc.) are handled correctly everywhere.
//
// Pure utility (no I/O, no side effects) — exempt from the "every function logs"
// rule per .memory/conventions.md §6.

// Format integer minor units as a localized currency string. A bad currency/locale
// (Intl throws RangeError) falls back to a plain fixed-decimal number so a rendering
// path can never crash on stored config.
export function formatMoney(
	minorUnits: number,
	currencyCode: string,
	currencyDecimals: number,
	locale: string
): string {
	const value = minorUnits / 10 ** currencyDecimals;
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: currencyCode,
			minimumFractionDigits: currencyDecimals,
			maximumFractionDigits: currencyDecimals
		}).format(value);
	} catch {
		const safeDecimals = Math.max(0, Math.min(currencyDecimals, 8));
		return `${value.toFixed(safeDecimals)} ${currencyCode}`;
	}
}

// Convert a value entered in major units (e.g. dollars) to integer minor units,
// respecting the currency's decimal places (USD→×100, JPY→×1).
export function toMinorUnits(major: number, currencyDecimals: number): number {
	return Math.round(major * 10 ** currencyDecimals);
}

// Convert integer minor units back to a major-unit number (for input values).
export function fromMinorUnits(minorUnits: number, currencyDecimals: number): number {
	return minorUnits / 10 ** currencyDecimals;
}
