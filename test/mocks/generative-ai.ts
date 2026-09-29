// @google/generative-ai の差し替え。
// - sendMessage: `geminiState.reply` を `delayMs` 待ってから一括で返す (改善前の呼び方)
// - sendMessageStream: `chunks` を 1 つずつ `chunkDelayMs` 間隔で返す (EXP-001 のストリーミング)。
//   `failAfterChunks` を指定すると、その数だけ返したあとで失敗する
export const geminiState: {
  reply: string;
  delayMs: number;
  chunks: string[] | null; // null なら reply を 1 チャンクとして返す
  chunkDelayMs: number;
  failAfterChunks: number | null;
  calls: number;
  lastPrompt: string | null;
} = {
  reply: "fake reply",
  delayMs: 0,
  chunks: null,
  chunkDelayMs: 0,
  failAfterChunks: null,
  calls: 0,
  lastPrompt: null,
};

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
    getGenerativeModel() {
      return {
        startChat() {
          return {
            async sendMessage(prompt: string) {
              geminiState.calls += 1;
              geminiState.lastPrompt = prompt;
              if (geminiState.delayMs > 0) await wait(geminiState.delayMs);
              return { response: { text: () => geminiState.reply } };
            },
            async sendMessageStream(prompt: string) {
              geminiState.calls += 1;
              geminiState.lastPrompt = prompt;
              return { stream: chunkStream(), response: Promise.resolve({ text: () => geminiState.reply }) };
            },
          };
        },
      };
    }
  },
};
