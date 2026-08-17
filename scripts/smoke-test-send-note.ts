/**
 * `npm run smoke:send-note`
 *
 * Manually triggers the inbound email -> DM path against your *real* configured
 * ALLOWED_ACTOR_URI, without needing a real inbound SMTP delivery through Postfix.
 * Useful right after deploying, to confirm the bridge can actually reach and be
 * accepted by your live Misskey account (see docs/misskey-followup-caveat.md) —
 * point this at production `.env` and check your Misskey DMs afterward.
 *
 * Does not start the HTTP server or SMTP listener; just runs the same
 * bridge/email-to-dm.ts orchestration index.ts wires up for real inbound mail.
 */
import { onInboundEmail } from "../src/bridge/email-to-dm";
import { generateOrLoadActorKeypair } from "../src/actor/keys";
import { actorId, loadConfig } from "../src/config";
import { createActorCache } from "../src/signatures/actor-cache";
import { openDatabase } from "../src/store/db";
import { createNotesRepo } from "../src/store/notes.repo";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.dbPath);
  const actorCache = createActorCache(db, config.actorCacheTtlHours);
  const notesRepo = createNotesRepo(db);
  const { privateKeyPem } = generateOrLoadActorKeypair(config);
  const keyId = `${actorId(config)}#main-key`;

  const testEmail = {
    from: "smoke-test@apmail.local",
    fromName: "apmail smoke test",
    subject: "apmail smoke test",
    text: `If you can see this DM, the bridge is correctly delivering to ${config.allowedActorUri}.\n\nSent at ${new Date().toISOString()}.`,
    messageId: `<smoke-${Date.now()}@apmail.local>`,
    attachments: [],
  };

  console.log(`Sending test DM to ${config.allowedActorUri} ...`);

  try {
    await onInboundEmail(testEmail, { config, actorCache, notesRepo, privateKeyPem, keyId });
    console.log("✅ Delivered without error. Check your Misskey DMs to confirm it actually arrived");
    console.log("   (a 2xx from the inbox doesn't guarantee Misskey didn't silently drop it —");
    console.log("   see docs/misskey-followup-caveat.md if nothing shows up).");
  } catch (err) {
    console.error("❌ Delivery failed:", err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
