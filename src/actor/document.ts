import { actorId } from "../config";
import type { Config } from "../config";

export type ActorDocument = ReturnType<typeof buildActorDocument>;

/**
 * The AP actor object for the bridge's single bot identity. Deliberately minimal:
 * no outbox/followers/following collections are populated (this actor never posts
 * publicly — it only sends and receives direct Notes with the one allowed recipient).
 */
export function buildActorDocument(
  config: Pick<Config, "bridgeDomain" | "bridgeUsername" | "bridgeActorType">,
  publicKeyPem: string,
) {
  const id = actorId(config);

  return {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
    id,
    type: config.bridgeActorType,
    preferredUsername: config.bridgeUsername,
    name: `Mail bridge for ${config.bridgeUsername}`,
    summary: "Personal email-to-DM bridge. Not a public bot; only relays mail for its owner.",
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem,
    },
  };
}
