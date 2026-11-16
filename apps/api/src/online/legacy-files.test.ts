import { describe, expect, it } from "vitest";
import { fileKindOf } from "./legacy-import";

describe("the old CRM's photos", () => {
  it("files each as the paper it was, unfiled and refused ones as unsorted", () => {
    expect(fileKindOf({ kind: "prescription", status: "approved" })).toBe("rx");
    expect(fileKindOf({ kind: "booklet", status: null })).toBe("pwd_booklet");
    expect(fileKindOf({ kind: "imap_form", status: "approved" })).toBe("other");
    expect(fileKindOf({ kind: null, status: null })).toBe("unsorted");
    expect(fileKindOf({ kind: "osca_id", status: "rejected" })).toBe("unsorted");
  });
});
