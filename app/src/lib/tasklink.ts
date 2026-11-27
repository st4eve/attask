import { projectOf, type BoardItem } from "../../../worker/src/types";
import { areaHref, fullRef, projectHref } from "./route";

/** Where a note link lands: the page to show, the task whose sheet opens (null for none), and an error line ("" for none). */
export interface Landing {
    hash: string;
    selected: string | null;
    error: string;
}

/**
 * Decides where a `#/task/<repo>/<number>` link lands once the board has loaded.
 *
 * Args:
 *     items: The whole board.
 *     repo: The repo name from the link, any case.
 *     number: The issue number.
 *
 * Returns:
 *     A project opens as its own page. A task opens its sheet over its project page, else its Area page, else the inbox. An unknown repo or a ref not on the board lands on the inbox with an error.
 */
export function taskLanding(items: BoardItem[], repo: string, number: number): Landing {
    const ref = fullRef(repo, number);
    if (!ref) return { hash: "#/inbox", selected: null, error: `${repo}#${number} isn't a board repo` };
    const item = items.find((i) => i.ref === ref);
    if (!item) return { hash: "#/inbox", selected: null, error: `${ref} isn't on the board` };
    if (item.isProject) return { hash: projectHref(ref), selected: null, error: "" };
    const project = projectOf(items, item);
    const hash = project ? projectHref(project.ref) : item.area ? areaHref(item.area) : "#/inbox";
    return { hash, selected: ref, error: "" };
}
