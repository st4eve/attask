import { describe, expect, it } from "vitest";
import { issuePath } from "./api";

describe("issuePath", () => {
    it("builds the worker path for repos with dots and dashes", () => {
        expect(issuePath("Shastri-Lab/polymerNN#3")).toBe("/issues/Shastri-Lab/polymerNN/3");
        expect(issuePath("QNLQueens/QNL-Wafer-Database#12")).toBe("/issues/QNLQueens/QNL-Wafer-Database/12");
    });
    it("throws on a malformed ref", () => {
        expect(() => issuePath("nope")).toThrow("bad ref nope");
    });
});
