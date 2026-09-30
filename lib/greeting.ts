// 時間帯の挨拶と、最初にすることの選択肢 (EXP-021)。
// 画面で作る純粋な関数だけ (Gemini を使わない)。受け渡しの形は evidence/EXP-021/request.md §2 が正本。

export type ChoiceId = "resume" | "new_project" | "calendar" | "brainstorm" | "suggest" | "ask_next" | "plan_today";
export type Choice = { id: ChoiceId; label: string; message?: string }; // message があるものは押すと会話に送る

/** 端末の時刻で挨拶を決める。5:00〜9:59 / 10:00〜16:59 / 17:00〜4:59。 */
export function greetingFor(d: Date): string {
  // 分単位で比べる (境界 4:59 / 5:00 / 9:59 / 10:00 / 16:59 / 17:00 を取り違えないため)
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes >= 5 * 60 && minutes < 10 * 60) return "おはようございます";
  if (minutes >= 10 * 60 && minutes < 17 * 60) return "こんにちは";
  return "こんばんは";
}

/** 最初の一言。「？」は 1 つだけ (問いを 1 つに絞って迷わせないため)。 */
export function startMessage(p: {
  greeting: string;
  userName?: string | null;
  projectName?: string | null;
  hasHistory: boolean;
}): string {
  const name = p.userName?.trim();
  const head = name ? `${p.greeting}、${name}さん。` : `${p.greeting}。`;
  const project = p.projectName?.trim();
  if (!project) return `${head}今日は何をしますか？`;
  if (p.hasHistory) return `${head}『${project}』の続きから始めますか？`;
  return `${head}『${project}』の PDCA を一緒に始めましょう。何からしますか？`;
}

/** 最初にすることの選択肢。プロジェクトを選んでいる時だけ、会話に送る決まった文を持つ。 */
export function startChoices(p: { projectSelected: boolean; hasLastProject: boolean }): Choice[] {
  if (p.projectSelected) {
    return [
      { id: "resume", label: "前回の続き", message: "前回の続きから、今の状況をまとめて次にすることを 1 つ教えてください。" },
      { id: "suggest", label: "提案がほしい", message: "今の記録から、次に取り組むとよいことを提案してください。" },
      { id: "ask_next", label: "質問に答えて決める", message: "Plan の次に決める欄を質問してください。" },
      { id: "plan_today", label: "今日の予定を決める", message: "今日やることを 3 つ決めるのを手伝ってください。" },
      { id: "brainstorm", label: "壁打ち・相談", message: "少し相談したいことがあります。聞いてもらえますか。" },
    ];
  }
  // プロジェクト無し: 画面の動きだけ (message 無し)。最後に開いたプロジェクトが無ければ「前回の続き」は出さない
  const choices: Choice[] = [];
  if (p.hasLastProject) choices.push({ id: "resume", label: "前回の続き" });
  choices.push(
    { id: "new_project", label: "新しいプロジェクト" },
    { id: "calendar", label: "予定を見る" },
    { id: "brainstorm", label: "壁打ち・相談" },
  );
  return choices;
}
