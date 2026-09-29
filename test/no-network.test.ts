import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

type NetworkGuard = { attempts: string[] };
const guard = () => (globalThis as { __networkGuard?: NetworkGuard }).__networkGuard!;

describe("no-network guard (対照: 遮断が効いていること)", () => {
  it("差し替えていない fetch は例外になり、回数に数えられる", async () => {
    const before = guard().attempts.length;
    await expect(fetch("https://example.com")).rejects.toThrow("[no-network] blocked: fetch example.com");
    expect(guard().attempts.length).toBe(before + 1);
  });

  it("Node の http / net からの接続も例外になる", () => {
    expect(() => http.get("http://example.com")).toThrow("[no-network] blocked");
    expect(() => net.connect(443, "example.com")).toThrow("[no-network] blocked");
  });
});

describe("Next 16 との互換 (T-010 の Risk 確認)", () => {
  it("route handler が使う next/server を import して Response を作れる", async () => {
    const res = NextResponse.json({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });
});
