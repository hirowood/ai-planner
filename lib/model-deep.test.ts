import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEEP_MODEL_VERIFIED, GEMINI_MODEL, GEMINI_MODEL_DEEP, modelFor } from "./model";
import { withModelFallback } from "./gemini-retry";

const err = (status: number) => Object.assign(new Error(`[${status}]`), { status });

describe("会話によってモデルを分ける (EXP-044)", () => {
  it("確かめたら 壁打ち・KGI・KPI・作成は上位・KDI・ToDo は今のモデル", () => {
    for (const u of ["chat", "kgi", "kpi", "setup"] as const) expect(modelFor(u, true)).toBe(GEMINI_MODEL_DEEP);
    for (const u of ["kdi", "todo"] as const) expect(modelFor(u, true)).toBe(GEMINI_MODEL);
  });

  it("確かめるまでは、どれも今のモデル (既定は未確認)", () => {
    expect(DEEP_MODEL_VERIFIED).toBe(false);
    for (const u of ["chat", "kgi", "kpi", "kdi", "todo", "setup"] as const) expect(modelFor(u)).toBe(GEMINI_MODEL);
    expect(GEMINI_MODEL_DEEP).not.toBe(GEMINI_MODEL);
  });
});

describe("withModelFallback (EXP-044)", () => {
  it("上位が 404 / 429 なら今のモデルで 1 回だけ (fellBack: true)", async () => {
    // status だけ持つ失敗と、文にだけ番号がある失敗の両方
    const fails = [404, 429].flatMap((status) => [
      Object.assign(new Error("model unavailable"), { status }),
      new Error(`[GoogleGenerativeAI Error]: [${status} Not Found]`),
    ]);
    for (const failure of fails) {
      const used: string[] = [];
      const r = await withModelFallback(async (m) => { used.push(m); if (m === "deep") throw failure; return m; }, "deep", "lite");
      expect(r).toEqual({ result: "lite", fellBack: true });
      expect(used).toEqual(["deep", "lite"]);
    }
  });

  it("ほかの失敗はそのまま投げる・成功なら fellBack: false", async () => {
    await expect(withModelFallback(async () => { throw err(500); }, "deep", "lite")).rejects.toMatchObject({ status: 500 });
    expect(await withModelFallback(async (m) => m, "deep", "lite")).toEqual({ result: "deep", fellBack: false });
  });

  it("同じモデルなら 1 回だけ呼ぶ (404 でも送り直さない)", async () => {
    let n = 0;
    await expect(withModelFallback(async () => { n += 1; throw err(404); }, "lite", "lite")).rejects.toMatchObject({ status: 404 });
    expect(n).toBe(1);
  });

  it("作る会話 (setup) も上位のモデルを替えつき・繰り返しの禁止を使う", () => {
    const src = readFileSync("app/api/setup/route.ts", "utf8");
    expect(src).toContain('withModelFallback(generate, modelFor("setup"), GEMINI_MODEL)');
    expect(src).toContain("8. 直前の自分の質問と同じ質問をしないでください。");
  });

  it("確かめる道具はキーも返事の中身も出さない", () => {
    const src = readFileSync("scripts/probe-model.mjs", "utf8");
    const logs = src.split("\n").filter((l) => /console\.(log|error)/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).not.toMatch(/\bkey\b|\.text\(\)|res\b|response/);
    }
  });
});
