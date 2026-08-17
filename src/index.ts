import fs from "node:fs";
import { generateOrLoadActorKeypair } from "./actor/keys";
import { onInboundEmail } from "./bridge/email-to-dm";
import { actorId, loadConfig } from "./config";
import { startInboundSmtpServer } from "./mail/smtp-listener";
import { purgeExpiredAttachments } from "./media/attachment-store";
import { buildServer } from "./server";
import { createActorCache } from "./signatures/actor-cache";
import { openDatabase } from "./store/db";
import { createNotesRepo } from "./store/notes.repo";
import { logger } from "./util/logger";

const ATTACHMENT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.dbPath);
  const actorCache = createActorCache(db, config.actorCacheTtlHours);
  const notesRepo = createNotesRepo(db);

  fs.mkdirSync(config.attachmentsDir, { recursive: true });
  const runAttachmentPurge = () => {
    const purged = purgeExpiredAttachments(config.attachmentsDir, config.attachmentsRetentionDays);
    if (purged > 0) logger.info({ purged }, "purged expired attachments");
  };
  runAttachmentPurge();
  const purgeTimer = setInterval(runAttachmentPurge, ATTACHMENT_PURGE_INTERVAL_MS);

  const { privateKeyPem, publicKeyPem } = generateOrLoadActorKeypair(config);
  const keyId = `${actorId(config)}#main-key`;

  const app = buildServer(config, { publicKeyPem });
  await app.listen({ port: config.httpPort, host: config.httpHost });
  logger.info(
    { port: config.httpPort, host: config.httpHost, actor: `${config.bridgeUsername}@${config.bridgeDomain}` },
    "apmail bridge listening",
  );

  const smtpServer = startInboundSmtpServer(config, async (email) => {
    try {
      await onInboundEmail(email, { config, actorCache, notesRepo, privateKeyPem, keyId });
    } catch (err) {
      logger.error({ err, from: email.from, subject: email.subject }, "failed to bridge inbound email to DM");
    }
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    clearInterval(purgeTimer);
    await app.close();
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
