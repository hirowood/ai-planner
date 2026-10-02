// --- 計測点 (measure → improve ループ M0 / EXP-001 / UX PDCA C0) ---
// 1 リクエストにつき `[perf]` の 1 行と `Server-Timing` ヘッダを出す。
// 出してよいのは下の項目だけ (経路名・状態・所要時間・数・真偽)。
// メッセージ本文・予定の内容・セッション・トークンは、この型に入らないので出せない。

export type PerfPart = "gemini_ms" | "calendar_ms" | "db_ms";

export type PerfLine = {
  route: string;
  status: number;
  total_ms: number;
  gemini_ms?: number;
  calendar_ms?: number;
  db_ms?: number; // データベースの待ち (EXP-008)
  // 最初のチャンクを書き出すまで (EXP-001 で追加)。全文を 1 回で返す応答では total_ms と同じ
  first_chunk_ms?: number;
  // 以下は UX PDCA C0 で追加 (docs/ux-pdca-plan.md)。数と真偽だけで、中身は持たない
  history_len?: number; // そのリクエストまでの会話のメッセージ数
  plan_proposed?: boolean; // 返答に予定案 (```json ブロック) が含まれたか
  question_count?: number; // 返答に含まれる「？」「?」の数 (EXP-004)
  time_prompted?: boolean; // 返答に時間の入力画面の目印があったか (EXP-006)
  time_dialog_used?: boolean; // そのメッセージが時間の入力画面から送られたか (EXP-006)
  row_count?: number; // データベースから返した行の数 (EXP-008)。行の中身は持たない
  fields_filled?: number; // 返した Plan の埋まった欄の数 0〜6 (EXP-009)。欄の中身は持たない
  context_notes?: number; // AI に渡したノートの件数 (上限で切った後・EXP-016)。中身は持たない
  context_cycles?: number; // AI に渡した過去の周の件数 (上限で切った後・EXP-016)。中身は持たない
  choices_count?: number; // 返した答えの候補の数 (EXP-023)。候補の中身は持たない
  items_added?: number; // AI が階層に足した項目の数 (EXP-019)。項目の中身は持たない
  context_days?: number; // AI に渡した 1 日の記録の件数 (EXP-020)。中身は持たない
  hypothesis_saved?: boolean; // AI と立てた仮説をノートに残したか (EXP-032)。中身は持たない
  judgement_applied?: boolean; // AI と決めた判定を ToDo に入れたか (EXP-034)。中身は持たない
  pick_added?: boolean; // 候補のボタンで選んだ項目を足したか (EXP-035)。中身は持たない
  item_changed?: boolean; // AI と話して KPI か KDI を変えたか (EXP-038)。中身は持たない
  model_fallback?: boolean; // 上位のモデルが使えず今のモデルで送り直したか (EXP-044)
  question_repeat?: boolean; // 返答の質問が直前の自分の質問と同じか (EXP-044)。中身は持たない
};

// 真偽・数を出すための検査だけに使う。ここで見た本文はどこにも残さない
export type PerfFlag = { name: "plan_proposed" | "time_prompted"; pattern: RegExp };
export type PerfCount = { name: "question_count"; pattern: RegExp }; // pattern は g フラグ付き

// set() で入れられる項目 (リクエスト中に分かる数・真偽だけ)
type KnownField =
  | "history_len"
  | "time_dialog_used"
  | "row_count"
  | "fields_filled"
  | "time_prompted"
  | "context_notes"
  | "context_cycles"
  | "choices_count"
  | "items_added"
  | "context_days"
  | "hypothesis_saved"
  | "judgement_applied"
  | "pick_added"
  | "item_changed"
  | "model_fallback"
  | "question_repeat";

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** `[perf] {...}` の 1 行を作る (サーバ・ブラウザ共通)。 */
export function formatPerfLine(line: PerfLine): string {
  const out: PerfLine = { route: line.route, status: line.status, total_ms: round(line.total_ms) };
  if (line.gemini_ms !== undefined) out.gemini_ms = round(line.gemini_ms);
  if (line.calendar_ms !== undefined) out.calendar_ms = round(line.calendar_ms);
  if (line.db_ms !== undefined) out.db_ms = round(line.db_ms);
  if (line.first_chunk_ms !== undefined) out.first_chunk_ms = round(line.first_chunk_ms);
  if (line.history_len !== undefined) out.history_len = line.history_len;
  if (line.plan_proposed !== undefined) out.plan_proposed = line.plan_proposed;
  if (line.question_count !== undefined) out.question_count = line.question_count;
  if (line.time_prompted !== undefined) out.time_prompted = line.time_prompted;
  if (line.time_dialog_used !== undefined) out.time_dialog_used = line.time_dialog_used;
  if (line.row_count !== undefined) out.row_count = line.row_count;
  if (line.fields_filled !== undefined) out.fields_filled = line.fields_filled;
  if (line.context_notes !== undefined) out.context_notes = line.context_notes;
  if (line.context_cycles !== undefined) out.context_cycles = line.context_cycles;
  if (line.choices_count !== undefined) out.choices_count = line.choices_count;
  if (line.items_added !== undefined) out.items_added = line.items_added;
  if (line.context_days !== undefined) out.context_days = line.context_days;
  if (line.hypothesis_saved !== undefined) out.hypothesis_saved = line.hypothesis_saved;
  if (line.judgement_applied !== undefined) out.judgement_applied = line.judgement_applied;
  if (line.pick_added !== undefined) out.pick_added = line.pick_added;
  if (line.item_changed !== undefined) out.item_changed = line.item_changed;
  if (line.model_fallback !== undefined) out.model_fallback = line.model_fallback;
  if (line.question_repeat !== undefined) out.question_repeat = line.question_repeat;
  return `[perf] ${JSON.stringify(out)}`;
}

/** route handler 1 回分の計測。`finish` は全ての return 経路で呼ぶ。 */
export function startPerf(route: string, parts: PerfPart[] = []) {
  const t0 = performance.now();
  const acc: Partial<Record<PerfPart, number>> = {};
  for (const p of parts) acc[p] = 0;
  // ストリーム応答を返したら、`[perf]` はストリームを閉じたときに出す (finish では出さない)
  let deferred = false;
  // リクエストの時点で分かる数・真偽 (例 history_len・row_count)。set() で入れる
  const known: Pick<PerfLine, KnownField> = {};

  const line = (status: number, extra: Partial<PerfLine> = {}): PerfLine => {
    const out: PerfLine = { route, status, total_ms: performance.now() - t0, ...known, ...extra };
    if (acc.gemini_ms !== undefined) out.gemini_ms = acc.gemini_ms;
    if (acc.calendar_ms !== undefined) out.calendar_ms = acc.calendar_ms;
    if (acc.db_ms !== undefined) out.db_ms = acc.db_ms;
    return out;
  };

  return {
    /** リクエストの時点で分かる数を記録する (数だけ。中身は渡せない型にしてある)。 */
    set(fields: Pick<PerfLine, KnownField>): void {
      if (fields.history_len !== undefined) known.history_len = fields.history_len;
      if (fields.time_dialog_used !== undefined) known.time_dialog_used = fields.time_dialog_used;
      if (fields.row_count !== undefined) known.row_count = fields.row_count;
      if (fields.fields_filled !== undefined) known.fields_filled = fields.fields_filled;
      if (fields.time_prompted !== undefined) known.time_prompted = fields.time_prompted;
      if (fields.context_notes !== undefined) known.context_notes = fields.context_notes;
      if (fields.context_cycles !== undefined) known.context_cycles = fields.context_cycles;
      if (fields.choices_count !== undefined) known.choices_count = fields.choices_count;
      if (fields.items_added !== undefined) known.items_added = fields.items_added;
      if (fields.context_days !== undefined) known.context_days = fields.context_days;
      if (fields.hypothesis_saved !== undefined) known.hypothesis_saved = fields.hypothesis_saved;
      if (fields.judgement_applied !== undefined) known.judgement_applied = fields.judgement_applied;
      if (fields.pick_added !== undefined) known.pick_added = fields.pick_added;
      if (fields.item_changed !== undefined) known.item_changed = fields.item_changed;
      if (fields.model_fallback !== undefined) known.model_fallback = fields.model_fallback;
      if (fields.question_repeat !== undefined) known.question_repeat = fields.question_repeat;
    },

    /** 外部呼び出し 1 回を計測して `part` に加算する。 */
    async time<T>(part: PerfPart, fn: () => Promise<T>): Promise<T> {
      const s = performance.now();
      try {
        return await fn();
      } finally {
        acc[part] = (acc[part] ?? 0) + (performance.now() - s);
      }
    },

    /** ログ 1 行を出し、`Server-Timing` を付けて同じ Response を返す。ストリーム応答はそのまま返す。 */
    finish<R extends Response>(res: R): R {
      if (deferred) return res;
      const l = line(res.status);
      console.log(formatPerfLine(l));

      const timing = [`total;dur=${round(l.total_ms)}`];
      if (l.gemini_ms !== undefined) timing.push(`gemini;dur=${round(l.gemini_ms)}`);
      if (l.calendar_ms !== undefined) timing.push(`calendar;dur=${round(l.calendar_ms)}`);
      if (l.db_ms !== undefined) timing.push(`db;dur=${round(l.db_ms)}`);
      res.headers.set("Server-Timing", timing.join(", "));
      return res;
    },

    /**
     * 文字列のチャンク列をそのまま送るストリーム応答を作る (EXP-001)。
     * - `first_chunk_ms`: 最初のチャンクを書き出した時点
     * - `total_ms` と `part` (例 gemini_ms): ストリームを閉じた時点。`partStart` から数える
     * - 途中で失敗したら status 500、クライアントが中断したら 499 として 1 行出す
     *   (HTTP の status は既に 200 で送ってあるので、結果は `[perf]` の status で表す)
     * - ヘッダは本文より先に出るので、`Server-Timing` にはヘッダを送るまでの時間だけを載せる
     */
    streamText(
      source: AsyncIterable<string>,
      opts: { part?: PerfPart; partStart?: number; flags?: PerfFlag[]; count?: PerfCount } = {},
    ): Response {
      const flags = opts.flags ?? [];
      deferred = true;
      const encoder = new TextEncoder();
      const it = source[Symbol.asyncIterator]();
      let first: number | undefined;
      let ended = false;
      // flags・count の検査のためだけに全文を持つ (チャンクの境目で目印が割れても判定できるように)。ログには出さない
      let seen = "";

      const end = (status: number) => {
        if (ended) return;
        ended = true;
        if (opts.part && opts.partStart !== undefined) {
          acc[opts.part] = (acc[opts.part] ?? 0) + (performance.now() - opts.partStart);
        }
        const l = line(status);
        l.first_chunk_ms = first ?? l.total_ms;
        if (status === 200) for (const f of flags) l[f.name] = f.pattern.test(seen);
        if (opts.count && status === 200) l[opts.count.name] = (seen.match(opts.count.pattern) ?? []).length;
        seen = "";
        console.log(formatPerfLine(l));
      };

      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await it.next();
            if (done) {
              end(200);
              controller.close();
              return;
            }
            if (first === undefined) first = performance.now() - t0;
            if (flags.length > 0 || opts.count) seen += value;
            controller.enqueue(encoder.encode(value));
          } catch (error: unknown) {
            end(500);
            controller.error(error);
          }
        },
        async cancel() {
          end(499);
          await it.return?.();
        },
      });

      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Server-Timing": `headers;dur=${round(performance.now() - t0)}`,
        },
      });
    },
  };
}
