import { actorId } from "../config";
import type { Config } from "../config";

export type WebfingerResponse = ReturnType<typeof buildWebfingerResponse>;

/** The `acct:` resource this bridge answers for, e.g. "acct:jay@mail.example.com". */
export function bridgeAcctResource(
  config: Pick<Config, "bridgeDomain" | "bridgeUsername">,
): string {
  return `acct:${config.bridgeUsername}@${config.bridgeDomain}`;
}

/** JRD body for GET /.well-known/webfinger?resource=acct:<user>@<domain>. */
export function buildWebfingerResponse(
  config: Pick<Config, "bridgeDomain" | "bridgeUsername">,
) {
  return {
    subject: bridgeAcctResource(config),
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actorId(config),
      },
    ],
  };
}
