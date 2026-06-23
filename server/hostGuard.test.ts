import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import express from "express";
import { hostGuard } from "./hostGuard.ts";

let server: http.Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.use(hostGuard(5174));
  app.get("/", (_req, res) => {
    res.json({ ok: true });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  port = (server.address() as { port: number }).port;
});

afterAll(() => server?.close());

// fetch() forbids overriding the Host header, so drive a raw http request.
function statusFor(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/", method: "GET", headers: { host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode as number));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("hostGuard (DNS-rebinding defense)", () => {
  it("allows loopback hosts in the allowlist", async () => {
    expect(await statusFor("localhost")).toBe(200);
    expect(await statusFor("127.0.0.1")).toBe(200);
    expect(await statusFor("127.0.0.1:5174")).toBe(200);
  });

  it("rejects a foreign Host header (403)", async () => {
    expect(await statusFor("evil.com")).toBe(403);
  });

  it("rejects a loopback host on the wrong port (403)", async () => {
    expect(await statusFor("localhost:9999")).toBe(403);
  });

  it("rejects an empty Host header (403)", async () => {
    expect(await statusFor("")).toBe(403);
  });
});
