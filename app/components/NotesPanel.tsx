'use client';

import { useRef, useState } from 'react';
import {
  CATEGORY_LABEL,
  NOTE_KIND_LABEL,
  parseNoteInput,
  type Note,
  type NoteInput,
  type NoteKind,
  type Project,
} from '../../lib/projects';

const KINDS = Object.keys(NOTE_KIND_LABEL) as NoteKind[];

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function newestFirst(a: Note, b: Note): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
}

/**
 * 選んだプロジェクトのノート (EXP-008)。種類と本文で書き、新しい順に並べる。
 * 消すときは confirm() を使わず、「消す」→「本当に消す」の 2 回押しにする。
 */
export function NotesPanel({ project, notes, onCreate, onDelete }: {
  project: Project;
  notes: Note[];
  onCreate(input: NoteInput): void;
  onDelete(id: string): void;
}) {
  const [kind, setKind] = useState<NoteKind>('fact');
  const [body, setBody] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  // 消すボタンの参照 (取り消し・削除の後にフォーカスを戻す先)
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const listHeading = useRef<HTMLHeadingElement>(null);

  const cancelDelete = (id: string) => {
    setArmedId(null);
    deleteButtons.current.get(id)?.focus();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = parseNoteInput({ projectId: project.id, kind, body });
    if (!input) {
      setInvalid('本文は1〜2000字で入力してください。');
      return;
    }
    setInvalid(null);
    onCreate(input);
    setBody('');
  };

  const sorted = [...notes].sort(newestFirst);

  const confirmDelete = (id: string) => {
    setArmedId(null);
    // 消えるノートの次 (無ければ前) の「消す」へ。どちらも無ければ一覧の見出しへ
    const i = sorted.findIndex((n) => n.id === id);
    const nextNote = sorted[i + 1] ?? sorted[i - 1];
    const target = nextNote ? deleteButtons.current.get(nextNote.id) : null;
    if (target) target.focus();
    else listHeading.current?.focus();
    onDelete(id);
  };

  return (
    <section aria-labelledby="notes-project-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 id="notes-project-title" className="text-lg font-bold text-gray-900 truncate">{project.name}</h2>
          <span className="shrink-0 text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-700">
            {CATEGORY_LABEL[project.category]}
          </span>
        </div>
        {project.purpose && <p className="text-sm text-gray-700 whitespace-pre-wrap">{project.purpose}</p>}
      </header>

      <form onSubmit={submit} className="flex flex-col gap-3 p-3 rounded-lg bg-white border border-gray-300">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm text-gray-700 mb-1">種類</legend>
          <div className="flex gap-2">
            {KINDS.map((k) => (
              <label
                key={k}
                className={`flex-1 text-center px-3 py-2 rounded-lg border cursor-pointer text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${kind === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'}`}
              >
                <input
                  type="radio"
                  name="note-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="sr-only"
                />
                {NOTE_KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          本文
          <textarea
            name="note-body"
            rows={3}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`p-2 border border-gray-500 rounded text-base text-gray-900 ${focusRing}`}
          />
        </label>

        <div role="status" className="text-sm text-red-700">{invalid}</div>

        <button type="submit" className={`self-end px-5 py-2 rounded bg-blue-600 text-white font-bold hover:bg-blue-700 ${focusRing}`}>
          記録する
        </button>
      </form>

      <h3 ref={listHeading} tabIndex={-1} id="notes-list-title" className="text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        ノート ({sorted.length})
      </h3>
      <div role="status" className="sr-only">{armedId ? 'もう一度押すと消えます' : ''}</div>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-700">まだノートがありません。</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-labelledby="notes-list-title">
          {sorted.map((n) => {
            const armed = armedId === n.id;
            return (
              <li
                key={n.id}
                onKeyDown={(e) => {
                  if (armed && e.key === 'Escape') {
                    e.preventDefault();
                    cancelDelete(n.id);
                  }
                }}
                className="p-3 rounded-lg bg-white border border-gray-300 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-xs text-gray-700">
                  <span className="px-2 py-0.5 rounded border border-gray-300 font-bold">{NOTE_KIND_LABEL[n.kind]}</span>
                  <time dateTime={n.createdAt}>{formatDate(n.createdAt)}</time>
                </div>
                <p className="text-gray-900 whitespace-pre-wrap break-words">{n.body}</p>
                <div className="flex justify-end gap-2">
                  {armed && (
                    <button
                      type="button"
                      onClick={() => cancelDelete(n.id)}
                      className={`text-xs px-2 py-1 rounded border border-gray-300 text-gray-800 hover:bg-gray-50 ${focusRing}`}
                    >
                      やめる
                    </button>
                  )}
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) deleteButtons.current.set(n.id, el);
                      else deleteButtons.current.delete(n.id);
                    }}
                    onClick={() => (armed ? confirmDelete(n.id) : setArmedId(n.id))}
                    className={`text-xs px-2 py-1 rounded border ${focusRing} ${armed ? 'bg-red-700 border-red-700 text-white font-bold hover:bg-red-800' : 'border-red-300 text-red-700 hover:bg-red-50'}`}
                  >
                    {armed ? '本当に消す' : '消す'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
