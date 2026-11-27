import { parseRoute, type Route } from "./route";
export { areaHref, parseRoute, projectHref, type Route } from "./route";

let hash = $state(location.hash);
window.addEventListener("hashchange", () => (hash = location.hash));

/** The current route, updates when the hash changes. */
export const router = {
    get route(): Route {
        return parseRoute(hash);
    },
};

/** Swaps the address for `next` without a new history entry, so Back skips the old one, and updates `router.route` at once (replaceState fires no hashchange). */
export function replaceRoute(next: string): void {
    history.replaceState(null, "", next);
    hash = next;
}
