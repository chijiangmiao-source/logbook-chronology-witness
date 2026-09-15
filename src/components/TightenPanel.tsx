import { C_MAX, C_MIN } from '../lib/parse';
import type { TightenAnalysis } from '../lib/tighten';
import type { Assertion } from '../lib/types';

/**
 * 单条断言修订预演面板（依附于相容结论）：
 * - 选择现有断言并输入范围内且不大于原值的新 c，预演收紧后的相容性；
 * - 预演只读，不改动录入表；显示可安全收紧的临界值（或无有限临界值）；
 * - 判为安全时可一键写回该行；判为越界时展示逐步累计矛盾链且禁止写回。
 */
export interface TightenPanelProps {
  /** 当前批次的合法断言（预演目标从中选择）。 */
  assertions: Assertion[];
  /** 当前选中的目标断言编号（未选为 null）。 */
  targetId: number | null;
  /** 新 c 的输入文本。 */
  cText: string;
  /** 预演输入的就地错误（无错误为 null）。 */
  error: string | null;
  /** 最近一次预演的分析结果（无则 null）。 */
  preview: TightenAnalysis | null;
  onTargetChange: (id: number | null) => void;
  onCTextChange: (text: string) => void;
  onRun: () => void;
  onWriteBack: () => void;
}

export function TightenPanel({
  assertions,
  targetId,
  cText,
  error,
  preview,
  onTargetChange,
  onCTextChange,
  onRun,
  onWriteBack,
}: TightenPanelProps) {
  return (
    <section className="preview" data-testid="tighten-panel" aria-label="单条断言修订预演">
      <h2>单条断言修订预演</h2>
      <p className="meta">
        选择一条现有断言，输入 {C_MIN} 至 {C_MAX} 且不大于原值的新 c，
        预演收紧后日志是否仍相容。预演不改动录入表；判为安全后可一键写回该行。
      </p>
      <div className="preview-controls">
        <label>
          目标断言
          <select
            data-testid="preview-target"
            aria-label="预演目标断言"
            value={targetId === null ? '' : String(targetId)}
            onChange={(e) => onTargetChange(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="" disabled>
              选择断言
            </option>
            {assertions.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.id}　{a.u} → {a.v}（c = {a.c}）
              </option>
            ))}
          </select>
        </label>
        <label>
          新上界 c
          <input
            data-testid="preview-c"
            inputMode="numeric"
            placeholder="不大于原值"
            aria-label="预演新上界 c"
            value={cText}
            onChange={(e) => onCTextChange(e.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="preview-run"
          onClick={onRun}
          disabled={targetId === null}
        >
          开始预演
        </button>
      </div>
      {error !== null && (
        <div className="field-error" role="alert" data-testid="preview-error">
          {error}
        </div>
      )}
      {preview !== null && <PreviewResult analysis={preview} onWriteBack={onWriteBack} />}
    </section>
  );
}

function PreviewResult({
  analysis,
  onWriteBack,
}: {
  analysis: TightenAnalysis;
  onWriteBack: () => void;
}) {
  const { target, proposedC, critical, returnPath, safe, contradiction } = analysis;
  return (
    <div
      className={`preview-result ${safe ? 'safe' : 'unsafe'}`}
      data-testid="preview-result"
      aria-live="polite"
    >
      {critical === null ? (
        <p data-testid="preview-critical">
          无有限临界值：排除断言 #{target.id} 后，{target.v} 无法回到 {target.u}
          ，该断言无论如何收紧都不会闭环成环。
        </p>
      ) : (
        <p data-testid="preview-critical">
          临界值 = {critical}：新 c ≥ {critical} 时修订后仍相容（排除该断言后 {target.v} → … →{' '}
          {target.u} 的最小权重返回路径总权重 = {returnPath!.total}）。
        </p>
      )}

      {safe ? (
        <div data-testid="preview-safe">
          <p>拟议 c = {proposedC} 安全：修订后约束仍相容，可写回。</p>
          <button type="button" data-testid="preview-writeback" onClick={onWriteBack}>
            一键写回该行（c ← {proposedC}）并清除旧结论
          </button>
        </div>
      ) : (
        <div data-testid="preview-unsafe">
          <p>
            拟议 c = {proposedC} 越界（小于临界值 {critical}
            ）：将制造如下矛盾链，禁止写回。
          </p>
          <ol className="chain" data-testid="preview-chain">
            {contradiction!.steps.map((step, i) => (
              <li key={i} data-testid={`preview-step-${i}`}>
                <span className="step-order">第 {i + 1} 步</span>
                <span className="step-id">
                  断言 #{step.assertion.id}
                  {i === 0 ? '（拟议）' : ''}
                </span>
                <span className="step-ineq">
                  date({step.assertion.v}) − date({step.assertion.u}) ≤ {step.assertion.c}
                </span>
                <span className="step-sum" data-testid={`preview-step-${i}-sum`}>
                  累计和 = {step.cumulative}
                </span>
              </li>
            ))}
          </ol>
          <p className="conclusion" data-testid="preview-total">
            拟议断言与返回路径相加：左端沿链相消为 0，右端累计总和 = {contradiction!.total}
            。总和小于零 —— 得到 0 ≤ {contradiction!.total} 的矛盾。
          </p>
        </div>
      )}
    </div>
  );
}
