// Correlation ID origin. For every state-changing request (anything other
// than GET or HEAD) we mint one ULID at the top of the handle chain, stash
// it on event.locals.correlationId, and attach it as X-Correlation-Id on
// the response. Read paths (GET/HEAD) do NOT get a correlation ID — see
// .memory/conventions.md §5.

import type { Handle } from '@sveltejs/kit';
import { ulid } from '$lib/ids';
import { log } from '$lib/log';

const READ_METHODS = new Set(['GET', 'HEAD']);

export const handle: Handle = async ({ event, resolve }) => {
	const method = event.request.method;
	const isStateChange = !READ_METHODS.has(method);

	if (isStateChange) {
		event.locals.correlationId = ulid();
		log.debug({
			event: 'request.mint_correlation_id',
			correlationId: event.locals.correlationId,
			method,
			path: event.url.pathname
		});
	}

	const response = await resolve(event);

	if (isStateChange && event.locals.correlationId) {
		response.headers.set('X-Correlation-Id', event.locals.correlationId);
	}

	return response;
};
