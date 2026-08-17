import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "../config";

export interface ReplyEmailParams {
  to: string;
  subject: string;
  text: string;
  /** Original email's Message-ID — sets In-Reply-To so the sender's client threads this as a reply. */
  inReplyToMessageId?: string;
  /** Original email's References chain plus its own Message-ID appended — sets References for the same reason. */
  referencesHeaderValue?: string;
}

/** Builds (but does not verify/connect) a transport that relays through local Postfix. */
export function createMailTransport(
  config: Pick<Config, "mailRelayHost" | "mailRelayPort" | "mailRelayUser" | "mailRelayPass">,
): Transporter {
  return nodemailer.createTransport({
    host: config.mailRelayHost,
    port: config.mailRelayPort,
    secure: false, // local submission — see docs/dns-and-mail-setup.md for the trusted-network vs SMTP AUTH tradeoff
    auth: config.mailRelayUser ? { user: config.mailRelayUser, pass: config.mailRelayPass } : undefined,
    // Without these, a firewall silently dropping (rather than refusing) the connection
    // to the relay leaves the TCP handshake hanging for the OS's default timeout — which
    // can be minutes — and the /inbox request processing it just hangs right along with
    // it (hit in practice: a docker-networked relay target that wasn't in the host
    // firewall's allowlist). Fail loudly and fast instead.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    // This relay is reached over an internal path only (loopback, or a Docker bridge
    // network gated by mynetworks/firewall rules — see docs/dns-and-mail-setup.md) and
    // Postfix's submission listener commonly presents a self-signed cert with nothing
    // else exposing it to the outside. Rejecting untrusted certs here has no real
    // security benefit for a same-host relay we already trust by network topology, and
    // breaks STARTTLS against Postfix's default self-signed cert out of the box.
    tls: { rejectUnauthorized: false },
  });
}

/** Sends the reply email, threaded to the original message via In-Reply-To/References. */
export async function sendReplyEmail(
  transport: Transporter,
  config: Pick<Config, "mailFromAddress" | "bridgeActorName">,
  params: ReplyEmailParams,
): Promise<void> {
  await transport.sendMail({
    // Reuses BRIDGE_ACTOR_NAME (the same display name shown on the AP/Misskey side) as
    // the email "From" display name too, e.g. "Jay <you@mail.example.com>" instead of a
    // bare address — falls back to just the address if it's not set. Note: there's no
    // equivalent for the avatar/icon on the email side — plain email has no concept of a
    // sender avatar (some clients show Gravatar based on the address, but that's separate
    // infrastructure this bridge has no control over).
    from: config.bridgeActorName ? { name: config.bridgeActorName, address: config.mailFromAddress } : config.mailFromAddress,
    to: params.to,
    subject: params.subject,
    text: params.text,
    inReplyTo: params.inReplyToMessageId,
    references: params.referencesHeaderValue,
  });
}
