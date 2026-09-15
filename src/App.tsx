import { useMemo, useState } from 'react';
import {
  C_MAX,
  C_MIN,
  C_PATTERN,
  MAX_ASSERTIONS,
  MAX_EVENTS,
  hasErrors,
  validateBatch,
  type RawRow,
} from './lib/parse';
import { findNegativeCycle } from './lib/solver';
import { analyzeTightening, type TightenAnalysis } from './lib/tighten';
import type { SolveResult } from './lib/types';
import { ResultPanel } from './components/ResultPanel';
import { TightenPanel } from './components/TightenPanel';

interface RowState extends RawRow {
  key: number;
}

let nextKey = 1;
const emptyRow = (): RowState => ({ key: nextKey++, id: '', u: '', v: '', c: '' });
const fromRaw = (raw: RawRow): RowState => ({ key: nextKey++, ...raw });

/** 负环示例：3+2-6 = -1 < 0；编号故意乱序，演示旋转至最小编号开头。 */
const NEGATIVE_EXAMPLE: RawRow[] = [
  { id: '7', u: '靠港', v: '补给', c: '3' },
  { id: '2', u: '补给', v: '离港', c: '2' },
  { id: '5', u: '离港', v: '靠港', c: '-6' },
];

/** 相容示例：3+2-5 = 0，不存在负环。 */
const CONSISTENT_EXAMPLE: RawRow[] = [
  { id: '1', u: '靠港', v: '补给', c: '3' },
  { id: '2', u: '补给', v: '离港', c: '2' },
  { id: '3', u: '离港', v: '靠港', c: '-5' },
];

export default function App() {
  const [rows, setRows] = useState<RowState[]>(() => [emptyRow(), emptyRow(), emptyRow()]);
  const [result, setResult] = useState<SolveResult | null>(null);
  // 修订预演状态：preview 记录最近一次预演结果及其目标行 key（用于识别
  // 删除目标行）；previewStale 记录作废原因，用于就地反馈。
  const [previewTargetId, setPreviewTargetId] = useState<number | null>(null);
  const [previewC, setPreviewC] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ analysis: TightenAnalysis; rowKey: number } | null>(
    null,
  );
  const [previewStale, setPreviewStale] = useState<string | null>(null);

  const batch = useMemo(() => validateBatch(rows), [rows]);
  const filledCount = batch.rows.filter((r) => !r.empty).length;
  const eventCount = new Set(batch.assertions.flatMap((a) => [a.u, a.v])).size;

  /** 录入表一旦变化，旧结论与进行中的预演一并作废，并就地反馈作废原因。 */
  const invalidateOnEdit = (staleMessage: string) => {
    setResult(null);
    if (preview !== null) {
      setPreview(null);
      setPreviewStale(staleMessage);
    }
  };

  const mutate = (updater: (prev: RowState[]) => RowState[]) => {
    invalidateOnEdit('录入表已变化，此前的修订预演已作废，请重新考证并预演。');
    setRows(updater);
  };
  const updateField = (key: number, field: keyof RawRow, value: string) =>
    mutate((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const addRow = () => mutate((prev) => [...prev, emptyRow()]);
  const removeRow = (key: number) => {
    invalidateOnEdit(
      preview !== null && preview.rowKey === key
        ? '目标断言所在行已被删除，修订预演作废。'
        : '录入表已变化，此前的修订预演已作废，请重新考证并预演。',
    );
    setRows((prev) => prev.filter((r) => r.key !== key));
  };
  const loadRows = (raws: RawRow[]) => mutate(() => raws.map(fromRaw));

  const compute = () => {
    if (!batch.ok) return;
    setPreviewStale(null); // 重新考证后，旧作废提示不再适用。
    setResult(findNegativeCycle(batch.assertions));
  };

  /** 预演输入（目标断言 / 新 c）变化：旧预演结果不再对应，静默清除。 */
  const changePreviewTarget = (id: number | null) => {
    setPreviewTargetId(id);
    setPreview(null);
    setPreviewError(null);
  };
  const changePreviewC = (text: string) => {
    setPreviewC(text);
    setPreview(null);
    setPreviewError(null);
  };

  const runPreview = () => {
    const target = batch.assertions.find((a) => a.id === previewTargetId);
    if (target === undefined) {
      setPreviewError('请选择要修订的断言。');
      return;
    }
    const text = previewC.trim();
    if (!C_PATTERN.test(text)) {
      setPreviewError('新 c 须为整数（形如 -3、0、42）。');
      return;
    }
    const value = Number(text);
    if (value < C_MIN || value > C_MAX) {
      setPreviewError(`新 c 须在 ${C_MIN} 至 ${C_MAX} 之间。`);
      return;
    }
    if (value > target.c) {
      setPreviewError(`新 c 须不大于原值 ${target.c}（收紧只能减小或保持不变）。`);
      return;
    }
    setPreviewError(null);
    setPreviewStale(null);
    setPreview({
      analysis: analyzeTightening(batch.assertions, target.id, value),
      rowKey: rows[target.row - 1].key,
    });
  };

  /** 预演判为安全后的一键写回：更新该行 c、清除旧考证结论与预演。 */
  const writeBackPreview = () => {
    if (preview === null || !preview.analysis.safe) return;
    const { target, proposedC } = preview.analysis;
    setRows((prev) =>
      prev.map((r, i) => (i === target.row - 1 ? { ...r, c: String(proposedC) } : r)),
    );
    setResult(null);
    setPreview(null);
    setPreviewStale(null);
  };

  return (
    <main className="page">
      <header>
        <h1>航海日志差分约束负环考证</h1>
        <p className="lede">
          每行录入一条断言：编号、起始事件 u、结束事件 v、整数 c，语义为{' '}
          <code>date(v) − date(u) ≤ c</code>。考证员据此寻找最短且可重复复核的矛盾链
          （权重和小于零的有向简单环）。
        </p>
        <ul className="rules">
          <li>编号匹配 <code>[1-9][0-9]{'{0,5}'}</code>，整批唯一，按整数数值比较；</li>
          <li>事件名区分大小写、非空，可含空格（含首尾空格）与中文等字符（长度不限，完全按原样参与计算）；</li>
          <li>c 为整数，范围 {C_MIN} 至 {C_MAX}；</li>
          <li>每批 1–{MAX_EVENTS} 个事件、1–{MAX_ASSERTIONS} 条断言；任一非法行均阻止计算。</li>
        </ul>
      </header>

      <section aria-label="断言录入">
        <div className="toolbar">
          <button type="button" onClick={addRow} data-testid="add-row">
            添加断言行
          </button>
          <button type="button" onClick={() => loadRows(NEGATIVE_EXAMPLE)} data-testid="load-negative">
            载入负环示例
          </button>
          <button type="button" onClick={() => loadRows(CONSISTENT_EXAMPLE)} data-testid="load-consistent">
            载入相容示例
          </button>
          <button type="button" onClick={() => loadRows([{ id: '', u: '', v: '', c: '' }])} data-testid="clear-rows">
            清空
          </button>
          <span className="counter" data-testid="batch-counter">
            当前 {filledCount} 条断言 / {eventCount} 个事件（上限 {MAX_ASSERTIONS} 条 / {MAX_EVENTS} 个）
          </span>
        </div>

        <table className="assertions">
          <thead>
            <tr>
              <th scope="col">行</th>
              <th scope="col">断言编号</th>
              <th scope="col">起始事件 u</th>
              <th scope="col">结束事件 v</th>
              <th scope="col">上界 c</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const validation = batch.rows[i];
              const errors = validation?.errors ?? {};
              const invalid = validation !== undefined && !validation.empty && hasErrors(errors);
              return (
                <tr key={row.key} className={invalid ? 'row-invalid' : ''} data-testid={`row-${i}`}>
                  <td className="row-number">{i + 1}</td>
                  <td>
                    <input
                      value={row.id}
                      inputMode="numeric"
                      placeholder="如 12"
                      aria-label={`第 ${i + 1} 行断言编号`}
                      aria-invalid={Boolean(errors.id)}
                      data-testid={`row-${i}-id`}
                      onChange={(e) => updateField(row.key, 'id', e.target.value)}
                    />
                    {errors.id && (
                      <div className="field-error" role="alert" data-testid={`row-${i}-id-error`}>
                        {errors.id}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      value={row.u}
                      placeholder="如 靠港"
                      aria-label={`第 ${i + 1} 行起始事件`}
                      aria-invalid={Boolean(errors.u)}
                      data-testid={`row-${i}-u`}
                      onChange={(e) => updateField(row.key, 'u', e.target.value)}
                    />
                    {errors.u && (
                      <div className="field-error" role="alert" data-testid={`row-${i}-u-error`}>
                        {errors.u}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      value={row.v}
                      placeholder="如 补给"
                      aria-label={`第 ${i + 1} 行结束事件`}
                      aria-invalid={Boolean(errors.v)}
                      data-testid={`row-${i}-v`}
                      onChange={(e) => updateField(row.key, 'v', e.target.value)}
                    />
                    {errors.v && (
                      <div className="field-error" role="alert" data-testid={`row-${i}-v-error`}>
                        {errors.v}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      value={row.c}
                      inputMode="numeric"
                      placeholder="如 -3"
                      aria-label={`第 ${i + 1} 行上界 c`}
                      aria-invalid={Boolean(errors.c)}
                      data-testid={`row-${i}-c`}
                      onChange={(e) => updateField(row.key, 'c', e.target.value)}
                    />
                    {errors.c && (
                      <div className="field-error" role="alert" data-testid={`row-${i}-c-error`}>
                        {errors.c}
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => removeRow(row.key)}
                      data-testid={`row-${i}-remove`}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {batch.batchErrors.length > 0 && (
          <ul className="batch-errors" data-testid="batch-errors">
            {batch.batchErrors.map((message) => (
              <li key={message} role="alert">
                {message}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="compute"
          disabled={!batch.ok}
          onClick={compute}
          data-testid="compute-button"
        >
          开始考证
        </button>
        {!batch.ok && (
          <p className="hint" data-testid="compute-blocked">
            存在非法行或整批错误，已阻止计算；请修正就地标注的错误。
          </p>
        )}
      </section>

      {result && <ResultPanel result={result} />}

      {result?.kind === 'consistent' && (
        <TightenPanel
          assertions={batch.assertions}
          targetId={previewTargetId}
          cText={previewC}
          error={previewError}
          preview={preview?.analysis ?? null}
          onTargetChange={changePreviewTarget}
          onCTextChange={changePreviewC}
          onRun={runPreview}
          onWriteBack={writeBackPreview}
        />
      )}

      {previewStale !== null && (
        <p className="preview-stale" role="status" data-testid="preview-stale">
          {previewStale}
        </p>
      )}
    </main>
  );
}
