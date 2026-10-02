import { describe, expect, it } from "vitest";
import {
  CYCLE_FIELD_CHARS,
  NOTES_LIMIT,
  NOTE_CHARS,
  PAST_CYCLES_LIMIT,
  buildRecordsText,
  neutralize,
  recordCounts,
  type CoachRecords,
} from "./coach-context";
import { EMPTY_PLAN, type PlanDraft } from "./pdca-plan";

// 03:00Z は JST でも同じ日付 (どちらの表記で日付を出してもよい)
const DAY = "2026-09-30T03:00:00.000Z";
const DATE_RE = /(2026-09-30|2026\/09\/30|2026\/9\/30|09\/30|9\/30|9月30日)/;

const pad = (i: number) => String(i).padStart(2, "0");
const noteBody = (i: number) => `note-canary-${pad(i)}`;
const pastPurpose = (i: number) => `past-cycle-canary-${pad(i)}`;

function records(over: Partial<CoachRecords> = {}): CoachRecords {
  return {
    project: { name: "朝の散歩", category: "habit", purpose: "体力をつける" },
    plan: { ...EMPTY_PLAN, kpis: [], kdis: [] },
    notes: [],
    pastCycles: [],
    ...over,
  };
}

function notes(n: number, kind = "気づき") {
  return Array.from({ length: n }, (_, i) => ({ kind, body: noteBody(i + 1), createdAt: DAY }));
}

function pastCycles(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    plan: { ...EMPTY_PLAN, kpis: [], kdis: [], purpose: pastPurpose(i + 1) } as PlanDraft,
    phase: "do",
    updatedAt: DAY,
  }));
}

describe("coach-context の定数 (EXP-016 L1)", () => {
  it("上限は 20 件・300 字・3 周・200 字 (EXP-016 L1)", () => {
    expect({ NOTES_LIMIT, NOTE_CHARS, PAST_CYCLES_LIMIT, CYCLE_FIELD_CHARS }).toEqual({
      NOTES_LIMIT: 20,
      NOTE_CHARS: 300,
      PAST_CYCLES_LIMIT: 3,
      CYCLE_FIELD_CHARS: 200,
    });
  });
});

describe("neutralize (EXP-016 L1)", () => {
  it.each([
    ["<script>", "＜script＞"],
    ["a<b>c", "a＜b＞c"],
    ["</Records>", "＜/Records＞"],
    ["タグ無し", "タグ無し"],
  ])("%s → %s (EXP-016 L1)", (input, want) => {
    expect(neutralize(input)).toBe(want);
  });
});

describe("buildRecordsText — 件数の上限 (EXP-016 L1)", () => {
  it("ノート 25 件 → 新しい 20 件だけ (EXP-016 L1)", () => {
    const text = buildRecordsText(records({ notes: notes(25) }));
    for (let i = 1; i <= 20; i++) expect(text).toContain(noteBody(i));
    for (let i = 21; i <= 25; i++) expect(text).not.toContain(noteBody(i));
  });

  it("過去の周 5 件 → 新しい 3 件だけ (EXP-016 L1)", () => {
    const text = buildRecordsText(records({ pastCycles: pastCycles(5) }));
    for (let i = 1; i <= 3; i++) expect(text).toContain(pastPurpose(i));
    for (let i = 4; i <= 5; i++) expect(text).not.toContain(pastPurpose(i));
  });

  it.each([
    { label: "上限を超える", n: 25, c: 5, want: { notes: 20, pastCycles: 3 } },
    { label: "上限より少ない", n: 2, c: 1, want: { notes: 2, pastCycles: 1 } },
    { label: "無い", n: 0, c: 0, want: { notes: 0, pastCycles: 0 } },
  ])("recordCounts は切った後の数 ($label) (EXP-016 L1)", ({ n, c, want }) => {
    expect(recordCounts(records({ notes: notes(n), pastCycles: pastCycles(c) }))).toEqual(want);
  });
});

describe("buildRecordsText — 字数の上限 (EXP-016 L1)", () => {
  it("ノート 301 字 → 300 字 (EXP-016 L1)", () => {
    const body = "字".repeat(301);
    const text = buildRecordsText(records({ notes: [{ kind: "気づき", body, createdAt: DAY }] }));
    expect(text).toContain("字".repeat(300));
    expect(text).not.toContain("字".repeat(301));
  });

  it("字数は [...s] で数える (絵文字 301 個 → 300 個) (EXP-016 L1)", () => {
    const body = "😀".repeat(301);
    const text = buildRecordsText(records({ notes: [{ kind: "気づき", body, createdAt: DAY }] }));
    expect(text).toContain("😀".repeat(300));
    expect(text).not.toContain("😀".repeat(301));
  });

  it("過去の周の欄 201 字 → 200 字 (EXP-016 L1)", () => {
    const purpose = "周".repeat(201);
    const text = buildRecordsText(
      records({ pastCycles: [{ plan: { ...EMPTY_PLAN, kpis: [], kdis: [], purpose }, phase: "do", updatedAt: DAY }] }),
    );
    expect(text).toContain("周".repeat(200));
    expect(text).not.toContain("周".repeat(201));
  });
});

describe("buildRecordsText — 中身の形 (EXP-016 L1)", () => {
  it("本人の書いた < > は全角になる (ノート・プロジェクト・Plan・過去の周) (EXP-016 L1)", () => {
    const text = buildRecordsText(
      records({
        project: { name: "<b>名前</b>", category: "habit", purpose: "<i>目的</i>" },
        plan: { ...EMPTY_PLAN, kpis: [], kdis: [], kgi: "<u>目標</u>" },
        notes: [{ kind: "気づき", body: "<script>alert(1)</script>", createdAt: DAY }],
        pastCycles: [{ plan: { ...EMPTY_PLAN, kpis: [], kdis: [], purpose: "<s>昔</s>" }, phase: "do", updatedAt: DAY }],
      }),
    );
    expect(text).toContain("＜script＞");
    expect(text).not.toContain("<script>");
    for (const raw of ["<b>", "<i>", "<u>", "<s>"]) expect(text).not.toContain(raw);
  });

  it("記録が無い欄は「(まだ無し)」 (EXP-016 L1)", () => {
    const text = buildRecordsText(records());
    expect(text).toContain("(まだ無し)");
  });

  it("ノートは日付と種類が本文と同じ行に付く (EXP-016 L1)", () => {
    const text = buildRecordsText(records({ notes: [{ kind: "振り返り", body: "note-canary-line", createdAt: DAY }] }));
    const line = text.split("\n").find((l) => l.includes("note-canary-line"));
    expect(line).toBeDefined();
    expect(line).toContain("振り返り");
    expect(line).toMatch(DATE_RE);
  });

  it("今の Plan の中身とプロジェクト名が入る (EXP-016 L1)", () => {
    const text = buildRecordsText(
      records({ plan: { ...EMPTY_PLAN, kpis: [], kdis: [], purpose: "plan-purpose-canary" } }),
    );
    expect(text).toContain("plan-purpose-canary");
    expect(text).toContain("朝の散歩");
  });

  it("入力を書き換えない (純粋) (EXP-016 L1)", () => {
    const r = records({ notes: notes(25), pastCycles: pastCycles(5) });
    const before = JSON.stringify(r);
    buildRecordsText(r);
    recordCounts(r);
    expect(JSON.stringify(r)).toBe(before);
  });
});
