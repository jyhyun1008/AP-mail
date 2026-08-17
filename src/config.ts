import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  bridgeDomain: string;
  bridgeUsername: string;
  bridgeActorType: "Service" | "Person";
  allowedActorUri: string;

  httpPort: number;
  httpHost: string;

  actorPrivateKeyPath: string;
  actorPublicKeyPath: string;

  dbPath: string;

  inboundSmtpHost: string;
  inboundSmtpPort: number;
  /** Hard cap on inbound message size (bytes); smtp-server rejects anything larger during DATA. Defense in depth on top of whatever Postfix already enforces upstream. */
  inboundMaxMessageBytes: number;

  /** Max characters of email body text embedded in a single DM Note, to stay under the recipient Misskey instance's note-length limit. Raise if your instance allows longer notes. */
  dmMaxBodyChars: number;

  /** Directory attachment binaries are written to (one subfolder per attachment, opaque UUID name). */
  attachmentsDir: string;
  /** Per-email cap on total attachment bytes; over this, attachments are not saved/relayed — only named in the DM text. */
  attachmentsMaxTotalBytes: number;
  /** Attachment files older than this are deleted by the periodic purge job. Does not affect the `notes` table, which is kept indefinitely by design. */
  attachmentsRetentionDays: number;

  mailRelayHost: string;
  mailRelayPort: number;
  mailRelayUser: string | undefined;
  mailRelayPass: string | undefined;
  mailFromAddress: string;

  actorCacheTtlHours: number;

  logLevel: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name} (see .env.example)`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

let cached: Config | undefined;

/** Reads and validates process.env once, returning a typed Config. Fails fast on missing required vars. */
export function loadConfig(): Config {
  if (cached) return cached;

  const bridgeActorType = optional("BRIDGE_ACTOR_TYPE", "Service");
  if (bridgeActorType !== "Service" && bridgeActorType !== "Person") {
    throw new Error(`BRIDGE_ACTOR_TYPE must be "Service" or "Person", got: ${bridgeActorType}`);
  }

  cached = {
    bridgeDomain: required("BRIDGE_DOMAIN"),
    bridgeUsername: required("BRIDGE_USERNAME"),
    bridgeActorType,
    allowedActorUri: required("ALLOWED_ACTOR_URI"),

    httpPort: optionalInt("HTTP_PORT", 8080),
    httpHost: optional("HTTP_HOST", "0.0.0.0"),

    actorPrivateKeyPath: path.resolve(optional("ACTOR_PRIVATE_KEY_PATH", "./data/keys/actor-private.pem")),
    actorPublicKeyPath: path.resolve(optional("ACTOR_PUBLIC_KEY_PATH", "./data/keys/actor-public.pem")),

    dbPath: path.resolve(optional("DB_PATH", "./data/db/apmail.sqlite")),

    inboundSmtpHost: optional("INBOUND_SMTP_HOST", "127.0.0.1"),
    inboundSmtpPort: optionalInt("INBOUND_SMTP_PORT", 2525),
    inboundMaxMessageBytes: optionalInt("INBOUND_MAX_MESSAGE_BYTES", 10 * 1024 * 1024),

    dmMaxBodyChars: optionalInt("DM_MAX_BODY_CHARS", 2000),

    attachmentsDir: path.resolve(optional("ATTACHMENTS_DIR", "./data/attachments")),
    attachmentsMaxTotalBytes: optionalInt("ATTACHMENTS_MAX_TOTAL_BYTES", 8 * 1024 * 1024),
    attachmentsRetentionDays: optionalInt("ATTACHMENTS_RETENTION_DAYS", 30),

    mailRelayHost: optional("MAIL_RELAY_HOST", "127.0.0.1"),
    mailRelayPort: optionalInt("MAIL_RELAY_PORT", 587),
    mailRelayUser: process.env.MAIL_RELAY_USER || undefined,
    mailRelayPass: process.env.MAIL_RELAY_PASS || undefined,
    mailFromAddress: optional("MAIL_FROM_ADDRESS", `${required("BRIDGE_USERNAME")}@${required("BRIDGE_DOMAIN")}`),

    actorCacheTtlHours: optionalInt("ACTOR_CACHE_TTL_HOURS", 24),

    logLevel: optional("LOG_LEVEL", "info"),
  };

  return cached;
}

/** Test/tooling helper — clears the cached config so a fresh loadConfig() re-reads process.env. */
export function resetConfigCache(): void {
  cached = undefined;
}

export function actorId(config: Pick<Config, "bridgeDomain" | "bridgeUsername">): string {
  return `https://${config.bridgeDomain}/users/${config.bridgeUsername}`;
}

export function actorInboxUrl(config: Pick<Config, "bridgeDomain" | "bridgeUsername">): string {
  return `${actorId(config)}/inbox`;
}

export function mediaBaseUrl(config: Pick<Config, "bridgeDomain">): string {
  return `https://${config.bridgeDomain}/media`;
}
