import { describe, expect, it } from "vitest";
import { makeRef, type BoardItem, type Proposal } from "../../../worker/src/types";
import { setParent, statusChoices, toRows } from "./triage";

function item(over: Partial<BoardItem> & { repo?: string; number: number }): BoardItem {
    const repo = over.repo ?? "st4eve/MyLife";
    return {
        id: `id-${repo}-${over.number}`, repo, ref: makeRef(repo, over.number), title: `task ${over.number}`, url: "", open: true,
        isProject: false, parent: null, status: "Inbox", area: null, priority: null, size: null, lab: false, due: null,
        updatedAt: "", blocked: false, canDelete: true, ...over,
    };
}

const OTHER = "QNLQueens/WickedIdeas";
const items = [
    item({ number: 1, isProject: true, status: "In progress" }),
    item({ number: 1, repo: OTHER, isProject: true, status: "Waiting" }),
    item({ number: 10 }),
];
const base: Proposal = { id: "id-st4eve/MyLife-10", ref: "st4eve/MyLife#10", area: null, size: null, priority: null, status: "To do", parent: null, reason: "r" };

describe("toRows", () => {
    it("adds the title and skips rows with nothing but a status", () => {
        const rows = toRows([base, { ...base, area: "Research" }], items);
        expect(rows.map((r) => [r.title, r.skipped])).toEqual([["task 10", true], ["task 10", false]]);
    });
});

describe("statusChoices", () => {
    it("offers To do and Backlog without a paused parent", () => {
        expect(statusChoices(base, items)).toEqual(["To do", "Backlog"]);
        expect(statusChoices({ ...base, parent: "st4eve/MyLife#1" }, items)).toEqual(["To do", "Backlog"]);
    });
    it("offers only the paused project's status", () => {
        expect(statusChoices({ ...base, parent: `${OTHER}#1`, status: "Waiting" }, items)).toEqual(["Waiting"]);
    });
});

describe("setParent", () => {
    it("makes the status follow a paused project in the right repo", () => {
        expect(setParent(base, `${OTHER}#1`, items)).toMatchObject({ parent: `${OTHER}#1`, status: "Waiting" });
        expect(setParent(base, "st4eve/MyLife#1", items)).toMatchObject({ parent: "st4eve/MyLife#1", status: "To do" });
    });
    it("goes back to To do when leaving a paused project", () => {
        const paused = setParent(base, `${OTHER}#1`, items);
        expect(setParent(paused, null, items)).toMatchObject({ parent: null, status: "To do" });
    });
});
