import type Database from "better-sqlite3";
import { UnknownActorError } from "../util/errors";

interface CachedActor {
  publicKeyPem: string;
  inboxUrl: string;
}

interface ActorKeyCacheRow {
  public_key_pem: string;
  inbox_url: string;
  expires_at: string;
}

export interface ActorCache {
  /** Resolves a `keyId` (an actor URI with a `#fragment`) to that actor's publicKeyPem. */
  resolvePublicKeyPem(keyId: string): Promise<string>;
  /** Resolves an actor URI to its inbox URL, for outbound delivery. */
  resolveInboxUrl(actorUri: string): Promise<string>;
}

/** `${actorId}#main-key` -> `${actorId}` — also used by inbound-activity.ts to check the verified signer against ALLOWED_ACTOR_URI. */
export function actorUriFromKeyId(keyId: string): string {
  return keyId.split("#")[0];
}

function readCache(db: Database.Database, actorUri: string): CachedActor | undefined {
  const row = db
    .prepare("SELECT public_key_pem, inbox_url, expires_at FROM actor_key_cache WHERE actor_uri = ?")
    .get(actorUri) as ActorKeyCacheRow | undefined;

  if (!row) return undefined;
  if (row.expires_at <= new Date().toISOString()) return undefined; // expired

  return { publicKeyPem: row.public_key_pem, inboxUrl: row.inbox_url };
}

function writeCache(db: Database.Database, actorUri: string, actor: CachedActor, ttlHours: number): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO actor_key_cache (actor_uri, public_key_pem, inbox_url, fetched_at, expires_at)
     VALUES (@actorUri, @publicKeyPem, @inboxUrl, @fetchedAt, @expiresAt)
     ON CONFLICT(actor_uri) DO UPDATE SET
       public_key_pem = excluded.public_key_pem,
       inbox_url = excluded.inbox_url,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
  ).run({
    actorUri,
    publicKeyPem: actor.publicKeyPem,
    inboxUrl: actor.inboxUrl,
    fetchedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

async function fetchActorDocument(actorUri: string): Promise<CachedActor> {
  let response: Response;
  try {
    response = await fetch(actorUri, { headers: { Accept: "application/activity+json" } });
  } catch (cause) {
    throw new UnknownActorError(`Failed to reach actor ${actorUri}: ${(cause as Error).message}`);
  }

  if (!response.ok) {
    throw new UnknownActorError(`Actor fetch for ${actorUri} returned HTTP ${response.status}`);
  }

  const doc = (await response.json()) as {
    publicKey?: { publicKeyPem?: string };
    inbox?: string;
  };

  const publicKeyPem = doc.publicKey?.publicKeyPem;
  const inboxUrl = doc.inbox;
  if (!publicKeyPem || !inboxUrl) {
    throw new UnknownActorError(`Actor document for ${actorUri} is missing publicKey.publicKeyPem or inbox`);
  }

  return { publicKeyPem, inboxUrl };
}

/** Builds a DB-backed cache in front of remote actor document lookups (WebFinger target already resolved). */
export function createActorCache(db: Database.Database, ttlHours: number): ActorCache {
  async function resolve(actorUri: string): Promise<CachedActor> {
    const cached = readCache(db, actorUri);
    if (cached) return cached;

    const fetched = await fetchActorDocument(actorUri);
    writeCache(db, actorUri, fetched, ttlHours);
    return fetched;
  }

  return {
    async resolvePublicKeyPem(keyId: string): Promise<string> {
      const actor = await resolve(actorUriFromKeyId(keyId));
      return actor.publicKeyPem;
    },
    async resolveInboxUrl(actorUri: string): Promise<string> {
      const actor = await resolve(actorUri);
      return actor.inboxUrl;
    },
  };
}
