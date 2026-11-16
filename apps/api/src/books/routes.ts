// The books: Zoho Inventory's Sales and Purchases lists and documents.

import type { Hono, MiddlewareHandler } from "hono";
import type { Database } from "../db/index";
import { type Env, Refusal } from "../http";
import { bookDoc, bookList, isBookKind, payables, vendorDetail, vendorList } from "./service";

const listAsked = (query: (name: string) => string | undefined) => ({
  view: query("view"),
  page: Number(query("page")) || 1,
  perPage: Number(query("perPage")) || 25,
  q: query("q"),
  sort: query("sort"),
  dir: query("dir"),
  party: Number(query("party")) || undefined,
});

export function bookRoutes(app: Hono<Env>, db: Database, signedIn: MiddlewareHandler<Env>): void {
  app.use("/api/books/*", signedIn);
  app.get("/api/books/vendors", async (c) => c.json(await vendorList(db, c.get("me"), listAsked((n) => c.req.query(n)))));
  app.get("/api/books/vendors/:id", async (c) => c.json(await vendorDetail(db, c.get("me"), Number(c.req.param("id")))));
  app.get("/api/books/bill/payables", async (c) => c.json(await payables(db, c.get("me"))));
  app.get("/api/books/:kind", async (c) => {
    const kind = c.req.param("kind");
    if (!isBookKind(kind)) throw new Refusal(404, "not_found", "No such list.");
    return c.json(await bookList(db, c.get("me"), kind, listAsked((n) => c.req.query(n))));
  });
  app.get("/api/books/:kind/:id", async (c) => {
    const kind = c.req.param("kind");
    if (!isBookKind(kind)) throw new Refusal(404, "not_found", "No such list.");
    return c.json(await bookDoc(db, c.get("me"), kind, Number(c.req.param("id"))));
  });
}
