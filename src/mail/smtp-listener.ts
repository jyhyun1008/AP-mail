import { SMTPServer } from "smtp-server";
import type { Config } from "../config";
import { logger } from "../util/logger";
import { parseInboundEmail, type ParsedInboundEmail } from "./parse";

export type InboundMailHandler = (email: ParsedInboundEmail) => Promise<void>;

/**
 * Starts the internal SMTP listener that Postfix's `transport_maps` hands bridge-domain
 * mail off to. Only accepts RCPT TO matching the single configured bridge mailbox
 * (defense in depth — Postfix's transport_maps should already scope this, but a
 * misconfiguration there shouldn't turn this into an open relay/catch-all).
 */
export function startInboundSmtpServer(
  config: Pick<Config, "inboundSmtpHost" | "inboundSmtpPort" | "inboundMaxMessageBytes" | "bridgeUsername" | "bridgeDomain">,
  onMail: InboundMailHandler,
): SMTPServer {
  const allowedRecipient = `${config.bridgeUsername}@${config.bridgeDomain}`.toLowerCase();

  const server = new SMTPServer({
    banner: "apmail bridge",
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    size: config.inboundMaxMessageBytes,

    onRcptTo(address, _session, callback) {
      if (address.address.toLowerCase() !== allowedRecipient) {
        const err = new Error("No such mailbox here") as Error & { responseCode?: number };
        err.responseCode = 550;
        callback(err);
        return;
      }
      callback();
    },

    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", (err) => callback(err));
      stream.on("end", () => {
        const raw = Buffer.concat(chunks);
        parseInboundEmail(raw)
          .then((parsed) => onMail(parsed))
          .then(() => callback())
          .catch((err) => {
            // Accept the SMTP transaction regardless (avoid bounce/backscatter to the
            // sender for what's usually *our* bug), but log loudly so it's visible.
            logger.error({ err }, "failed to process inbound email; message accepted but dropped");
            callback();
          });
      });
    },
  });

  server.listen(config.inboundSmtpPort, config.inboundSmtpHost);
  logger.info(
    { host: config.inboundSmtpHost, port: config.inboundSmtpPort, mailbox: allowedRecipient },
    "inbound SMTP listener started",
  );

  return server;
}
