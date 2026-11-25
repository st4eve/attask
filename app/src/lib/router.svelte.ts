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
