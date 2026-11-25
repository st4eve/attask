import { parseRef } from "../../../worker/src/types";

/** The page the hash points at. */
export type Route =
    | { page: "inbox" }
    | { page: "next" }
    | { page: "settings" }
    | { page: "area"; name: string }
    | { page: "project"; ref: string };

/** Turns a hash such as `#/project/st4eve%2FMyLife%2312` into a route. Unknown or malformed hashes give the inbox. */
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
