import type { FastifyInstance } from "fastify";
import type { Config } from "../config";
import { buildActorDocument } from "../actor/document";

const ACTIVITY_JSON_CONTENT_TYPE = "application/activity+json";

export function registerActorRoute(app: FastifyInstance, config: Config, publicKeyPem: string): void {
  app.get<{ Params: { username: string } }>("/users/:username", async (request, reply) => {
    if (request.params.username !== config.bridgeUsername) {
      reply.code(404).send({ error: "not_found" });
      return;
    }

    // Never let any CDN/proxy (Cloudflare etc.) cache this — remote servers rely on it
    // being current to verify our signatures, and a stale cached publicKeyPem after a
    // key rotation is a real, previously-hit failure mode (silent signature mismatches).
    reply.header("cache-control", "no-store");
    reply.header("content-type", ACTIVITY_JSON_CONTENT_TYPE);
    return buildActorDocument(config, publicKeyPem);
  });
}
