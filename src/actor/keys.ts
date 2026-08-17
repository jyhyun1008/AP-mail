import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config";
import { logger } from "../util/logger";

export interface ActorKeypair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * Loads the bot actor's RSA keypair from disk, generating and persisting a new
 * 2048-bit keypair on first boot if the files don't exist yet. The private key
 * file is chmod'd 0600 since it's the actor's only credential.
 *
 * 2048 bits (not 4096) deliberately — this matches Mastodon's own default actor key
 * size and is still well beyond adequate for HTTP Signatures, and generation is both
 * faster and far less entropy-hungry. RSA keygen blocks on kernel entropy, and 4096-bit
 * generation on a host with a thin entropy pool (common on minimal VMs/homelab
 * hardware without a hardware RNG or haveged/rng-tools running) can hang for a very
 * long time — the log line right above the generateKeyPairSync call below is there so
 * a stuck boot is diagnosable (see it in logs with nothing after -> keygen is stalled).
 */
export function generateOrLoadActorKeypair(
  config: Pick<Config, "actorPrivateKeyPath" | "actorPublicKeyPath">,
): ActorKeypair {
  const { actorPrivateKeyPath, actorPublicKeyPath } = config;

  const bothExist = fs.existsSync(actorPrivateKeyPath) && fs.existsSync(actorPublicKeyPath);
  if (bothExist) {
    return {
      privateKeyPem: fs.readFileSync(actorPrivateKeyPath, "utf8"),
      publicKeyPem: fs.readFileSync(actorPublicKeyPath, "utf8"),
    };
  }

  logger.info({ actorPrivateKeyPath, actorPublicKeyPath }, "generating new actor RSA keypair");

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  fs.mkdirSync(path.dirname(actorPrivateKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(actorPublicKeyPath), { recursive: true });

  fs.writeFileSync(actorPrivateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(actorPublicKeyPath, publicKey, { mode: 0o644 });

  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}
