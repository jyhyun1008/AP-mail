import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInboundEmail } from "../../src/mail/parse";

const fixturesDir = path.join(__dirname, "..", "fixtures", "emails");

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(fixturesDir, name));
}

describe("parseInboundEmail", () => {
  it("extracts from/subject/text/messageId/references from a plain-text email", async () => {
    const parsed = await parseInboundEmail(loadFixture("plain.eml"));

    expect(parsed.from).toBe("alice@example.com");
    expect(parsed.fromName).toBe("Alice Sender");
    expect(parsed.subject).toBe("Hello there");
    expect(parsed.text).toContain("This is a test message.");
    expect(parsed.messageId).toBe("<abc123@example.com>");
    expect(parsed.references).toBe("<root111@example.com> <mid222@example.com>");
    expect(parsed.attachments).toEqual([]);
  });

  it("prefers the text/plain part over text/html in a multipart/alternative email", async () => {
    const parsed = await parseInboundEmail(loadFixture("multipart.eml"));

    expect(parsed.text).toContain("Plain part body.");
    expect(parsed.text).not.toContain("<html>");
    expect(parsed.references).toBeUndefined();
  });

  it("falls back to stripped HTML when there is no text/plain part, and captures attachment metadata", async () => {
    const parsed = await parseInboundEmail(loadFixture("html-only-with-attachment.eml"));

    expect(parsed.text).toContain("Only an HTML body here, no plain part.");
    expect(parsed.text).not.toContain("<b>");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe("notes.txt");
    expect(parsed.attachments[0].size).toBeGreaterThan(0);
  });

  it("synthesizes a Message-ID when the email did not include one", async () => {
    const parsed = await parseInboundEmail(loadFixture("no-message-id.eml"));

    expect(parsed.messageId).toMatch(/^<generated-.+@apmail\.local>$/);
  });

  it("throws when the email has no parseable From address", async () => {
    const raw = "Subject: no from header\r\n\r\nbody\r\n";

    await expect(parseInboundEmail(raw)).rejects.toThrow(/From address/);
  });
});
