import { randomUUID } from "node:crypto";
import { actorId } from "../config";
import type { Config } from "../config";
import type { ActorCache } from "../signatures/actor-cache";
import type { NotesRepo } from "../store/notes.repo";
import { logger } from "../util/logger";
import { deliverNoteToInbox } from "./deliver-note"; // generic activity delivery, not Note-specific despite the name (see M2)
import { onInboxReplyActivity } from "./dm-reply-to-email";
import type { ReplyEmailParams } from "../mail/send";

export interface InboundActivityDeps {
  config: Pick<Config, "allowedActorUri" | "bridgeDomain" | "bridgeUsername">;
  actorCache: ActorCache;
  notesRepo: NotesRepo;
  privateKeyPem: string;
  publicKeyPem: string;
  /** `${actorId}#main-key` */
  keyId: string;
  sendReplyEmail: (params: ReplyEmailParams) => Promise<void>;
}

export interface InboxHandlingResult {
  status: number;
}

export interface IncomingActivity {
  id?: string;
  type?: string;
  actor?: string;
  object?: {
    id?: string;
    type?: string;
    inReplyTo?: string;
    content?: string;
    source?: { content?: string };
  };
}

function buildAcceptActivity(config: Pick<Config, "bridgeDomain" | "bridgeUsername">, followActivity: IncomingActivity) {
  const id = actorId(config);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${id}/accepts/${randomUUID()}`,
    type: "Accept",
    actor: id,
    object: followActivity,
  };
}

/**
 * Entry point for every verified POST /inbox. `verifiedActorUri` is the actor whose
 * signature actually checked out (resolved from the Signature header's keyId) — the
 * caller (routes/inbox.route.ts) has already done cryptographic verification; this
 * function only does the *authorization* check (is it the one person this bridge exists
 * for) and then dispatches by activity type.
 */
export async function handleInboxActivity(activity: IncomingActivity, verifiedActorUri: string, deps: InboundActivityDeps): Promise<InboxHandlingResult> {
  if (activity.actor && activity.actor !== verifiedActorUri) {
    // The cryptographic signer and the activity's claimed author disagree — not
    // necessarily exploitable given the allowlist check below, but malformed/suspicious
    // enough to reject outright rather than guess which one to trust.
    logger.warn({ claimedActor: activity.actor, verifiedActorUri }, "activity.actor does not match the verified signer; rejecting");
    return { status: 400 };
  }

  if (verifiedActorUri !== deps.config.allowedActorUri) {
    logger.warn({ verifiedActorUri, allowed: deps.config.allowedActorUri }, "inbox activity from a non-allowed actor; ignoring");
    return { status: 403 };
  }

  switch (activity.type) {
    case "Follow": {
      // Accept unconditionally — the allowlist check above already establishes this is
      // the bridge's one owner, and some servers' cross-server delivery/notification
      // behavior differs for unfollowed actors (see docs/misskey-followup-caveat.md).
      try {
        const inboxUrl = await deps.actorCache.resolveInboxUrl(verifiedActorUri);
        await deliverNoteToInbox({
          activity: buildAcceptActivity(deps.config, activity),
          inboxUrl,
          privateKeyPem: deps.privateKeyPem,
          publicKeyPem: deps.publicKeyPem,
          keyId: deps.keyId,
        });
      } catch (err) {
        logger.error({ err }, "failed to deliver Accept{Follow}");
      }
      return { status: 202 };
    }

    case "Undo":
    case "Delete":
      return { status: 202 };

    case "Create": {
      const note = activity.object;
      if (note?.type === "Note") {
        await onInboxReplyActivity(note, { notesRepo: deps.notesRepo, sendReplyEmail: deps.sendReplyEmail });
      }
      return { status: 202 };
    }

    default:
      logger.info({ type: activity.type }, "ignoring unhandled activity type");
      return { status: 202 };
  }
}
