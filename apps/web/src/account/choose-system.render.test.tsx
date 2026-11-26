// The screen after the company's sign-in, drawn as the company's ID (its Admin) sees it (Aryan,
// 27 Nov: "as it was"): the company's name over the old grid, Selling, Operations and Office.
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({
  useMe: () => ({ data: { id: 1, name: "Admin", role: "admin", mustChangePassword: false, channel: null, divisions: [] } }),
}));
vi.mock("../companies", () => ({ useCompany: () => ({ orgId: "237227", name: "2MG Inc.", code: "2MG", loginDomain: "2mginc.com" }) }));
vi.mock("../menus", () => ({ allItems: () => [{ to: "/x" }], appsFor: () => [{ key: "orders", label: "Orders", groups: [{ items: [] }] }] }));

const { ChooseSystem } = await import("./choose-system");

describe("the screen after the company's sign-in", () => {
  it("shows the company's name over the old systems grid", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/signin"]}>
        <ChooseSystem />
      </MemoryRouter>,
    );
    expect(html).toContain("2MG Inc.");
    for (const words of ["Selling", "Operations", "Office", "MedReps", "Team leads", "Heads", "Online desk", "Management", "Regulatory", "Office staff", "CEO", "Administration", "Books"])
      expect(html).toContain(words);
    expect(html).toContain('href="/login/sales?add=1"');
    expect(html).toContain('href="/books/home"');
    expect(html).not.toContain(">Orders<");
  });
});
