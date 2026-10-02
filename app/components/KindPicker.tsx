'use client';

import { CUSTOM_KIND_MAX } from '../../lib/projects';

/** 「その他」を選んだときの値 (既定の値とかぶらない印)。 */
export const OTHER = '__other__';

/** 選んだ内容から保存する値を決める: 既定の値ならその値、「その他」なら入力した名前。 */
export function kindFromChoice(choice: string, custom: string): string {
  return choice === OTHER ? custom : choice;
}

/**
 * 種類の欄 (EXP-012)。既定の値のラジオと「その他」。「その他」を選ぶと名前の入力欄が出る。
 * プロジェクトの種類とノートの種類で共通に使う。
 */
export function KindPicker({ legend, groupName, presets, choice, custom, onChoice, onCustom }: {
  legend: string;
  groupName: string;
  presets: Record<string, string>;
  choice: string;
  custom: string;
  onChoice(choice: string): void;
  onCustom(text: string): void;
}) {
  const options: [string, string][] = [...Object.entries(presets), [OTHER, 'その他']];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm text-gray-700 mb-1">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([value, label]) => (
          <label
            key={value}
            className={`flex-1 min-w-16 text-center px-3 py-2 rounded-lg border cursor-pointer text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${choice === value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300'}`}
          >
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={choice === value}
              onChange={() => onChoice(value)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
      {choice === OTHER && (
        <label className="flex flex-col gap-1 text-sm text-gray-700 mt-1">
          種類の名前 ({CUSTOM_KIND_MAX}字まで)
          <input
            type="text"
            name={`${groupName}-custom`}
            autoComplete="off"
            maxLength={CUSTOM_KIND_MAX}
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            className="p-2 border border-gray-500 rounded text-base text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          />
        </label>
      )}
    </fieldset>
  );
}
