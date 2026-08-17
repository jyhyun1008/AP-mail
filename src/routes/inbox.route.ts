import type { FastifyInstance } from "fastify";
import { handleInboxActivity, type IncomingActivity, type InboundActivityDeps } from "../bridge/inbound-activity";
import type { Config } from "../config";
import { actorUriFromKeyId } from "../signatures/actor-cache";
import { verifySignature } from "../signatures/verify";
import { SignatureVerificationError } from "../util/errors";
import { logger } from "../util/logger";

export function registerInboxRoute(app: FastifyInstance, config: Config, deps: InboundActivityDeps): void {
  app.post<{ Params: { username: string } }>("/users/:username/inbox", async (request, reply) => {
    if (request.params.username !== config.bridgeUsername) {
      reply.code(404).send();
      return;
    }

    const rawBody = typeof request.body === "string" ? request.body : "";

    // Only ever resolve (i.e. fetch) the one actor this bridge is configured to trust.
    // Without this check, an unauthenticated POST could put an arbitrary URL — e.g. a
    // cloud metadata endpoint or an internal service — in the Signature header's keyId,
    // and actorCache.resolvePublicKeyPem would dutifully fetch it server-side (SSRF)
    // *before* we'd otherwise reject the request for being from the wrong actor.
    const resolvePublicKeyPem = async (keyId: string): Promise<string> => {
      const claimedActor = actorUriFromKeyId(keyId);
      if (claimedActor !== config.allowedActorUri) {
        throw new SignatureVerificationError(`keyId actor "${claimedActor}" is not the allowed actor`);
      }
      return deps.actorCache.resolvePublicKeyPem(keyId);
    };

    let verifiedActorUri: string;
    try {
      const { keyId } = await verifySignature(
        {
          method: request.method,
          path: request.url,
          headers: request.headers as Record<string, string | string[] | undefined>,
          rawBody,
        },
        resolvePublicKeyPem,
      );
      verifiedActorUri = actorUriFromKeyId(keyId);
    } catch (err) {
      if (err instanceof SignatureVerificationError) {
        logger.warn({ err: err.message }, "inbox signature verification failed");
        reply.code(401).send();
        return;
      }
      throw err;
    }

    let activity: IncomingActivity;
    try {
      activity = JSON.parse(rawBody) as IncomingActivity;
    } catch {
      reply.code(400).send();
      return;
    }

    const result = await handleInboxActivity(activity, verifiedActorUri, deps);
    reply.code(result.status).send();
  });
}
