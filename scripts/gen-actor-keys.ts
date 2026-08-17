/**
 * Standalone CLI: `npm run gen-keys`.
 * Pre-generates (or confirms) the bot actor's RSA keypair without booting the full
 * server — useful for provisioning key files before first deploy, or just confirming
 * ACTOR_PRIVATE_KEY_PATH/ACTOR_PUBLIC_KEY_PATH point somewhere writable.
 */
import { generateOrLoadActorKeypair } from "../src/actor/keys";
import { loadConfig } from "../src/config";

const config = loadConfig();
const { publicKeyPem } = generateOrLoadActorKeypair(config);

console.log(`Actor keypair ready for ${config.bridgeUsername}@${config.bridgeDomain}`);
console.log(`  private key: ${config.actorPrivateKeyPath}`);
console.log(`  public key:  ${config.actorPublicKeyPath}`);
console.log();
console.log(publicKeyPem);
