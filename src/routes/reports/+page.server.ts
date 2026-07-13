import { redirect } from '@sveltejs/kit';
import { localDateOf, nowUtcIso } from '$lib/time';
import type { PageServerLoad } from './$types';

// /reports → the current month's report.
export const load: PageServerLoad = () => {
	throw redirect(302, `/reports/${localDateOf(nowUtcIso()).slice(0, 7)}`);
};
