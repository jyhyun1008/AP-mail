import type { FastifyInstance } from "fastify";
import type { Config } from "../config";

const NODEINFO_SCHEMA = "http://nodeinfo.diaspora.software/ns/schema/2.0";

/**
 * NodeInfo (http://nodeinfo.diaspora.software/) — separate from WebFinger/the actor
 * document: this describes the *instance* (software name/version), not a specific
 * actor. Misskey (and others) fetch this when they first see a new remote domain,
 * purely for display/metadata purposes — not required for DM delivery to work, but
 * its absence shows up as a logged error on the remote side, so we serve a minimal
 * honest one instead of leaving a 404.
 */
export function registerNodeinfoRoute(app: FastifyInstance, config: Pick<Config, "bridgeDomain">): void {
  app.get("/.well-known/nodeinfo", async () => ({
    links: [
      {
        rel: NODEINFO_SCHEMA,
        href: `https://${config.bridgeDomain}/nodeinfo/2.0`,
      },
    ],
  }));

  app.get("/nodeinfo/2.0", async () => ({
    version: "2.0",
    software: { name: "apmail", version: "0.1.0" },
    protocols: ["activitypub"],
    services: { outbound: [], inbound: [] },
    openRegistrations: false,
    usage: { users: { total: 1, activeMonth: 1, activeHalfyear: 1 }, localPosts: 0 },
    metadata: {
      nodeName: "apmail",
      description: "Personal mail-to-ActivityPub DM bridge — not a public instance.",
    },
  }));
}
