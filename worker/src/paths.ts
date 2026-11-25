/**
 * Reads an issue route such as `/issues/owner/name/12/detail`.
 *
 * Args:
 * 	pathname: The request path.
 *
 * Returns:
 * 	The repo as `owner/name`, the issue number and the action (`''` for the issue itself), or null if the path is not an issue route.
 */
export function parseIssuePath(pathname: string): { repo: string; number: number; action: '' | 'detail' | 'not-planned' } | null {
	const m = pathname.match(/^\/issues\/([\w.-]+)\/([\w.-]+)\/(\d+)(?:\/(detail|not-planned))?$/);
	if (!m) return null;
	return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]), action: (m[4] ?? '') as '' | 'detail' | 'not-planned' };
}
