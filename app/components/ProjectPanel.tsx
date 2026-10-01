'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CATEGORY_LABEL,
  CUSTOM_KIND_MAX,
  categoryLabel,
  parseProjectInput,
  type Note,
  type NoteInput,
  type Project,
  type ProjectInput,
} from '../../lib/projects';
import { KindPicker, kindFromChoice } from './KindPicker';

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';

/**
 * 目的別プロジェクトの一覧と作成欄 (EXP-008)。
 * 一覧から選ぶと onSelect、作成欄は parseProjectInput で検査してから onCreate に渡す。
 */
export function ProjectPanel({ projects, selectedId, onSelect, onCreate }: {
  projects: Project[];
  selectedId: string | null;
  onSelect(id: string): void;
  onCreate(input: ProjectInput): void;
}) {
  const [name, setName] = useState('');
  // category = 既定の値か OTHER。OTHER のときは customCategory が種類の名前 (EXP-012)
  const [category, setCategory] = useState<string>('habit');
  const [customCategory, setCustomCategory] = useState('');
  const [purpose, setPurpose] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = parseProjectInput({ name, category: kindFromChoice(category, customCategory), purpose });
    if (!input) {
      setInvalid(`名前は1〜60字、種類の名前は${CUSTOM_KIND_MAX}字まで、目的は500字までで入力してください。`);
      return;
    }
    setInvalid(null);
    onCreate(input);
    setName('');
    setPurpose('');
  };

  return (
    <section aria-labelledby="project-list-title" className="flex flex-col gap-4">
      <h2 id="project-list-title" className="text-lg font-bold text-blue-700"><span aria-hidden="true">📁</span> プロジェクト</h2>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-700">まだプロジェクトがありません。下の欄から作れます。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => {
            const selected = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${focusRing} ${selected ? 'bg-blue-50 border-blue-600' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
                >
                  <span className="font-semibold text-gray-900 truncate">{p.name}</span>
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-700">
                    {categoryLabel(p.category)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} aria-labelledby="project-form-title" className="flex flex-col gap-3 p-3 rounded-lg bg-white border border-gray-300">
        <h3 id="project-form-title" className="text-sm font-bold text-gray-900">＋新しいプロジェクト</h3>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          名前
          <input
            type="text"
            name="project-name"
            id="project-name-input"
            autoComplete="off"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`p-2 border border-gray-500 rounded text-base text-gray-900 ${focusRing}`}
          />
        </label>

        <KindPicker
          legend="種類"
          groupName="project-category"
          presets={CATEGORY_LABEL}
          choice={category}
          custom={customCategory}
          onChoice={setCategory}
          onCustom={setCustomCategory}
        />

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          目的
          <textarea
            name="project-purpose"
            rows={2}
            maxLength={500}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className={`p-2 border border-gray-500 rounded text-base text-gray-900 ${focusRing}`}
          />
        </label>

        <div role="status" className="text-sm text-red-700">{invalid}</div>

        <button type="submit" className={`self-end px-5 py-2 rounded bg-blue-600 text-white font-bold hover:bg-blue-700 ${focusRing}`}>
          作成
        </button>
      </form>
    </section>
  );
}

// --- 画面側の状態と API 呼び出し (page.tsx を短く保つための小さな hook) ---

const DB_NOT_CONFIGURED = 'データベースが未設定です';

function problemMessage(status: number, failed: string): string {
  if (status === 503) return DB_NOT_CONFIGURED;
  return `${failed} (${status})`;
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}

type ProjectsResult = { ok: true; projects: Project[] } | { ok: false; problem: string };

/** 一覧を取りに行くだけ (state には触らない)。 */
async function requestProjects(): Promise<ProjectsResult> {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) return { ok: false, problem: problemMessage(res.status, 'プロジェクトを読み込めませんでした') };
    const body = await readJson(res);
    return { ok: true, projects: Array.isArray(body?.projects) ? (body.projects as Project[]) : [] };
  } catch {
    return { ok: false, problem: 'プロジェクトを読み込めませんでした' };
  }
}

/**
 * プロジェクトとノートの状態。enabled (ログイン済み) になったら一覧を読む。
 * 503 は「データベースが未設定です」、それ以外の失敗は短い文を problem に入れる (alert は使わない)。
 */
export function useProjectWorkspace(enabled: boolean) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // 成功のお知らせ (共通の role="status" で読み上げる)
  const [done, setDone] = useState<string | null>(null);
  // 選び直した後に遅れて届いた古いノート一覧を捨てるため
  const currentId = useRef<string | null>(null);

  const applyProjects = useCallback((r: ProjectsResult) => {
    if (r.ok) {
      setProjects(r.projects);
      setProblem(null);
    } else {
      setProblem(r.problem);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    applyProjects(await requestProjects());
  }, [applyProjects]);

  const loadNotes = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/notes?projectId=${encodeURIComponent(projectId)}`);
      if (currentId.current !== projectId) return;
      if (!res.ok) {
        setProblem(problemMessage(res.status, 'ノートを読み込めませんでした'));
        return;
      }
      const body = await readJson(res);
      if (currentId.current !== projectId) return;
      setNotes(Array.isArray(body?.notes) ? (body.notes as Note[]) : []);
      setProblem(null);
    } catch {
      setProblem('ノートを読み込めませんでした');
    }
  }, []);

  const select = useCallback((id: string) => {
    currentId.current = id;
    setSelectedId(id);
    setNotes([]);
    void loadNotes(id);
  }, [loadNotes]);

  const createProject = useCallback(async (input: ProjectInput) => {
    setDone(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setProblem(problemMessage(res.status, 'プロジェクトを作成できませんでした'));
        return;
      }
      const body = await readJson(res);
      const created = body?.project as Project | undefined;
      await loadProjects();
      if (created?.id) select(created.id);
      setDone('プロジェクトを作りました');
    } catch {
      setProblem('プロジェクトを作成できませんでした');
    }
  }, [loadProjects, select]);

  const createNote = useCallback(async (input: NoteInput) => {
    setDone(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setProblem(problemMessage(res.status, 'ノートを記録できませんでした'));
        return;
      }
      await loadNotes(input.projectId);
      setDone('ノートを記録しました');
    } catch {
      setProblem('ノートを記録できませんでした');
    }
  }, [loadNotes]);

  const deleteNote = useCallback(async (id: string) => {
    setDone(null);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        setProblem(problemMessage(res.status, 'ノートを消せませんでした'));
        return;
      }
      if (currentId.current) await loadNotes(currentId.current);
      setDone('ノートを消しました');
    } catch {
      setProblem('ノートを消せませんでした');
    }
  }, [loadNotes]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void requestProjects().then((r) => {
      if (!cancelled) applyProjects(r);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, applyProjects]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return { projects, selectedId, selected, notes, problem, done, select, createProject, createNote, deleteNote, loadProjects };
}
