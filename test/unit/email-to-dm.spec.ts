import { describe, expect, it } from "vitest";
import { formatBytes, formatDmBody, neutralizeMentionsAndHashtags, truncate } from "../../src/bridge/email-to-dm";
import type { ParsedInboundEmail } from "../../src/mail/parse";

function baseEmail(overrides: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail {
  return {
    from: "alice@example.com",
    fromName: "Alice",
    subject: "Hi",
    text: "hello",
    messageId: "<abc@example.com>",
    attachments: [],
    ...overrides,
  };
}

describe("neutralizeMentionsAndHashtags", () => {
  it("slips a zero-width space after @ and # so they don't parse as live mentions/hashtags", () => {
    const result = neutralizeMentionsAndHashtags("contact me @alice@example.com or #urgent");

    expect(result).not.toContain("@alice@example.com"); // the un-neutralized run no longer appears verbatim
    expect(result).toContain("@​alice");
    expect(result).toContain("#​urgent");
  });

  it("leaves an isolated @ or # with no following char alone", () => {
    expect(neutralizeMentionsAndHashtags("weird @ # spacing")).toBe("weird @ # spacing");
  });
});

describe("formatBytes", () => {
  it("formats bytes/KB/MB at natural breakpoints", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("truncate", () => {
  it("passes short text through untouched", () => {
    expect(truncate("hello", 10)).toEqual({ text: "hello", originalLength: 5, truncated: false });
  });

  it("cuts text at maxChars and reports the original length", () => {
    expect(truncate("hello world", 5)).toEqual({ text: "hello", originalLength: 11, truncated: true });
  });
});

describe("formatDmBody", () => {
  it("includes sender, subject, and body with no attachment notice when there are none", () => {
    const body = formatDmBody(baseEmail(), 2000, { relayed: [], skipped: [] });

    expect(body).toContain("New email from Alice <alice@example.com>");
    expect(body).toContain("Subject: Hi");
    expect(body).toContain("hello");
    expect(body).not.toContain("attachment");
  });

  it("appends a truncation notice when the body exceeds maxBodyChars", () => {
    const body = formatDmBody(baseEmail({ text: "x".repeat(100) }), 10, { relayed: [], skipped: [] });

    expect(body).toContain("[...truncated — original message was 100 characters]");
  });

  it("lists relayed attachments by name", () => {
    const body = formatDmBody(baseEmail(), 2000, {
      relayed: [{ url: "https://mail.example.com/media/x/a.txt", mediaType: "text/plain", name: "a.txt" }],
      skipped: [],
    });

    expect(body).toContain("1 attachment(s) attached to this note: a.txt");
  });

  it("lists skipped (oversized) attachments with size", () => {
    const body = formatDmBody(baseEmail(), 2000, {
      relayed: [],
      skipped: [{ filename: "huge.zip", size: 9 * 1024 * 1024 }],
    });

    expect(body).toContain("1 attachment(s) not relayed (over size limit): huge.zip (9.0 MB)");
  });
});
