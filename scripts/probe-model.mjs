// 上位のモデルが使えるかを 1 回だけ呼んで確かめる (EXP-044)。
// 使い方: node --env-file=.env.local scripts/probe-model.mjs
// キー・返事の中身は出さない。出すのはモデルの名前と、成功か HTTP の状態だけ。

import { GoogleGenerativeAI } from "@google/generative-ai";

const key = process.env.GOOGLE_API_KEY;
if (!key) {
  console.error("GOOGLE_API_KEY が未設定です (.env.local を確認してください)");
  process.exit(1);
}
const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
const genAI = new GoogleGenerativeAI(key);
for (const name of models) {
  try {
    const res = await genAI.getGenerativeModel({ model: name }).generateContent("1+1 の答えを数字だけで");
    const ok = typeof res.response.text() === "string";
    console.log(`${name}: ${ok ? "ok (200)" : "no text"}`);
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : "error";
    console.log(`${name}: failed (${status})`);
  }
}
