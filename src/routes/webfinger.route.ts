import type { FastifyInstance } from "fastify";
import type { Config } from "../config";
import { bridgeAcctResource, buildWebfingerResponse } from "../actor/webfinger";

const JRD_CONTENT_TYPE = "application/jrd+json";

export function registerWebfingerRoute(app: FastifyInstance, config: Config): void {
  app.get("/.well-known/webfinger", async (request, reply) => {
    const resource = (request.query as Record<string, unknown>)?.resource;

    if (typeof resource !== "string" || resource !== bridgeAcctResource(config)) {
      reply.code(404).send({ error: "not_found" });
      return;
    }

    reply.header("cache-control", "no-store");
    reply.header("content-type", JRD_CONTENT_TYPE);
    return buildWebfingerResponse(config);
  });
}
