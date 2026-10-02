import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NotesPanel } from "./NotesPanel";
import { TechoView } from "./Techo";
import { HYPOTHESIS_NOTE, RESULT_NOTE, TECHO_NOTE_KINDS, parseNoteInput, type Note } from "../../lib/projects";

const P = "123e4567-e89b-12d3-a456-426614174000";
const project = { id: P, name: "英語", category: "learning", purpose: "", createdAt: "" };
const note = (n: number, kind: string): Note => ({ id: `n${n}`, projectId: P, kind, body: `本文 ${n}`, createdAt: `2026-10-0${n}T00:00:00.000Z` });
const noop = () => {};

describe("手帳のノート (EXP-042)", () => {
  it("L1: 種類の選択肢は 仮説・検証結果 が先・既定は仮説・保存する値は文字のまま", () => {
    const html = renderToStaticMarkup(
      <NotesPanel project={project} notes={[]} presets={TECHO_NOTE_KINDS} defaultKind={HYPOTHESIS_NOTE} filters={[HYPOTHESIS_NOTE, RESULT_NOTE]} onCreate={noop} onDelete={noop} />,
    );
    const labels = [...html.matchAll(/<input[^>]*name="note-kind"[^>]*>/g)].map((m) => /value="([^"]+)"/.exec(m[0])?.[1]);
    expect(labels.slice(0, 5)).toEqual(["仮説", "検証結果", "fact", "data", "thought"]);
    const checked = [...html.matchAll(/<input[^>]*name="note-kind"[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('checked=""'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="仮説"');
    expect(parseNoteInput({ projectId: P, kind: RESULT_NOTE, body: "x" })?.kind).toBe("検証結果");
  });
  it("L2: 絞り込みの すべて / 仮説 / 検証結果 (件数・aria-pressed)", () => {
    const html = renderToStaticMarkup(
      <NotesPanel project={project} notes={[note(1, "仮説"), note(2, "検証結果"), note(3, "仮説"), note(4, "fact")]} presets={TECHO_NOTE_KINDS} filters={[HYPOTHESIS_NOTE, RESULT_NOTE]} onCreate={noop} onDelete={noop} />,
    );
    expect(html).toContain('role="group" aria-label="ノートを種類で絞る"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>すべて \(4\)</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>仮説 \(2\)</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>検証結果 \(1\)</);
    // 「仮説」で絞ると仮説だけ・見出しに種類 (M3)
    const only = renderToStaticMarkup(
      <NotesPanel project={project} notes={[note(1, "仮説"), note(2, "検証結果"), note(3, "仮説")]} presets={TECHO_NOTE_KINDS} filters={[HYPOTHESIS_NOTE, RESULT_NOTE]} initialFilter={HYPOTHESIS_NOTE} onCreate={noop} onDelete={noop} />,
    );
    expect(only).toContain("本文 1");
    expect(only).toContain("本文 3");
    expect(only).not.toContain("本文 2");
    expect(only).toContain("ノート (仮説) (2)");
    // 絞り込みが無ければボタンは出ない
    const plain = renderToStaticMarkup(<NotesPanel project={project} notes={[]} onCreate={noop} onDelete={noop} />);
    expect(plain).not.toContain("ノートを種類で絞る");
  });
  it("L3: 手帳の欄にノート (データの前)・手帳から NotesPanel を出す", () => {
    const html = renderToStaticMarkup(
      <TechoView today="2026-10-02" mode="day" date="2026-10-02" items={[]} logs={[]} notes={[]} onChange={noop} renderDay={() => <p>DAY</p>} beforeStats={<p>NOTES-SLOT</p>} />,
    );
    expect(html.indexOf("DAY")).toBeLessThan(html.indexOf("NOTES-SLOT"));
    expect(html.indexOf("NOTES-SLOT")).toBeLessThan(html.indexOf("これまでのデータ"));
    const src = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
    expect(src).toContain("📓</span> ノート (仮説・検証結果)");
    expect(src).toContain("filters={[HYPOTHESIS_NOTE, RESULT_NOTE]}");
    // 手帳のノートは既定で「仮説」を選ぶ (M2)
    expect(src).toContain("defaultKind={HYPOTHESIS_NOTE}");
  });
});
