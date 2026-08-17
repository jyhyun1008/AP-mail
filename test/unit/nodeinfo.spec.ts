import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerNodeinfoRoute } from "../../src/routes/nodeinfo.route";

const config = { bridgeDomain: "mail.example.com" };

describe("nodeinfo routes", () => {
  it("GET /.well-known/nodeinfo points at the 2.0 document on this domain", async () => {
    const app = Fastify();
    registerNodeinfoRoute(app, config);

    const response = await app.inject({ method: "GET", url: "/.well-known/nodeinfo" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: "https://mail.example.com/nodeinfo/2.0" }],
    });

    await app.close();
  });

  it("GET /nodeinfo/2.0 identifies the software", async () => {
    const app = Fastify();
    registerNodeinfoRoute(app, config);

    const response = await app.inject({ method: "GET", url: "/nodeinfo/2.0" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBe("2.0");
    expect(body.software.name).toBe("apmail");
    expect(body.protocols).toContain("activitypub");

    await app.close();
  });
});
