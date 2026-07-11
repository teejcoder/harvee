import type { RejectionReason } from '../log';

export class StateTransitionError extends Error {
	constructor(
		public rejectionReason: RejectionReason,
		message: string
	) {
		super(message);
		this.name = 'StateTransitionError';
	}
}
