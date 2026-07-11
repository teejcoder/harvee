// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			// Present on state-changing requests (non-GET, non-HEAD); undefined on read paths.
			// Minted by src/hooks.server.ts and threaded through the write call chain.
			// See .memory/conventions.md §5.
			correlationId?: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
