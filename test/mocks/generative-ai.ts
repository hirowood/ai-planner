// @google/generative-ai の差し替え。
// - sendMessage: 一括で返す (改善前の呼び方)。`chunks` があれば、ストリーム版と同じく
//   チャンクを `chunkDelayMs` ずつ生成し、全部そろってから連結して返す (EXP-002)。
//   こうすると両方の呼び方に同じタイマーの丸めがかかり、生成の実時間が揃う。
//   `chunks` が無ければ `reply` を `delayMs` 待ってから返す (EXP-001 までの条件)
// - sendMessageStream: `chunks` を 1 つずつ `chunkDelayMs` 間隔で返す (EXP-001 のストリーミング)。
//   `failAfterChunks` を指定すると、その数だけ返したあとで失敗する。
//   `failWith` を指定すると、ストリームが始まる前にそれを投げる (429 などの API エラー・EXP-005)
export const geminiState: {
  failWith: unknown;
  reply: string;
  delayMs: number;
  chunks: string[] | null; // null なら reply を 1 チャンクとして返す
  chunkDelayMs: number;
  failAfterChunks: number | null;
  calls: number;
  lastPrompt: string | null;
  // getGenerativeModel({ generationConfig }) か generateContent({ generationConfig }) で渡された最後の設定 (EXP-009)
  lastConfig: Record<string, unknown> | null;
  // getGenerativeModel({ model }) で渡された最後のモデル名 (EXP-014)
  lastModel: string | null;
} = {
  lastModel: null,
  failWith: null,
  reply: "fake reply",
  delayMs: 0,
  chunks: null,
  chunkDelayMs: 0,
  failAfterChunks: null,
  calls: 0,
  lastPrompt: null,
  lastConfig: null,
};

function configOf(x: unknown): Record<string, unknown> | null {
  if (typeof x !== "object" || x === null) return null;
  const c = (x as { generationConfig?: unknown }).generationConfig;
  return typeof c === "object" && c !== null ? (c as Record<string, unknown>) : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* chunkStream(): AsyncGenerator<{ text(): string }> {
  const pieces = geminiState.chunks ?? [geminiState.reply];
  for (let i = 0; i < pieces.length; i++) {
    if (geminiState.failAfterChunks !== null && i >= geminiState.failAfterChunks) {
      throw new Error("fake stream failure");
    }
    if (geminiState.chunkDelayMs > 0) await wait(geminiState.chunkDelayMs);
    const piece = pieces[i];
    yield { text: () => piece };
  }
}

export const generativeAiMock = {
  GoogleGenerativeAI: class {
    getGenerativeModel(params?: unknown) {
      const modelConfig = configOf(params);
      if (modelConfig) geminiState.lastConfig = modelConfig;
      const model = (params as { model?: unknown } | undefined)?.model;
      if (typeof model === "string") geminiState.lastModel = model;
      return {
        // 一括で JSON などを返させる呼び方 (EXP-009 の /api/plan/chat)。
        // prompt は文字列でも GenerateContentRequest でもよい (後者は JSON にして lastPrompt へ)
        async generateContent(prompt: unknown) {
          geminiState.calls += 1;
          geminiState.lastPrompt = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
          const requestConfig = configOf(prompt);
          if (requestConfig) geminiState.lastConfig = requestConfig;
          if (geminiState.failWith) throw geminiState.failWith;
          if (geminiState.delayMs > 0) await wait(geminiState.delayMs);
          return { response: { text: () => geminiState.reply } };
        },
        startChat() {
          return {
            async sendMessage(prompt: string) {
              geminiState.calls += 1;
              geminiState.lastPrompt = prompt;
              if (geminiState.chunks) {
                let text = "";
                for await (const chunk of chunkStream()) text += chunk.text();
                return { response: { text: () => text } };
              }
              if (geminiState.delayMs > 0) await wait(geminiState.delayMs);
              return { response: { text: () => geminiState.reply } };
            },
            async sendMessageStream(prompt: string) {
              geminiState.calls += 1;
              geminiState.lastPrompt = prompt;
              if (geminiState.failWith) throw geminiState.failWith;
              return { stream: chunkStream(), response: Promise.resolve({ text: () => geminiState.reply }) };
            },
          };
        },
      };
    }
  },
};
