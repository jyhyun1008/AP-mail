import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface StoredAttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/**
 * Strips any path components and unsafe characters — this is the only line of
 * defense against path traversal via a hostile filename, since the sanitized
 * name is what actually gets written to (and later read from) disk.
 */
function sanitizeFilename(name: string): string {
  const base = path
    .basename(name || "attachment")
    .replace(/[^\w.\- À-ſ가-힣]/g, "_")
    .trim();
  return base.length > 0 ? base.slice(0, 200) : "attachment";
}

/** Writes one attachment to `<baseDir>/<uuid>/<sanitized-filename>` plus a `meta.json` sidecar. */
export function saveAttachment(
  baseDir: string,
  filename: string,
  contentType: string,
  content: Buffer,
): StoredAttachmentMeta {
  const id = randomUUID();
  const safeName = sanitizeFilename(filename);
  const dir = path.join(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safeName), content);

  const meta: StoredAttachmentMeta = {
    id,
    filename: safeName,
    contentType: contentType || "application/octet-stream",
    size: content.length,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));

  return meta;
}

export function readAttachmentMeta(baseDir: string, id: string): StoredAttachmentMeta | undefined {
  const metaPath = path.join(baseDir, id, "meta.json");
  if (!fs.existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as StoredAttachmentMeta;
  } catch {
    return undefined;
  }
}

/** Path to the actual binary — callers must pass `meta.filename` from readAttachmentMeta, never a client-supplied filename. */
export function attachmentFilePath(baseDir: string, id: string, filename: string): string {
  return path.join(baseDir, id, filename);
}

/** Deletes attachment directories older than retentionDays. Returns the number purged. Run periodically (see index.ts). */
export function purgeExpiredAttachments(baseDir: string, retentionDays: number): number {
  if (!fs.existsSync(baseDir)) return 0;

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let purged = 0;

  for (const id of fs.readdirSync(baseDir)) {
    const dir = path.join(baseDir, id);
    const meta = readAttachmentMeta(baseDir, id);
    const createdAtMs = meta ? Date.parse(meta.createdAt) : fs.statSync(dir).mtimeMs;

    if (createdAtMs < cutoffMs) {
      fs.rmSync(dir, { recursive: true, force: true });
      purged += 1;
    }
  }

  return purged;
}
