import { monotonicFactory } from 'ulid';

const mint = monotonicFactory();

// Crockford base32, 26 chars, monotonic within the same millisecond.
// Single source of ULIDs in the codebase — see .memory/conventions.md §1.
// Exempt from the "every function logs" rule (pure utility) — see conventions.md §6.
export function ulid(): string {
	return mint();
}
