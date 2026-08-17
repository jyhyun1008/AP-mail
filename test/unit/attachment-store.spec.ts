import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachmentFilePath,
  purgeExpiredAttachments,
  readAttachmentMeta,
  saveAttachment,
} from "../../src/media/attachment-store";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "apmail-attachments-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("saveAttachment / readAttachmentMeta", () => {
  it("writes the file and a matching meta.json, sanitizing a hostile filename", () => {
    const meta = saveAttachment(baseDir, "../../etc/passwd", "text/plain", Buffer.from("hello"));

    expect(meta.filename).toBe("passwd"); // path components stripped
    expect(meta.size).toBe(5);
    expect(meta.contentType).toBe("text/plain");

    const reread = readAttachmentMeta(baseDir, meta.id);
    expect(reread).toEqual(meta);

    const filePath = attachmentFilePath(baseDir, meta.id, meta.filename);
    expect(fs.readFileSync(filePath, "utf8")).toBe("hello");
  });

  it("returns undefined for an unknown id", () => {
    expect(readAttachmentMeta(baseDir, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});

describe("purgeExpiredAttachments", () => {
  it("deletes only directories older than the retention window", () => {
    const fresh = saveAttachment(baseDir, "fresh.txt", "text/plain", Buffer.from("a"));
    const stale = saveAttachment(baseDir, "stale.txt", "text/plain", Buffer.from("b"));

    // Backdate the stale one's meta.json as if it were saved 40 days ago.
    const staleMetaPath = path.join(baseDir, stale.id, "meta.json");
    const staleMeta = JSON.parse(fs.readFileSync(staleMetaPath, "utf8"));
    staleMeta.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(staleMetaPath, JSON.stringify(staleMeta));

    const purged = purgeExpiredAttachments(baseDir, 30);

    expect(purged).toBe(1);
    expect(readAttachmentMeta(baseDir, fresh.id)).toBeDefined();
    expect(readAttachmentMeta(baseDir, stale.id)).toBeUndefined();
  });

  it("returns 0 when the directory does not exist yet", () => {
    expect(purgeExpiredAttachments(path.join(baseDir, "nope"), 30)).toBe(0);
  });
});
