// The case journey puts the papers first (Aryan, 27 Nov: "the documents are checked first of all"):
// the enquiry, then the prescription (or the senior / PWD ID and Rx), then the quotation; a
// guarantee letter's application and letter after the quotation.

import { describe, expect, it } from "vitest";
import { journeyStops } from "./journey";

const lead = (more: Record<string, unknown>) => ({
  state: "new",
  road_step: "new",
  assistance: "none",
  quote: "",
  ...more,
});
const keys = (stops: ReturnType<typeof journeyStops>) => stops.filter((stop) => stop.onRoad).map((stop) => stop.key);
const current = (stops: ReturnType<typeof journeyStops>) => stops.find((stop) => stop.state === "current")?.key;

describe("the case journey, papers first", () => {
  it("draws the prescription before the quotation on every road", () => {
    const regular = journeyStops({ lead: lead({}), rx: null, gl: null, order: null, approved: [] });
    expect(keys(regular).slice(0, 4)).toEqual(["enquiry", "rx", "talk", "quote"]);
    const senior = journeyStops({ lead: lead({ assistance: "senior" }), rx: null, gl: null, order: null, approved: [] });
    expect(keys(senior).slice(0, 4)).toEqual(["enquiry", "docs", "talk", "quote"]);
    const gl = journeyStops({ lead: lead({ assistance: "gl" }), rx: null, gl: null, order: null, approved: [] });
    expect(keys(gl).slice(0, 6)).toEqual(["enquiry", "rx", "talk", "quote", "apply", "verified"]);
  });

  it("stands at the papers while they are missing, and past them once they are in", () => {
    const waiting = journeyStops({
      lead: lead({ state: "replied", road_step: "rx_wait" }),
      rx: null,
      gl: null,
      order: null,
      approved: [],
    });
    expect(current(waiting)).toBe("rx");
    // Quoted with the prescription approved: the order is next.
    const quoted = journeyStops({
      lead: lead({ state: "quoted", road_step: "quoted", quote: "Imatinib × 60" }),
      rx: { state: "approved" },
      gl: null,
      order: null,
      approved: [],
    });
    expect(current(quoted)).toBe("order");
    // A guarantee letter quoted with its prescription in: the agency's application is next.
    const glQuoted = journeyStops({
      lead: lead({ state: "quoted", road_step: "quoted", assistance: "gl", quote: "Imatinib × 60" }),
      rx: { state: "approved" },
      gl: null,
      order: null,
      approved: [],
    });
    expect(current(glQuoted)).toBe("apply");
    // A senior quoted without the ID: it stands at the ID, before the quotation.
    const noId = journeyStops({
      lead: lead({ state: "quoted", road_step: "papers", assistance: "senior", quote: "Imatinib × 60" }),
      rx: { state: "approved" },
      gl: null,
      order: null,
      approved: [],
    });
    expect(current(noId)).toBe("docs");
  });
});
