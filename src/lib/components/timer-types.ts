export interface TaskOption {
	id: string;
	name: string;
	projectName: string;
	clientName: string;
}

export interface RunningEntryView {
	id: string;
	taskId: string;
	taskName: string;
	projectName: string;
	clientName: string;
	notes: string;
	openSegmentStartedAt: string;
}
