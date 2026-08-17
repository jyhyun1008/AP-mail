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
 * 4096-bit keypair on first boot if the files don't exist yet. The private key
 * file is chmod'd 0600 since it's the actor's only credential.
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
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  fs.mkdirSync(path.dirname(actorPrivateKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(actorPublicKeyPath), { recursive: true });

  fs.writeFileSync(actorPrivateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(actorPublicKeyPath, publicKey, { mode: 0o644 });

  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}
