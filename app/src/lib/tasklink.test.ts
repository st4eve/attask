import { describe, expect, it } from "vitest";
import { makeRef, type BoardItem } from "../../../worker/src/types";
import { areaHref, projectHref } from "./route";
import { taskLanding } from "./tasklink";

function item(over: Partial<BoardItem> & { repo?: string; number: number }): BoardItem {
    const repo = over.repo ?? "st4eve/MyLife";
    return {
        id: `id-${repo}-${over.number}`, repo, ref: makeRef(repo, over.number), title: `task ${over.number}`, url: "", open: true,
        isProject: false, parent: null, status: "To do", area: null, priority: null, size: null, lab: false, due: null,
        updatedAt: "", blocked: false, canDelete: true, ...over,
    };
}

const items = [
    item({ number: 1, isProject: true, status: "In progress", area: "Research" }),
    item({ number: 2, parent: "st4eve/MyLife#1", area: "Research" }),
    item({ number: 3, area: "Admin" }),
    item({ number: 4, status: "Inbox" }),
    item({ number: 5, parent: "st4eve/MyLife#99", area: "Admin" }),
    item({ number: 6, area: "Admin", open: false, status: "Done" }),
    item({ number: 7, repo: "Shastri-Lab/polymerNN", area: "Research" }),
    item({ number: 8, status: "Inbox", area: "Admin" }),
];

describe("taskLanding", () => {
    it("opens a task in a project over the project page", () => {
        expect(taskLanding(items, "MyLife", 2)).toEqual({ hash: projectHref("st4eve/MyLife#1"), selected: "st4eve/MyLife#2", error: "" });
    });
    it("opens a flat task over its Area page", () => {
        expect(taskLanding(items, "MyLife", 3)).toEqual({ hash: areaHref("Admin"), selected: "st4eve/MyLife#3", error: "" });
    });
    it("opens a task with no Area over the inbox", () => {
        expect(taskLanding(items, "MyLife", 4)).toEqual({ hash: "#/inbox", selected: "st4eve/MyLife#4", error: "" });
    });
    it("opens an inbox task over the inbox even when it has an Area", () => {
        expect(taskLanding(items, "MyLife", 8)).toEqual({ hash: "#/inbox", selected: "st4eve/MyLife#8", error: "" });
    });
    it("treats a parent that is not a project on the board as flat", () => {
        expect(taskLanding(items, "MyLife", 5)).toEqual({ hash: areaHref("Admin"), selected: "st4eve/MyLife#5", error: "" });
    });
    it("opens a closed task that is still on the board", () => {
        expect(taskLanding(items, "MyLife", 6).selected).toBe("st4eve/MyLife#6");
    });
    it("shows a project as its own page with no sheet", () => {
        expect(taskLanding(items, "MyLife", 1)).toEqual({ hash: projectHref("st4eve/MyLife#1"), selected: null, error: "" });
    });
    it("matches the repo name in any case", () => {
        expect(taskLanding(items, "polymernn", 7).selected).toBe("Shastri-Lab/polymerNN#7");
    });
    it("lands on the inbox with an error for an unknown repo", () => {
        expect(taskLanding(items, "C", 2)).toEqual({ hash: "#/inbox", selected: null, error: "C#2 isn't a board repo" });
    });
    it("lands on the inbox with an error for a task not on the board", () => {
        expect(taskLanding(items, "MyLife", 42)).toEqual({ hash: "#/inbox", selected: null, error: "st4eve/MyLife#42 isn't on the board" });
    });
});
