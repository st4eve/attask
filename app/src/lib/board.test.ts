import { describe, expect, it } from "vitest";
import { makeRef, projectOf, type BoardItem } from "../../../worker/src/types";
import { areaNames, flatTasksIn } from "./board.svelte";

const HOME = "example/home";

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
        status: "To do",
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

const items: BoardItem[] = [
    item({ number: 1, isProject: true, area: "Research" }),
    item({ number: 2, parent: `${HOME}#1`, area: "Research" }),
    item({ number: 3, area: "Personal", priority: "P2" }),
    item({ number: 4, area: "Personal", priority: "P0" }),
    item({ number: 5, area: "Inbox area", status: "Inbox" }),
    item({ number: 6, area: "Closed area", open: false }),
    // parent is not on the board, so it counts as a flat task
    item({ number: 7, area: "Dangling", parent: `${HOME}#99` }),
];

describe("projectOf", () => {
    it("finds the project of a task, and none for a flat or dangling one", () => {
        expect(projectOf(items, items[1])?.ref).toBe(`${HOME}#1`);
        expect(projectOf(items, items[2])).toBeUndefined();
        expect(projectOf(items, items[6])).toBeUndefined();
    });
});

describe("flatTasksIn", () => {
    it("lists open, triaged tasks with no project, highest priority first", () => {
        expect(flatTasksIn(items, "Personal").map((i) => i.number)).toEqual([4, 3]);
        expect(flatTasksIn(items, "Research")).toEqual([]);
        expect(flatTasksIn(items, "Inbox area")).toEqual([]);
        expect(flatTasksIn(items, "Closed area")).toEqual([]);
    });
    it("counts a task with a dangling parent as flat", () => {
        expect(flatTasksIn(items, "Dangling").map((i) => i.number)).toEqual([7]);
    });
});

describe("areaNames", () => {
    it("has the areas of open projects and open, triaged flat tasks, sorted", () => {
        expect(areaNames(items)).toEqual(["Dangling", "Personal", "Research"]);
    });
});
