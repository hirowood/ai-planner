// --- 計測点 (measure → improve ループ M0) ---
// 1 リクエストにつき `[perf]` の 1 行と `Server-Timing` ヘッダを出す。
// 出してよいのは下の 5 項目だけ (経路名・状態・所要時間)。
// メッセージ本文・予定の内容・セッション・トークンは、この型に入らないので出せない。

export type PerfPart = "gemini_ms" | "calendar_ms";

export type PerfLine = {
  route: string;
  status: number;
  total_ms: number;
  gemini_ms?: number;
  calendar_ms?: number;
};

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** `[perf] {...}` の 1 行を作る (サーバ・ブラウザ共通)。 */
export function formatPerfLine(line: PerfLine): string {
  const out: PerfLine = { route: line.route, status: line.status, total_ms: round(line.total_ms) };
  if (line.gemini_ms !== undefined) out.gemini_ms = round(line.gemini_ms);
  if (line.calendar_ms !== undefined) out.calendar_ms = round(line.calendar_ms);
  return `[perf] ${JSON.stringify(out)}`;
}

/** route handler 1 回分の計測。`finish` は全ての return 経路で呼ぶ。 */
export function startPerf(route: string, parts: PerfPart[] = []) {
  const t0 = performance.now();
  const acc: Partial<Record<PerfPart, number>> = {};
  for (const p of parts) acc[p] = 0;

  return {
    /** 外部呼び出し 1 回を計測して `part` に加算する。 */
    async time<T>(part: PerfPart, fn: () => Promise<T>): Promise<T> {
      const s = performance.now();
      try {
        return await fn();
      } finally {
        acc[part] = (acc[part] ?? 0) + (performance.now() - s);
      }
    },

    /** ログ 1 行を出し、`Server-Timing` を付けて同じ Response を返す。 */
    finish<R extends Response>(res: R): R {
      const line: PerfLine = { route, status: res.status, total_ms: performance.now() - t0 };
      if (acc.gemini_ms !== undefined) line.gemini_ms = acc.gemini_ms;
      if (acc.calendar_ms !== undefined) line.calendar_ms = acc.calendar_ms;
      console.log(formatPerfLine(line));

      const timing = [`total;dur=${round(line.total_ms)}`];
      if (line.gemini_ms !== undefined) timing.push(`gemini;dur=${round(line.gemini_ms)}`);
      if (line.calendar_ms !== undefined) timing.push(`calendar;dur=${round(line.calendar_ms)}`);
      res.headers.set("Server-Timing", timing.join(", "));
      return res;
    },
  };
}
