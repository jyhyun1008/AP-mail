import { describe, expect, it } from "vitest";
import { buildActorDocument } from "../../src/actor/document";
import { bridgeAcctResource, buildWebfingerResponse } from "../../src/actor/webfinger";

const config = {
  bridgeDomain: "mail.example.com",
  bridgeUsername: "jay",
  bridgeActorType: "Service" as const,
};

const fakePublicKeyPem = "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----\n";

describe("buildWebfingerResponse", () => {
  it("answers acct:<username>@<domain> with a self link to the actor", () => {
    const response = buildWebfingerResponse(config);

    expect(response.subject).toBe("acct:jay@mail.example.com");
    expect(response.links).toEqual([
      {
        rel: "self",
        type: "application/activity+json",
        href: "https://mail.example.com/users/jay",
      },
    ]);
  });

  it("bridgeAcctResource matches the subject buildWebfingerResponse returns", () => {
    expect(bridgeAcctResource(config)).toBe(buildWebfingerResponse(config).subject);
  });
});

describe("buildActorDocument", () => {
  it("produces a spec-shaped actor object with a matching inbox and publicKey", () => {
    const doc = buildActorDocument(config, fakePublicKeyPem);

    expect(doc.id).toBe("https://mail.example.com/users/jay");
    expect(doc.type).toBe("Service");
    expect(doc.preferredUsername).toBe("jay");
    expect(doc.inbox).toBe("https://mail.example.com/users/jay/inbox");
    expect(doc.publicKey).toEqual({
      id: "https://mail.example.com/users/jay#main-key",
      owner: "https://mail.example.com/users/jay",
      publicKeyPem: fakePublicKeyPem,
    });
    expect(doc["@context"]).toContain("https://www.w3.org/ns/activitystreams");
  });
});
