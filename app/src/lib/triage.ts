import { PAUSED_STATUSES, type BoardItem, type Proposal } from "../../../worker/src/types";
import { postFields, postParent, postPriority, postStatus } from "./api";

/** One line of the triage review list. */
export interface Row {
    proposal: Proposal;
    /** the task's title, from the board */
    title: string;
    /** left out of "apply all" */
    skipped: boolean;
    /** true while its writes are in flight */
    busy: boolean;
    /** why the last apply failed, empty if it didn't */
    error: string;
}

/** Turns proposals into rows. A row where Claude suggested nothing beyond a status starts skipped. */
export function toRows(proposals: Proposal[], items: BoardItem[]): Row[] {
    return proposals.map((p) => ({
        proposal: p,
        title: items.find((i) => i.id === p.id)?.title ?? p.ref,
        skipped: p.area === null && p.size === null && p.priority === null && p.parent === null,
        busy: false,
        error: "",
    }));
}

// the status a parent forces on its tasks, or null when it is active or there is none
function pausedStatus(parent: string | null, items: BoardItem[]): "Backlog" | "Waiting" | null {
    const project = items.find((i) => i.isProject && i.ref === parent);
    return project?.status && PAUSED_STATUSES.includes(project.status) ? (project.status as "Backlog" | "Waiting") : null;
}

/** The statuses a row may take: To do or Backlog, or only the project's status when its parent is paused. */
export function statusChoices(proposal: Proposal, items: BoardItem[]): Proposal["status"][] {
    const paused = pausedStatus(proposal.parent, items);
    return paused ? [paused] : ["To do", "Backlog"];
}

/** A copy of the proposal with a new parent. Its status follows a paused project, and goes back to To do when it leaves one. */
export function setParent(proposal: Proposal, parent: string | null, items: BoardItem[]): Proposal {
    const paused = pausedStatus(parent, items);
    const status = paused ?? (proposal.status === "Waiting" || pausedStatus(proposal.parent, items) ? "To do" : proposal.status);
    return { ...proposal, parent, status };
}

/**
 * Writes one proposal: parent, then Area and Size, then priority, then status. Status goes last because it moves the task out of Inbox, so if an earlier write fails the task stays in Inbox and the row can be retried.
 *
 * Args:
 *     proposal: The row's proposal as the user left it.
 */
export async function applyProposal(proposal: Proposal): Promise<void> {
    const { id, parent, area, size, priority, status } = proposal;
    if (parent) await postParent(id, parent);
    const change: { area?: string; size?: string } = {};
    if (area) change.area = area;
    if (size) change.size = size;
    if (change.area || change.size) await postFields(id, change);
    if (priority) await postPriority(id, priority);
    await postStatus(id, status);
}
