import { describe, expect, it } from "vitest";
import { quotaBody, quotaKind, quotaNotice, quotaResetLabel } from "./quota";

describe("quotaKind", () => {
  it("errorDetails の quotaId に PerDay があれば quota_daily", () => {
    const e = { errorDetails: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] };
    expect(quotaKind(e)).toBe("quota_daily");
  });
  it("errorDetails が無くても、文言に PerDay があれば quota_daily", () => {
    expect(quotaKind({ message: "... quotaId: GenerateRequestsPerDayPerProjectPerModel ..." })).toBe("quota_daily");
  });
  it("1 分あたりの上限や、手がかりの無い 429 は quota_rate", () => {
    expect(quotaKind({ errorDetails: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] }] })).toBe("quota_rate");
    expect(quotaKind({ message: "429" })).toBe("quota_rate");
    expect(quotaKind({ errorDetails: "not an array" })).toBe("quota_rate");
  });
});

describe("quotaResetLabel (EXP-005 L3)", () => {
  it("夏時間: 太平洋時間の 0 時 = 日本時間 16:00", () => {
    expect(quotaResetLabel(new Date("2026-09-30T03:00:00Z"))).toBe("16:00"); // JST 12:00
  });
  it("冬時間: 太平洋時間の 0 時 = 日本時間 17:00", () => {
    expect(quotaResetLabel(new Date("2026-12-01T03:00:00Z"))).toBe("17:00"); // JST 12:00
  });
  it("戻る時刻を過ぎた直後なら、次の日の同じ時刻", () => {
    expect(quotaResetLabel(new Date("2026-09-30T07:30:00Z"))).toBe("16:00"); // JST 16:30
  });
});

describe("quotaBody / quotaNotice (EXP-005 L4)", () => {
  const now = new Date("2026-09-30T03:00:00Z");

  it("1 日の上限: 戻る時刻を含むお知らせになる", () => {
    const body = quotaBody("quota_daily", now);
    expect(body).toEqual({ error: expect.stringContaining("16:00"), kind: "quota_daily", reset_at: "16:00" });
    expect(quotaNotice(429, body)).toBe("本日の AI 利用上限に達しました。16:00 ごろに戻ります。送れなかった文は入力欄に戻しました。");
  });
  it("それ以外の上限: 少し待って送り直す案内", () => {
    expect(quotaNotice(429, quotaBody("quota_rate", now))).toContain("1 分ほど待ってから送り直してください");
  });
  it("本文が読めなくても 429 ならお知らせを出す", () => {
    expect(quotaNotice(429, null)).toContain("送り直してください");
  });
  it("429 以外は null (今までどおりのエラー処理)", () => {
    expect(quotaNotice(500, { kind: "quota_daily", reset_at: "16:00" })).toBeNull();
    expect(quotaNotice(401, null)).toBeNull();
  });
  it("お知らせに「エラー」の語を使わない", () => {
    for (const body of [quotaBody("quota_daily", now), quotaBody("quota_rate", now), null]) {
      expect(quotaNotice(429, body)).not.toContain("エラー");
    }
  });
});
