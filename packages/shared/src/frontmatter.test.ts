import { describe, expect, it } from "vitest";
import { parse, serialize } from "./frontmatter";

describe("frontmatter — roundtrip", () => {
  it("preserves every field described in the implementation brief", () => {
    const fm = {
      type: "ticket",
      project: "project-x",
      client: "client-a",
      external_id: "TICKET-1234",
      title: "Short ticket title",
      status: "in_progress",
      created: "2026-01-15",
      updated: "2026-02-01",
      stakeholders: [],
      related_tickets: ["TICKET-1230", "TICKET-1212"],
      related_files: ["SomeController.cls", "SomeService.cls"],
      tags: ["tag1", "tag2"],
      persist: true,
    };
    const content = "# Document body in free markdown\n\nSome body text.";

    const md = serialize(content, fm);
    const reparsed = parse(md);

    expect(reparsed.frontmatter).toEqual(fm);
    expect(reparsed.content.trim()).toBe(content.trim());
  });

  it("preserves numeric and boolean scalars across roundtrip", () => {
    const fm = { count: 42, ratio: 0.5, active: true, archived: false };
    const md = serialize("body", fm);
    expect(parse(md).frontmatter).toEqual(fm);
  });

  it("preserves nested arrays and objects", () => {
    const fm = {
      links: [{ to: "TICKET-1", type: "depends_on" }],
      meta: { author: "carlos", reviewers: ["a", "b"] },
    };
    const md = serialize("body", fm);
    expect(parse(md).frontmatter).toEqual(fm);
  });
});

describe("frontmatter — parse edge cases", () => {
  it("returns empty frontmatter and the original content when no delimiter is present", () => {
    const md = "# Just a heading\n\nNo frontmatter here.";
    const result = parse(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(md);
  });

  it("handles an empty frontmatter block", () => {
    const md = "---\n---\n\n# body content\n";
    const result = parse(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content.trim()).toBe("# body content");
  });

  it("ignores frontmatter that does not start at the very beginning", () => {
    const md = "Some prose before.\n\n---\ntype: ticket\n---\n\n# body";
    const result = parse(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe(md);
  });
});

describe("frontmatter — serialize", () => {
  it("emits a leading delimiter, the YAML block, a closing delimiter, and a blank line before content", () => {
    const md = serialize("# body\n", { type: "ticket" });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("\n---\n\n# body");
  });

  it("does not wrap long array values onto multiple lines", () => {
    const fm = {
      related_tickets: Array.from({ length: 20 }, (_, i) => `TICKET-${1000 + i}`),
    };
    const md = serialize("body", fm);
    const reparsed = parse(md);
    expect(reparsed.frontmatter).toEqual(fm);
  });
});
