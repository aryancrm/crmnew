// The navbar's Sign in (Aryan, 26 Nov: "first the company's ID and password, then its apps"):
// after signing in, the company's ID (its Admin) and the CEO choose among every app of the company;
// Finance between its desk and Books; anyone with one system goes straight in.
import type { Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { WORKSPACES } from "../workspaces";
import { choicesOf, tileTo } from "./choose-system";

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

describe("the systems grid after the company's sign-in (Aryan, 27 Nov: \"as it was\")", () => {
  const ws = (key: string) => WORKSPACES.find((one) => one.key === key)!;
  it("opens a system the login holds at once, and any other at its own sign-in beside the company's", () => {
    expect(tileTo(person("admin"), ws("admin"))).toBe("/");
    expect(tileTo(person("admin"), ws("books"))).toBe("/books/home");
    expect(tileTo(person("admin"), ws("sales"))).toBe("/login/sales?add=1");
    expect(tileTo(person("finance"), ws("finance"))).toBe("/");
    expect(tileTo(person("ceo"), ws("hr"))).toBe("/login/hr?add=1");
  });
  it("shows every system, in its group, as before", () => {
    expect(WORKSPACES.filter((one) => !one.group)).toEqual([]);
    expect(WORKSPACES.map((one) => one.label)).toEqual(expect.arrayContaining(["MedReps", "Team leads", "Management", "Regulatory", "Office staff", "CEO", "Books"]));
  });
});
