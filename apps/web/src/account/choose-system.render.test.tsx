// The screen after the company's sign-in, drawn as the company's ID (its Admin) sees it (Aryan,
// 27 Nov: "as it was"): the company's name over the old grid; every system at its own sign-in.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({
  ME: ["me"],
  useMe: () => ({ data: { id: 1, name: "Admin", role: "admin", mustChangePassword: false, channel: null, divisions: [] } }),
}));
vi.mock("../companies", () => ({ useCompany: () => ({ orgId: "237227", name: "2MG Inc.", code: "2MG", loginDomain: "2mginc.com" }) }));

const { ChooseSystem } = await import("./choose-system");

describe("the screen after the company's sign-in", () => {
  it("shows the company's name over the old systems grid", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/signin"]}>
          <ChooseSystem />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).toContain("2MG Inc.");
    for (const words of ["Selling", "Operations", "Office", "MedReps", "Team leads", "Heads", "Online desk", "Management", "Regulatory", "Office staff", "CEO", "Administration", "Books"])
      expect(html).toContain(words);
    expect(html).toContain('href="/login/sales"');
    expect(html).toContain('href="/login/admin"');
    expect(html).toContain('href="/login/books"');
    expect(html).not.toContain("add=1");
  });
});
