import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { relayAttachments } from "../../src/bridge/attachment-relay";
import type { ParsedAttachment } from "../../src/mail/parse";

let attachmentsDir: string;

const config = {
  bridgeDomain: "mail.example.com",
  attachmentsMaxTotalBytes: 1024,
} as const;

beforeEach(() => {
  attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "apmail-relay-"));
});

afterEach(() => {
  fs.rmSync(attachmentsDir, { recursive: true, force: true });
});

function makeAttachment(filename: string, size: number): ParsedAttachment {
  return { filename, size, contentType: "application/octet-stream", content: Buffer.alloc(size, 1) };
}

describe("relayAttachments", () => {
  it("saves attachments and returns media URLs when under the size cap", () => {
    const result = relayAttachments({ ...config, attachmentsDir }, [makeAttachment("a.bin", 100), makeAttachment("b.bin", 200)]);

    expect(result.skipped).toEqual([]);
    expect(result.relayed).toHaveLength(2);
    for (const a of result.relayed) {
      expect(a.url.startsWith("https://mail.example.com/media/")).toBe(true);
      expect(a.mediaType).toBe("application/octet-stream");
    }
  });

  it("skips (does not write) all attachments when combined size exceeds the cap", () => {
    const result = relayAttachments({ ...config, attachmentsDir }, [makeAttachment("big.bin", 900), makeAttachment("also-big.bin", 200)]);

    expect(result.relayed).toEqual([]);
    expect(result.skipped).toEqual([
      { filename: "big.bin", size: 900 },
      { filename: "also-big.bin", size: 200 },
    ]);
    expect(fs.readdirSync(attachmentsDir)).toHaveLength(0);
  });

  it("returns empty results for an email with no attachments", () => {
    const result = relayAttachments({ ...config, attachmentsDir }, []);
    expect(result).toEqual({ relayed: [], skipped: [] });
  });
});
