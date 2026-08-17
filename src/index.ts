import { generateOrLoadActorKeypair } from "./actor/keys";
import { loadConfig } from "./config";
import { buildServer } from "./server";
import { openDatabase } from "./store/db";
import { logger } from "./util/logger";

async function main(): Promise<void> {
  const config = loadConfig();

  // Opened eagerly even though nothing reads/writes it yet in M1 — actor-cache (M3) and
  // notes.repo (M2) both depend on the schema existing before the server accepts traffic.
  const db = openDatabase(config.dbPath);

  const { publicKeyPem } = generateOrLoadActorKeypair(config);

  const app = buildServer(config, { publicKeyPem });

  await app.listen({ port: config.httpPort, host: config.httpHost });
  logger.info(
    { port: config.httpPort, host: config.httpHost, actor: `${config.bridgeUsername}@${config.bridgeDomain}` },
    "apmail bridge listening",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
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
