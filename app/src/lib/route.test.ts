import { describe, expect, it } from "vitest";
import { areaHref, fullRef, parseRoute, projectHref } from "./route";

describe("parseRoute", () => {
    it("round-trips a project ref with dots, dashes and a hash", () => {
        const ref = "QNLQueens/QNL-Wafer-Database#12";
        expect(parseRoute(projectHref(ref))).toEqual({ page: "project", ref });
    });
    it("round-trips an area", () => {
        expect(parseRoute(areaHref("Research"))).toEqual({ page: "area", name: "Research" });
    });
    it("falls back to the inbox", () => {
        expect(parseRoute("")).toEqual({ page: "inbox" });
        expect(parseRoute("#/project/")).toEqual({ page: "inbox" });
        expect(parseRoute("#/project/notaref")).toEqual({ page: "inbox" });
    });
});

describe("parseRoute malformed encoding", () => {
    it("falls back to the inbox instead of throwing", () => {
        expect(parseRoute("#/area/%E0")).toEqual({ page: "inbox" });
        expect(parseRoute("#/project/%E0%A4%A")).toEqual({ page: "inbox" });
    });
});

describe("parseRoute task", () => {
    it("reads a repo name and number", () => {
        expect(parseRoute("#/task/MyLife/12")).toEqual({ page: "task", repo: "MyLife", number: 12 });
    });
    it("reads a leading zero as the same number", () => {
        expect(parseRoute("#/task/MyLife/012")).toEqual({ page: "task", repo: "MyLife", number: 12 });
    });
    it("falls back to the inbox for a bad number or missing part", () => {
        expect(parseRoute("#/task/MyLife/abc")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/MyLife/0")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/MyLife/1.5")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/MyLife")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task//12")).toEqual({ page: "inbox" });
        expect(parseRoute("#/task/My/Life/12")).toEqual({ page: "inbox" });
    });
});

describe("fullRef", () => {
    it("maps each board repo's name to its full ref", () => {
        expect(fullRef("MyLife", 12)).toBe("st4eve/MyLife#12");
        expect(fullRef("QNL-Wafer-Database", 3)).toBe("QNLQueens/QNL-Wafer-Database#3");
        expect(fullRef("WickedIdeas", 1)).toBe("QNLQueens/WickedIdeas#1");
        expect(fullRef("polymerNN", 4)).toBe("Shastri-Lab/polymerNN#4");
        expect(fullRef("Hybrid_CV_Networks", 5)).toBe("st4eve/Hybrid_CV_Networks#5");
    });
    it("ignores case and keeps the board's casing", () => {
        expect(fullRef("mylife", 12)).toBe("st4eve/MyLife#12");
    });
    it("returns null for a repo not on the board", () => {
        expect(fullRef("C", 2)).toBeNull();
    });
});
