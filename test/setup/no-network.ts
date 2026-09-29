// --- テスト中の実ネットワーク遮断 (measure → improve ループ M1) ---
// 実験室のベンチとテストは外部 API を差し替えて走る。差し替え忘れで本物の Gemini / Google へ
// 出ていくと、結果が揺れるうえに本人のデータや課金に触れる。そこで差し替えられていない
// 通信はすべて例外にし、試みた回数を数える (ベンチは `network_calls` としてこれを記録する)。
import net from "node:net";
import tls from "node:tls";

type NetworkGuard = { attempts: string[] };

const guard: NetworkGuard = { attempts: [] };
(globalThis as { __networkGuard?: NetworkGuard }).__networkGuard = guard;

function block(what: string): never {
  guard.attempts.push(what);
  throw new Error(`[no-network] blocked: ${what}`);
}

// 接続先だけを記録する (本文やヘッダは記録しない)
function target(args: unknown[]): string {
  const [a, b] = args;
  if (typeof a === "object" && a !== null) {
    const o = a as { host?: unknown; port?: unknown; path?: unknown };
    return `${String(o.host ?? o.path ?? "?")}:${String(o.port ?? "")}`;
  }
  return `${String(b ?? "?")}:${String(a ?? "")}`;
}

// fetch: テストが vi.stubGlobal("fetch", ...) で差し替えれば、そちらが使われる
globalThis.fetch = (async (input: unknown) => {
  const url = input instanceof Request ? input.url : String(input);
  return block(`fetch ${new URL(url).host}`);
}) as typeof fetch;

// http / https / Node の fetch (undici) は最終的にここを通る
net.Socket.prototype.connect = function (...args: unknown[]) {
  return block(`net ${target(args)}`);
} as typeof net.Socket.prototype.connect;

tls.connect = ((...args: unknown[]) => block(`tls ${target(args)}`)) as typeof tls.connect;
