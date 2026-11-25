import { describe, expect, it } from "vitest";
import { areaHref, parseRoute, projectHref } from "./route";

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
