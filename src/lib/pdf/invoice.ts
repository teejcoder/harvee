// Invoice PDF renderer (Step 6.6). Pure: builds bytes from a snapshot, no I/O
// beyond pdf-lib. All money/date formatting uses the values snapshotted onto the
// invoice row (currencyCode / currencyDecimals / invoiceLocale) per
// .memory/domain-model.md §3 — historical invoices always render in the currency
// and locale they were finalized under.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { localDateOf } from '$lib/time';
import { log } from '$lib/log';
import type { Invoice } from '$lib/db/queries/invoices';
import type { LineItem } from '$lib/db/queries/lineItems';
import type { Settings } from '$lib/db/queries/settings';
import type { Client } from '$lib/db/queries/clients';

export interface RenderInvoiceInput {
	invoice: Invoice;
	client: Pick<Client, 'id' | 'name'>;
	settings: Settings;
	lines: LineItem[];
}

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 54;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);

// Add whole days to a YYYY-MM-DD calendar date. UTC math on a date-only value
// sidesteps DST — we only care about the calendar day, not a wall-clock instant.
function addDays(localDate: string, days: number): string {
	const d = new Date(`${localDate}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

// pdf-lib's standard fonts encode with WinAnsi (CP1252) and THROW on any code
// point it can't represent. Every string we draw may contain user-supplied text
// (line/task descriptions, notes, sender fields, payment instructions), so an
// emoji or CJK char could otherwise crash the whole export — a denial-of-service
// on invoicing. Sanitize defensively: keep everything CP1252 can encode, replace
// the rest. This is the trust boundary between user input and the PDF encoder.
const CP1252_EXTRAS = new Set([
	0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
	0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
	0x0153, 0x017e, 0x0178
]);
const ASCII_FALLBACK: Record<string, string> = { '→': '->', '←': '<-' };
function winAnsi(s: string): string {
	let out = '';
	for (const ch of s) {
		const cp = ch.codePointAt(0) ?? 0;
		if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRAS.has(cp)) {
			out += ch;
		} else {
			out += ASCII_FALLBACK[ch] ?? '?';
		}
	}
	return out;
}

export async function renderInvoicePdf(
	input: RenderInvoiceInput,
	correlationId: string
): Promise<Uint8Array> {
	const { invoice, client, settings, lines } = input;
	log.debug({
		event: 'pdf.invoice.render.enter',
		correlationId,
		entityType: 'invoice',
		entityId: invoice.id,
		lineCount: lines.length
	});

	// Build the currency formatter once. A bad snapshotted currency/locale (Intl
	// throws RangeError) must not crash the render — fall back to a plain number.
	let numberFormat: Intl.NumberFormat | null = null;
	try {
		numberFormat = new Intl.NumberFormat(invoice.invoiceLocale, {
			style: 'currency',
			currency: invoice.currencyCode,
			minimumFractionDigits: invoice.currencyDecimals,
			maximumFractionDigits: invoice.currencyDecimals
		});
	} catch (err) {
		log.warn({
			event: 'pdf.invoice.currencyFormat.fallback',
			correlationId,
			entityType: 'invoice',
			entityId: invoice.id,
			currencyCode: invoice.currencyCode,
			invoiceLocale: invoice.invoiceLocale,
			reason: (err as Error).message
		});
	}
	const decimals = Math.max(0, Math.min(invoice.currencyDecimals, 8));
	const money = (minor: number): string => {
		const value = minor / 10 ** invoice.currencyDecimals;
		return numberFormat
			? numberFormat.format(value)
			: `${value.toFixed(decimals)} ${invoice.currencyCode}`;
	};

	const issueDate = invoice.finalizedAt ? localDateOf(invoice.finalizedAt) : '';
	const dueDate = issueDate ? addDays(issueDate, invoice.paymentTermsDays) : '';

	const doc = await PDFDocument.create();
	const page = doc.addPage([PAGE_W, PAGE_H]);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);

	let y = PAGE_H - MARGIN;

	const text = (
		s: string,
		x: number,
		yPos: number,
		size = 10,
		f: PDFFont = font,
		color = INK
	): void => {
		page.drawText(winAnsi(s), { x, y: yPos, size, font: f, color });
	};

	// Right-aligned text ending at `right`.
	const textRight = (
		s: string,
		right: number,
		yPos: number,
		size = 10,
		f: PDFFont = font,
		color = INK
	): void => {
		const t = winAnsi(s);
		const w = f.widthOfTextAtSize(t, size);
		page.drawText(t, { x: right - w, y: yPos, size, font: f, color });
	};

	const rule = (yPos: number, p: PDFPage = page): void => {
		p.drawLine({
			start: { x: MARGIN, y: yPos },
			end: { x: PAGE_W - MARGIN, y: yPos },
			thickness: 0.75,
			color: MUTED
		});
	};

	// --- Header: title + invoice number ---
	text('INVOICE', MARGIN, y - 6, 24, bold);
	textRight(invoice.invoiceNumber ?? 'DRAFT', PAGE_W - MARGIN, y - 2, 14, bold);
	textRight(invoice.state.replace('invoice.', ''), PAGE_W - MARGIN, y - 18, 9, font, MUTED);
	y -= 44;

	// --- Sender block ---
	text('From', MARGIN, y, 8, bold, MUTED);
	y -= 14;
	text(settings.senderName, MARGIN, y, 11, bold);
	y -= 14;
	for (const line of settings.senderAddress.split('\n')) {
		if (line.trim().length === 0) continue;
		text(line, MARGIN, y, 10, font, MUTED);
		y -= 13;
	}
	text(settings.senderEmail, MARGIN, y, 10, font, MUTED);
	y -= 13;
	if (settings.senderPhone) {
		text(settings.senderPhone, MARGIN, y, 10, font, MUTED);
		y -= 13;
	}

	// --- Bill-to + meta (two columns from a shared baseline) ---
	y -= 12;
	const metaTop = y;
	text('Bill to', MARGIN, y, 8, bold, MUTED);
	text(client.name, MARGIN, y - 14, 11, bold);

	const metaX = 340;
	const metaRight = PAGE_W - MARGIN;
	let my = metaTop;
	const metaRow = (label: string, value: string): void => {
		text(label, metaX, my, 9, font, MUTED);
		textRight(value, metaRight, my, 9, font);
		my -= 14;
	};
	metaRow('Invoice #', invoice.invoiceNumber ?? '—');
	metaRow('Issued', issueDate || '—');
	metaRow('Due', dueDate || '—');
	metaRow('Period', `${invoice.startDate} – ${invoice.endDate}`);
	metaRow('Terms', `Net ${invoice.paymentTermsDays}`);

	y = Math.min(metaTop - 14 * 2, my) - 24;

	// --- Line-items table ---
	const colHours = 360;
	const colRate = 452;
	const colAmount = PAGE_W - MARGIN;
	rule(y + 14);
	text('Description', MARGIN, y, 8, bold, MUTED);
	textRight('Hours', colHours, y, 8, bold, MUTED);
	textRight('Rate', colRate, y, 8, bold, MUTED);
	textRight('Amount', colAmount, y, 8, bold, MUTED);
	y -= 8;
	rule(y);
	y -= 18;

	for (const line of lines) {
		text(line.description, MARGIN, y, 10);
		if (line.hours !== null) textRight(line.hours.toFixed(2), colHours, y, 10);
		if (line.rate !== null) textRight(money(line.rate), colRate, y, 10);
		textRight(money(line.amount), colAmount, y, 10);
		y -= 18;
	}

	// --- Totals ---
	y -= 4;
	rule(y + 12);
	const totalRow = (label: string, value: string, strong = false): void => {
		const f = strong ? bold : font;
		text(label, colRate - 40, y, strong ? 11 : 10, f, strong ? INK : MUTED);
		textRight(value, colAmount, y, strong ? 12 : 10, f);
		y -= 18;
	};
	totalRow('Subtotal', money(invoice.subtotal));
	if (invoice.discountTotal !== 0) totalRow('Discount', money(invoice.discountTotal));
	totalRow('Total', money(invoice.total), true);

	// --- Payment instructions (multiline, same handling as the sender address) ---
	if (settings.paymentInstructions.trim().length > 0) {
		y -= 12;
		text('Payment instructions', MARGIN, y, 8, bold, MUTED);
		y -= 14;
		for (const line of settings.paymentInstructions.split('\n')) {
			if (line.trim().length === 0) continue;
			text(line, MARGIN, y, 10);
			y -= 13;
		}
	}

	// --- Footer ---
	text(
		dueDate ? `Payment due by ${dueDate}.` : 'Draft — not yet finalized.',
		MARGIN,
		MARGIN,
		9,
		font,
		MUTED
	);

	const bytes = await doc.save();
	log.debug({
		event: 'pdf.invoice.render.exit',
		correlationId,
		entityType: 'invoice',
		entityId: invoice.id,
		bytes: bytes.length
	});
	return bytes;
}
