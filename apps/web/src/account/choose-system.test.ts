// The navbar's Sign in (Aryan, 26 Nov: "first the company's ID and password, then its apps"):
// after signing in, the company's ID (its Admin) and the CEO choose among every app of the company;
// Finance between its desk and Books; anyone with one system goes straight in.
import type { Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { choicesOf } from "./choose-system";

const person = (role: string, extra: Partial<Me> = {}): Me =>
  ({
    id: 1,
    name: "Someone",
    email: null,
    title: null,
    role,
    roleLabel: role,
    channel: null,
    business: null,
    divisions: [],
    reportsTo: null,
    ...extra,
  }) as unknown as Me;

describe("what a login may open after the company's sign-in", () => {
  it("gives the company's ID (its Admin) its desk, Books and every app", () => {
    const labels = choicesOf(person("admin")).map((one) => one.label);
    expect(labels.slice(0, 2)).toEqual(["Administration", "Books"]);
    expect(labels).toEqual(expect.arrayContaining(["Finance", "Dispatch", "HR"]));
    expect(labels.length).toBeGreaterThan(6);
    expect(new Set(choicesOf(person("admin")).map((one) => one.to)).size).toBe(labels.length);
  });

  it("gives the CEO theirs and every app, Finance its desk and Books", () => {
    expect(choicesOf(person("ceo"))[0]?.label).toBe("CEO");
    expect(choicesOf(person("ceo")).length).toBeGreaterThan(6);
    expect(choicesOf(person("finance")).map((one) => one.label)).toEqual(["Finance", "Books"]);
  });

  it("sends anyone with one system straight in", () => {
    for (const role of ["medrep", "team_lead", "manager", "management", "dispatch", "inventory", "online", "hr", "staff"])
      expect(choicesOf(person(role, { channel: role === "medrep" ? ({ code: "HOSP", name: "HOSP", division: null } as Me["channel"]) : null }))).toHaveLength(1);
  });
});
