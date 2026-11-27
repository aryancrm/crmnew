// The navbar's Sign in (Aryan, 26-27 Nov): the company's ID signs in first, then the old systems
// grid; every system asks its own sign-in; anyone else goes straight to their own desk.
import type { Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { WORKSPACES } from "../workspaces";
import { seesGrid, tileTo } from "./choose-system";

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

describe("after the company's sign-in (Aryan, 27 Nov: \"as it was\")", () => {
  it("shows the grid to the company's ID (its Admin) only; anyone else goes to their own desk", () => {
    expect(seesGrid(person("admin"))).toBe(true);
    expect(seesGrid(person("admin", { mustChangePassword: true } as Partial<Me>))).toBe(false);
    for (const role of ["ceo", "finance", "medrep", "management", "dispatch", "hr"]) expect(seesGrid(person(role))).toBe(false);
  });
  it("opens every system at its own sign-in, Administration and Books too", () => {
    for (const one of WORKSPACES) expect(tileTo(one.key)).toBe(`/login/${one.key}`);
  });
  it("shows every system, in its group, as before", () => {
    expect(WORKSPACES.filter((one) => !one.group)).toEqual([]);
    expect(WORKSPACES.map((one) => one.label)).toEqual(
      expect.arrayContaining(["MedReps", "Team leads", "Management", "Regulatory", "Office staff", "CEO", "Administration", "Books"]),
    );
  });
});
