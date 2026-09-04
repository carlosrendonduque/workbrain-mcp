import { describe, expect, it } from "vitest";
import { CLIENT_SCOPE_HEADER, callerFromHeaders } from "./caller";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("callerFromHeaders", () => {
  it("returns null without a user, so an unrecognised request gets no access", () => {
    expect(callerFromHeaders(headers({}))).toBeNull();
    expect(callerFromHeaders(headers({ [CLIENT_SCOPE_HEADER]: "bank-id" }))).toBeNull();
  });

  it("reads an unscoped caller", () => {
    expect(callerFromHeaders(headers({ "x-user-id": "u1" }))).toEqual({
      userId: "u1",
      clientScope: null,
    });
  });

  it("reads a caller pinned to one client", () => {
    expect(
      callerFromHeaders(headers({ "x-user-id": "u1", [CLIENT_SCOPE_HEADER]: "bank-id" })),
    ).toEqual({ userId: "u1", clientScope: "bank-id" });
  });
});
