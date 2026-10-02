import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { refreshErrorKind } from "./auth-log";

describe("refreshErrorKind (安全レビュー W3)", () => {
  it("Error は名前だけ・Google の応答は error の種類だけ・説明や本文は出さない", () => {
    expect(refreshErrorKind(new TypeError("secret-ish message canary-a1"))).toBe("TypeError");
    expect(refreshErrorKind({ error: "invalid_grant", error_description: "Token canary-b2 has been revoked" })).toBe("invalid_grant");
    expect(refreshErrorKind({ error: "x canary-c3 </script>" })).toBe("unknown");
    expect(refreshErrorKind(null)).toBe("unknown");
    expect(refreshErrorKind("raw string canary-d4")).toBe("unknown");
  });
  it("route は応答の物をそのままログに渡さない", () => {
    const src = readFileSync(new URL("../app/api/auth/[...nextauth]/route.ts", import.meta.url), "utf8");
    expect(src).toContain('console.error("RefreshAccessTokenError", refreshErrorKind(error));');
    expect(src).not.toMatch(/console\.error\("RefreshAccessTokenError", error\)/);
  });
});
