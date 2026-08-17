/**
 * Crude but dependency-free HTML-to-text: drops style/script blocks, replaces tags with
 * spaces, collapses whitespace. Used both for HTML-only inbound email (mail/parse.ts) and
 * for extracting the reply text from a Misskey Note's rendered `content` HTML
 * (bridge/dm-reply-to-email.ts) when the Misskey-specific `source.content` isn't present.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
