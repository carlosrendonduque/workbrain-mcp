import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDocumentPath, readDocument, writeDocument } from "./corpus";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "workbrain-corpus-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeDocument / readDocument", () => {
  it("writes a frontmattered .md file at the requested path and reads it back", async () => {
    const fm = {
      type: "ticket",
      project: "project-x",
      external_id: "TICKET-1234",
      title: "Sample ticket",
      tags: ["alpha", "beta"],
    };
    const content = "# Sample ticket\n\nBody goes here.";
    const relPath = buildDocumentPath({
      clientSlug: "client-a",
      projectSlug: "project-x",
      typeFolder: "tickets",
      fileName: "TICKET-1234.md",
    });

    const written = await writeDocument(relPath, fm, content, { rootPath: root });
    expect(written.relativePath).toBe(relPath);
    expect(written.absolutePath).toBe(join(root, relPath));

    const onDisk = await readFile(written.absolutePath, "utf8");
    expect(onDisk.startsWith("---\n")).toBe(true);
    expect(onDisk).toContain("title: Sample ticket");

    const reread = await readDocument(relPath, { rootPath: root });
    expect(reread.frontmatter).toEqual(fm);
    expect(reread.content.trim()).toBe(content.trim());
  });

  it("creates intermediate directories as needed", async () => {
    const relPath = "deeply/nested/path/note.md";
    await writeDocument(relPath, { type: "note" }, "body", { rootPath: root });
    const reread = await readDocument(relPath, { rootPath: root });
    expect(reread.frontmatter).toEqual({ type: "note" });
  });

  it("rejects absolute paths", async () => {
    await expect(writeDocument("/etc/passwd", {}, "body", { rootPath: root })).rejects.toThrow(
      /relative/,
    );
  });

  it("rejects paths that escape the corpus root", async () => {
    await expect(writeDocument("../outside.md", {}, "body", { rootPath: root })).rejects.toThrow(
      /escapes/,
    );
  });

  it("buildDocumentPath produces a stable corpus path", () => {
    const path = buildDocumentPath({
      clientSlug: "client-a",
      projectSlug: "project-x",
      typeFolder: "tickets",
      fileName: "TICKET-9.md",
    });
    expect(path).toBe(join("client-a", "project-x", "tickets", "TICKET-9.md"));
  });
});
