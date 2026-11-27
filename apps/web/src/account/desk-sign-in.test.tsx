// Management's, Finance's and Dispatch's page (Aryan, 27 Nov: "a common password only, bring it
// back"): the desk password first while the company's Admin has set one, the own login a press away;
// without one, the usual sign-in.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { WORKSPACES } from "../workspaces";
import { DESK_KEYS, DeskOrOwn } from "./desk-sign-in";

const finance = WORKSPACES.find((one) => one.key === "finance")!;
const page = (on: boolean) => {
  const queries = new QueryClient();
  queries.setQueryData(["auth", "desk"], { on });
  return renderToString(
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <DeskOrOwn workspace={finance} own={<p>OWN LOGIN FORM</p>} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("a desk's sign-in page", () => {
  it("opens with the desk password while one is set, the own login a press away", () => {
    const html = page(true);
    expect(html).toContain("Sign in to Finance");
    expect(html).toContain("Desk password");
    expect(html).toContain("Sign in with my own ID instead");
    expect(html).not.toContain("OWN LOGIN FORM");
  });
  it("is the usual sign-in when the company has no desk password", () => {
    const html = page(false);
    expect(html).toContain("OWN LOGIN FORM");
    expect(html).not.toContain("Desk password");
  });
  it("is Management's, Finance's and Dispatch's only", () => {
    expect([...DESK_KEYS].sort()).toEqual(["dispatch", "finance", "management"]);
  });
});
