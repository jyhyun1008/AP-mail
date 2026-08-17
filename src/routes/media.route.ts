import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config";
import { attachmentFilePath, readAttachmentMeta } from "../media/attachment-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves relayed attachment binaries. The `:filename` URL segment is purely cosmetic
 * (nice download names, matches what we put in the Note's `attachment[].url`) — the
 * actual file is always located via the opaque `:id` and the filename recorded in
 * meta.json at save time, never from the request itself, so there's no path-traversal
 * surface here regardless of what a client puts in the URL.
 */
export function registerMediaRoute(app: FastifyInstance, config: Pick<Config, "attachmentsDir">): void {
  app.get<{ Params: { id: string; filename: string } }>("/media/:id/:filename", async (request, reply) => {
    const { id } = request.params;
    if (!UUID_PATTERN.test(id)) {
      reply.code(404).send();
      return;
    }

    const meta = readAttachmentMeta(config.attachmentsDir, id);
    if (!meta) {
      reply.code(404).send();
      return;
    }

    const filePath = attachmentFilePath(config.attachmentsDir, id, meta.filename);
    if (!fs.existsSync(filePath)) {
      reply.code(404).send();
      return;
    }

    reply.header("content-type", meta.contentType);
    reply.header("content-disposition", `inline; filename="${meta.filename.replace(/"/g, "")}"`);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(filePath));
  });
}
