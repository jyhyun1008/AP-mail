import Fastify, { type FastifyInstance } from "fastify";
import type { InboundActivityDeps } from "./bridge/inbound-activity";
import type { Config } from "./config";
import { registerActorRoute } from "./routes/actor.route";
import { registerHealthRoute } from "./routes/health.route";
import { registerInboxRoute } from "./routes/inbox.route";
import { registerMediaRoute } from "./routes/media.route";
import { registerWebfingerRoute } from "./routes/webfinger.route";

const AP_CONTENT_TYPES = ["application/activity+json", "application/ld+json"];

export interface ServerDeps extends InboundActivityDeps {
  publicKeyPem: string;
}

/**
 * Builds (but does not start) the Fastify app: registers the WebFinger/actor/health/inbox
 * routes and a raw-body content-type parser for AP request bodies — HTTP Signature
 * Digest verification needs the exact bytes as sent, before any JSON parsing, so
 * `request.body` for these content types is the raw string; inbox.route.ts JSON.parses
 * it itself only after the signature has checked out against those same raw bytes.
 */
export function buildServer(config: Config, deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel } });

  app.addContentTypeParser(AP_CONTENT_TYPES, { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  registerHealthRoute(app);
  registerWebfingerRoute(app, config);
  registerActorRoute(app, config, deps.publicKeyPem);
  registerMediaRoute(app, config);
  registerInboxRoute(app, config, deps);

  return app;
}
