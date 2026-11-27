import { REPOS } from "../../../worker/src/config";
import { makeRef, parseRef } from "../../../worker/src/types";

/** The page the hash points at. `task` comes from a note link and is swapped for a real page once the board loads. */
export type Route =
    | { page: "inbox" }
    | { page: "next" }
    | { page: "settings" }
    | { page: "area"; name: string }
    | { page: "project"; ref: string }
    | { page: "task"; repo: string; number: number };

/** Turns a hash such as `#/project/st4eve%2FMyLife%2312` or `#/task/MyLife/12` into a route. Unknown or malformed hashes give the inbox. */
export function parseRoute(hash: string): Route {
    const [page, ...rest] = hash.replace(/^#\/?/, "").split("/");
    let arg: string;
    try {
        arg = decodeURIComponent(rest.join("/"));
    } catch {
        return { page: "inbox" }; // a malformed percent-encoding is not a page
    }
    if (page === "next" || page === "settings") return { page };
    if (page === "area" && arg) return { page, name: arg };
    if (page === "project" && parseRef(arg)) return { page, ref: arg };
    if (page === "task" && rest.length === 2 && rest[0] && /^\d+$/.test(rest[1]) && Number(rest[1]) > 0) {
        return { page, repo: rest[0], number: Number(rest[1]) };
    }
    return { page: "inbox" };
}

/** Hash link to an area page. */
export function areaHref(name: string): string {
    return `#/area/${encodeURIComponent(name)}`;
}

/** Hash link to a project page; the ref is encoded so `/` and `#` survive. */
export function projectHref(ref: string): string {
    return `#/project/${encodeURIComponent(ref)}`;
}

/** Full ref for a short task reference such as `MyLife` and 12, matching the name part of a board repo and ignoring case, or null when no board repo has that name. */
export function fullRef(repo: string, number: number): string | null {
    const match = REPOS.find((r) => r.split("/")[1].toLowerCase() === repo.toLowerCase());
    return match ? makeRef(match, number) : null;
}
