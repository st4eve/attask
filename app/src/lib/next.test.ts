import { describe, expect, it } from "vitest";
import { makeRef, type BoardItem } from "../../../worker/src/types";
import { dueSoon, nextList, type NextFilters } from "./next";

const HOME = "st4eve/MyLife";
const OTHER = "QNLQueens/WickedIdeas";

function item(over: Partial<BoardItem> & { number: number }): BoardItem {
    const repo = over.repo ?? HOME;
    return {
        id: `id-${repo}-${over.number}`,
        repo,
        ref: makeRef(repo, over.number),
        title: "t",
        url: "",
        open: true,
        isProject: false,
        parent: null,
        status: null,
        area: null,
        priority: null,
        size: null,
        lab: false,
        due: null,
        updatedAt: "",
        blocked: false,
        canDelete: true,
        ...over,
    };
}

// project #1 in each repo; the one in OTHER is paused, so its tasks never show
const board: BoardItem[] = [
    item({ number: 1, isProject: true, status: "In progress", area: "Research", priority: "P2" }),
    item({ number: 1, repo: OTHER, isProject: true, status: "Waiting", area: "Research", priority: "P0" }),
    item({ number: 10, parent: `${HOME}#1`, status: "To do", size: "S" }),
    item({ number: 11, parent: `${HOME}#1`, status: "In progress", size: "XS", updatedAt: "2026-11-01T00:00:00Z" }),
    item({ number: 12, parent: `${HOME}#1`, status: "Backlog", size: "M" }),
    item({ number: 10, repo: OTHER, parent: `${OTHER}#1`, status: "To do", size: "XS" }),
    // flat tasks qualify on their own status
    item({ number: 20, status: "To do", area: "Personal", priority: "P0" }),
    item({ number: 21, status: "In progress", area: "Course", updatedAt: "2026-11-05T00:00:00Z", size: "L" }),
    item({ number: 22, status: "To do", area: "Course", priority: "P2", due: "2026-11-20", size: "XS" }),
    item({ number: 23, repo: OTHER, status: "To do", area: "Course", priority: "P2", due: "2026-11-20", size: "XS" }),
    item({ number: 24, status: "To do", lab: true, size: "XS", area: "Research" }),
    item({ number: 25, status: "To do", blocked: true }),
    item({ number: 26, status: "Inbox" }),
    item({ number: 27, status: "Done", open: false }),
];

const all: NextFilters = { time: "any", place: "lab", area: "all", backlog: true };
const refs = (items: BoardItem[]): string[] => items.map((i) => i.ref);

describe("nextList", () => {
    it("orders In progress by recency, then To do by priority, due, repo and number, then Backlog", () => {
        expect(refs(nextList(board, all))).toEqual([
            `${HOME}#21`,
            `${HOME}#11`,
            `${HOME}#20`,
            `${OTHER}#23`,
            `${HOME}#22`,
            `${HOME}#10`,
            `${HOME}#24`,
            `${HOME}#12`,
        ]);
    });
    it("leaves out Backlog when the toggle is off", () => {
        expect(refs(nextList(board, { ...all, backlog: false }))).not.toContain(`${HOME}#12`);
    });
    it("keeps the same-numbered task of a paused project in another repo out", () => {
        expect(refs(nextList(board, all))).not.toContain(`${OTHER}#10`);
    });
    it("caps size by the time toggle and shows unsized tasks only under any", () => {
        expect(refs(nextList(board, { ...all, time: "15m" }))).toEqual([`${HOME}#11`, `${OTHER}#23`, `${HOME}#22`, `${HOME}#24`]);
        expect(refs(nextList(board, { ...all, time: "1h" }))).toEqual([`${HOME}#11`, `${OTHER}#23`, `${HOME}#22`, `${HOME}#10`, `${HOME}#24`]);
        expect(refs(nextList(board, { ...all, time: "half-day" }))).toContain(`${HOME}#12`);
        expect(refs(nextList(board, { ...all, time: "half-day" }))).not.toContain(`${HOME}#20`);
    });
    it("hides lab tasks at home", () => {
        expect(refs(nextList(board, { ...all, place: "home" }))).not.toContain(`${HOME}#24`);
    });
    it("filters by the task's own area, falling back to its project's", () => {
        expect(refs(nextList(board, { ...all, area: "Research" }))).toEqual([`${HOME}#11`, `${HOME}#10`, `${HOME}#24`, `${HOME}#12`]);
    });
});

describe("dueSoon", () => {
    it("keeps open tasks due within 7 days, soonest first, then by repo and number", () => {
        expect(refs(dueSoon(board, "all", "2026-11-15"))).toEqual([`${OTHER}#23`, `${HOME}#22`]);
        expect(dueSoon(board, "all", "2026-11-12")).toEqual([]);
    });
    it("filters by area", () => {
        expect(dueSoon(board, "Research", "2026-11-15")).toEqual([]);
        expect(refs(dueSoon(board, "Course", "2026-11-15"))).toEqual([`${OTHER}#23`, `${HOME}#22`]);
    });
    it("includes the 7th day and overdue tasks, and leaves out day 8", () => {
        expect(refs(dueSoon(board, "all", "2026-11-13"))).toEqual([`${OTHER}#23`, `${HOME}#22`]);
        expect(dueSoon(board, "all", "2026-11-12")).toEqual([]);
        expect(refs(dueSoon(board, "all", "2026-12-31"))).toEqual([`${OTHER}#23`, `${HOME}#22`]);
    });
});

describe("area of a task that differs from its project's", () => {
    const mixed: BoardItem[] = [
        item({ number: 1, isProject: true, status: "In progress", area: "Research" }),
        item({ number: 2, parent: `${HOME}#1`, status: "To do", area: "Personal" }),
    ];
    it("uses the task's own area, not its project's", () => {
        expect(refs(nextList(mixed, { ...all, area: "Personal" }))).toEqual([`${HOME}#2`]);
        expect(nextList(mixed, { ...all, area: "Research" })).toEqual([]);
    });
});
