import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startInboundSmtpServer } from "../../src/mail/smtp-listener";

let server: ReturnType<typeof startInboundSmtpServer> | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

function rcptTo(port: number, address: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1");
    let step = 0;
    let lastResponse = "";
    const script = ["EHLO test\r\n", "MAIL FROM:<sender@external.example>\r\n", `RCPT TO:<${address}>\r\n`];
    socket.setEncoding("utf8");
    socket.on("error", reject);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.endsWith("\r\n")) return;
      lastResponse = buffer;
      buffer = "";
      if (step < script.length) {
        socket.write(script[step]);
        step += 1;
      } else {
        socket.write("QUIT\r\n");
        socket.end();
        resolve(lastResponse);
      }
    });
  });
}

describe("startInboundSmtpServer — multi-domain recipient acceptance", () => {
  it("accepts RCPT TO for bridgeDomain and every bridgeExtraMailDomains entry, rejects anything else", async () => {
    const port = 12525 + Math.floor(Math.random() * 1000);
    const onMail = vi.fn().mockResolvedValue(undefined);

    server = startInboundSmtpServer(
      {
        inboundSmtpHost: "127.0.0.1",
        inboundSmtpPort: port,
        inboundMaxMessageBytes: 10 * 1024 * 1024,
        bridgeUsername: "jay",
        bridgeDomain: "mail.example.com",
        bridgeExtraMailDomains: ["example.com", "Example.org"],
      },
      onMail,
    );

    await new Promise((resolve) => setTimeout(resolve, 50)); // let listen() settle

    await expect(rcptTo(port, "jay@mail.example.com")).resolves.toContain("250");
    await expect(rcptTo(port, "jay@example.com")).resolves.toContain("250");
    await expect(rcptTo(port, "jay@EXAMPLE.ORG")).resolves.toContain("250"); // case-insensitive
    await expect(rcptTo(port, "jay@unrelated.example")).resolves.toContain("550");
    await expect(rcptTo(port, "someoneelse@mail.example.com")).resolves.toContain("550");
  });
});
