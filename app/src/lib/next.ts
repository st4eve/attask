import { priorityRank, projectOf, type BoardItem } from "../../../worker/src/types";

/** Choices of the time toggle: how long you have, or `any` for every task including unsized ones. */
export const TIMES: string[] = ["15m", "1h", "half-day", "any"];

// sizes that fit each time choice
const FITS: Record<string, string[]> = { "15m": ["XS"], "1h": ["XS", "S"], "half-day": ["XS", "S", "M"] };

/** Choices of the place toggle. `home` hides tasks labelled `lab`. */
export const PLACES: string[] = ["home", "lab"];

/** How far ahead a due date counts as soon, in days. */
const DUE_SOON_DAYS = 7;

/** The toggles of the Next page. */
export interface NextFilters {
    /** one of `TIMES` */
    time: string;
    /** one of `PLACES` */
    place: string;
    /** an Area name, or `all` */
    area: string;
    /** also list `Backlog` tasks, after the rest */
    backlog: boolean;
}

/**
 * A task's area: its own, else its project's.
 *
 * Args:
 *     items: The whole board.
 *     task: The task.
 */
export function areaOf(items: BoardItem[], task: BoardItem): string | null {
    return task.area ?? projectOf(items, task)?.area ?? null;
}

// true when the task is in the area; every task is in `all`
function inArea(items: BoardItem[], task: BoardItem, area: string): boolean {
    return area === "all" || areaOf(items, task) === area;
}

// true when the task's size fits the time toggle; unsized tasks fit only `any`
function fitsTime(task: BoardItem, time: string): boolean {
    if (time === "any") return true;
    return task.size !== null && (FITS[time] ?? []).includes(task.size);
}

// the date `days` after a YYYY-MM-DD date, in the same form
function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// tie-break shared by both lists so equal tasks keep a stable order across repos
function byRepoNumber(a: BoardItem, b: BoardItem): number {
    return a.repo.localeCompare(b.repo) || a.number - b.number;
}

/**
 * Open tasks that are overdue or due within 7 days, soonest first, blocked or not. Not filtered by time or place.
 *
 * Args:
 *     items: The whole board.
 *     area: An Area name, or `all`.
 *     today: Today's local date, YYYY-MM-DD.
 */
export function dueSoon(items: BoardItem[], area: string, today: string): BoardItem[] {
    const limit = addDays(today, DUE_SOON_DAYS);
    return items
        .filter((t) => t.open && !t.isProject && t.due !== null && t.due <= limit && inArea(items, t, area))
        .sort((a, b) => a.due!.localeCompare(b.due!) || byRepoNumber(a, b));
}

/**
 * What can be done now: open, unblocked tasks that pass the toggles. A flat task qualifies on its own status; a project task also needs its project In progress. Order: In progress (most recently updated first), then To do, then Backlog if asked for; the last two by priority (the task's own, else its project's), due date, repo and number.
 *
 * Args:
 *     items: The whole board.
 *     filters: The toggles.
 */
export function nextList(items: BoardItem[], filters: NextFilters): BoardItem[] {
    const groups = filters.backlog ? ["In progress", "To do", "Backlog"] : ["In progress", "To do"];
    const group = (t: BoardItem): number => groups.indexOf(t.status ?? "");
    const rank = (t: BoardItem): number => priorityRank(t.priority ?? projectOf(items, t)?.priority ?? null);
    return items
        .filter((t) => {
            const project = projectOf(items, t);
            return (
                t.open &&
                !t.isProject &&
                !t.blocked &&
                group(t) !== -1 &&
                (!project || project.status === "In progress") &&
                inArea(items, t, filters.area) &&
                fitsTime(t, filters.time) &&
                (filters.place === "lab" || !t.lab)
            );
        })
        .sort((a, b) => {
            if (group(a) !== group(b)) return group(a) - group(b);
            if (a.status === "In progress") return b.updatedAt.localeCompare(a.updatedAt);
            return rank(a) - rank(b) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || byRepoNumber(a, b);
        });
}
