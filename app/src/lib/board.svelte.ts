import { priorityRank, projectOf } from "../../../worker/src/types";
import { closeTaskNotPlanned, deleteTask, fetchBoard, postPriority, postStatus, type BoardItem, type StatusWrite } from "./api";

/** Board state shared by every component. Fill it with `loadBoard`. `selected` is the ref of the task whose sheet is open. `busy` is true while a deletion is waiting on the Worker, so the sheet shows a spinner and stays open. */
export const board: { items: BoardItem[]; error: string; selected: string | null; busy: boolean } = $state({
    items: [],
    error: "",
    selected: null,
    busy: false,
});

/** The card being dragged between columns (mouse only), or `null`. Set by `Card`, read by `Board` to dim the columns that refuse it. */
export const drag: { item: BoardItem | null } = $state({ item: null });

/** Opens the detail sheet for a task by ref, or closes it with `null`. */
export function select(ref: string | null): void {
    board.selected = ref;
}

/** Fetches the board from the Worker into `board`, putting any failure in `board.error`. */
export async function loadBoard(): Promise<void> {
    try {
        board.items = await fetchBoard();
        board.error = "";
    } catch (e) {
        board.error = String(e);
    }
}

/** Open projects, in board order. */
export function openProjects(items: BoardItem[]): BoardItem[] {
    return items.filter((i) => i.isProject && i.open);
}

/** Area names that have an open project or an open, triaged flat task, sorted. */
export function areaNames(items: BoardItem[]): string[] {
    const names = items.filter((i) => i.open && (i.isProject || (i.parent === null && i.status !== "Inbox"))).map((i) => i.area);
    return [...new Set(names.filter((n): n is string => n !== null))].sort();
}

/** Open projects in one area, highest priority first, then repo and number. */
export function projectsIn(items: BoardItem[], area: string): BoardItem[] {
    return openProjects(items)
        .filter((p) => p.area === area)
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.repo.localeCompare(b.repo) || a.number - b.number);
}

/** Open, triaged tasks in one area that belong to no project, highest priority first. */
export function flatTasksIn(items: BoardItem[], area: string): BoardItem[] {
    return items
        .filter((i) => i.open && !i.isProject && i.area === area && i.status !== "Inbox" && !projectOf(items, i))
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.repo.localeCompare(b.repo) || a.number - b.number);
}

/** Open tasks of one project, by repo then issue number. */
export function tasksOf(items: BoardItem[], project: string): BoardItem[] {
    return items
        .filter((i) => i.open && !i.isProject && i.parent === project)
        .sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
}

// shows what the Worker changed; a Done task is closed, so it leaves the open lists
function apply(writes: StatusWrite[]): void {
    for (const w of writes) {
        const item = board.items.find((i) => i.id === w.id);
        if (item) {
            item.status = w.status;
            item.open = w.status !== "Done";
        }
    }
}

/** Sets an item's status: the card moves at once, then the Worker's answer (including tasks paused with a project) is applied. If the Worker refuses, the card goes back and the reason is put in `board.error`. */
export async function changeStatus(item: BoardItem, status: string): Promise<void> {
    const before = { status: item.status, open: item.open };
    apply([{ id: item.id, ref: item.ref, status }]);
    try {
        apply(await postStatus(item.id, status));
        board.error = "";
    } catch (e) {
        item.status = before.status;
        item.open = before.open;
        board.error = e instanceof Error ? e.message : String(e);
    }
}

/** Sets an item's priority: the chip changes at once. If the Worker refuses, it goes back and the reason is put in `board.error`. */
export async function changePriority(item: BoardItem, priority: string): Promise<void> {
    const before = item.priority;
    item.priority = priority;
    try {
        await postPriority(item.id, priority);
        board.error = "";
    } catch (e) {
        item.priority = before;
        board.error = e instanceof Error ? e.message : String(e);
    }
}

/** Permanently deletes an inbox task: the Worker deletes the issue, then the task leaves the board and its sheet closes. A refusal is put in `board.error` and the task stays. */
export async function removeTask(item: BoardItem): Promise<void> {
    board.busy = true;
    try {
        await deleteTask(item.ref);
        board.items = board.items.filter((i) => i.id !== item.id);
        board.selected = null;
        board.error = "";
    } catch (e) {
        board.error = e instanceof Error ? e.message : String(e);
    } finally {
        board.busy = false;
    }
}

/** Closes a triaged task as not planned: the Worker closes the issue, then the task leaves the open lists and its sheet closes. A refusal is put in `board.error` and the task stays. */
export async function dropTask(item: BoardItem): Promise<void> {
    board.busy = true;
    try {
        await closeTaskNotPlanned(item.ref);
        item.open = false;
        item.status = "Done";
        board.selected = null;
        board.error = "";
    } catch (e) {
        board.error = e instanceof Error ? e.message : String(e);
    } finally {
        board.busy = false;
    }
}

/** Open tasks in the Inbox, most recently changed first. */
export function inboxTasks(items: BoardItem[]): BoardItem[] {
    return items.filter((i) => i.open && !i.isProject && i.status === "Inbox").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
