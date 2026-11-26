// The company's systems (Aryan, 27 Nov: "as it was"; "signing out of an app leaves the app, not the
// company"): the company's name over the old grid, every system at its own sign-in. Shown to the
// company's ID once signed in, and to a browser inside the company after signing out of a system;
// a new browser gets the company's sign-in.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signedIn: true, inside: true as boolean | undefined }));

vi.mock("../auth", () => ({
  ME: ["me"],
  useMe: () => ({
    data: state.signedIn ? { id: 1, name: "Admin", role: "admin", mustChangePassword: false, channel: null, divisions: [] } : null,
  }),
}));
vi.mock("../companies", () => ({
  useCompany: () => ({ orgId: "237227", name: "2MG Inc.", code: "2MG", loginDomain: "2mginc.com" }),
  useInsideCompany: () => state.inside,
}));
vi.mock("./login", () => ({ SignIn: () => <p>Sign in to your company</p> }));

const { ChooseSystem } = await import("./choose-system");

const page = () =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/signin"]}>
        <ChooseSystem />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const SYSTEMS = ["Selling", "Operations", "Office", "MedReps", "Team leads", "Heads", "Online desk", "Management", "Regulatory", "Office staff", "CEO", "Administration", "Books"];

describe("the company's systems", () => {
  beforeEach(() => {
    state.signedIn = true;
    state.inside = true;
  });

  it("shows the company's ID the company's name over the old systems grid", () => {
    const html = page();
    expect(html).toContain("2MG Inc.");
    for (const words of SYSTEMS) expect(html).toContain(words);
    expect(html).toContain('href="/login/sales"');
    expect(html).toContain('href="/login/admin"');
    expect(html).toContain('href="/login/books"');
    expect(html).not.toContain("add=1");
    expect(html).toContain("Sign out of the company");
  });

  it("stays after signing out of a system: the browser is still inside the company", () => {
    state.signedIn = false;
    const html = page();
    expect(html).toContain("2MG Inc.");
    for (const words of SYSTEMS) expect(html).toContain(words);
    expect(html).toContain('href="/login/management"');
    expect(html).toContain("Sign out of the company");
    expect(html).not.toContain("Sign in to your company");
  });

  it("asks a new browser for the company's sign-in first", () => {
    state.signedIn = false;
    state.inside = false;
    const html = page();
    expect(html).toContain("Sign in to your company");
    expect(html).not.toContain("MedReps");
  });
});
