// @google/generative-ai の差し替え。`geminiState.reply` を返し、`delayMs` だけ待つ (ベンチで遅延を再現する)。
export const geminiState: { reply: string; delayMs: number; calls: number; lastPrompt: string | null } = {
  reply: "fake reply",
  delayMs: 0,
  calls: 0,
  lastPrompt: null,
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
          };
        },
      };
    }
  },
};
