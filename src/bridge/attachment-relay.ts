import type { Config } from "../config";
import { mediaBaseUrl } from "../config";
import type { ParsedAttachment } from "../mail/parse";
import { saveAttachment } from "../media/attachment-store";

export interface RelayedAttachment {
  url: string;
  mediaType: string;
  name: string;
}

export interface SkippedAttachment {
  filename: string;
  size: number;
}

export interface AttachmentRelayResult {
  relayed: RelayedAttachment[];
  /** Present when the email had attachments but their combined size exceeded attachmentsMaxTotalBytes — named only, not saved. */
  skipped: SkippedAttachment[];
}

/**
 * Decides whether an email's attachments fit under the per-email size cap; if so, writes
 * each to disk and returns URLs suitable for an AP Note's `attachment` field (which the
 * receiving Misskey server will fetch and cache into its own drive). If the total is over
 * the cap, nothing is written — the caller falls back to naming them in the DM text only.
 */
export function relayAttachments(
  config: Pick<Config, "bridgeDomain" | "attachmentsDir" | "attachmentsMaxTotalBytes">,
  attachments: ParsedAttachment[],
): AttachmentRelayResult {
  if (attachments.length === 0) {
    return { relayed: [], skipped: [] };
  }

  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  if (totalSize > config.attachmentsMaxTotalBytes) {
    return {
      relayed: [],
      skipped: attachments.map((a) => ({ filename: a.filename, size: a.size })),
    };
  }

  const base = mediaBaseUrl(config);
  const relayed = attachments.map((a) => {
    const stored = saveAttachment(config.attachmentsDir, a.filename, a.contentType, a.content);
    return {
      url: `${base}/${stored.id}/${encodeURIComponent(stored.filename)}`,
      mediaType: stored.contentType,
      name: stored.filename,
    };
  });

  return { relayed, skipped: [] };
}
