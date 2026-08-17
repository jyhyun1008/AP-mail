import { describe, expect, it, vi } from "vitest";
import { sendReplyEmail } from "../../src/mail/send";
import type { Transporter } from "nodemailer";

function fakeTransport() {
  return { sendMail: vi.fn().mockResolvedValue(undefined) } as unknown as Transporter;
}

const baseParams = { to: "alice@example.com", subject: "Re: Hi", text: "hello" };

describe("sendReplyEmail", () => {
  it("sends a bare address as From when no display name is configured", async () => {
    const transport = fakeTransport();

    await sendReplyEmail(transport, { mailFromAddress: "jay@mail.example.com", bridgeActorName: undefined }, baseParams);

    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "jay@mail.example.com" }));
  });

  it("sends a {name, address} From when a display name is configured", async () => {
    const transport = fakeTransport();

    await sendReplyEmail(transport, { mailFromAddress: "jay@mail.example.com", bridgeActorName: "Jay" }, baseParams);

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: { name: "Jay", address: "jay@mail.example.com" } }),
    );
  });
});
