/**
 * 差分约束负环求证。
 *
 * 断言 (u, v, c) 构成有向边 u -> v，权重 c。约束系统不自洽，当且仅当图中
 * 存在权重和小于零的有向环。本模块在找到负环时给出可逐步复核的见证：
 *
 * 1. 见证是权重和小于零的有向【简单】环：除闭合首尾外事件不重复，
 *    断言自然也不重复（同一断言若在环上出现两次必然重复事件）。
 * 2. 边数最少：边数最少的负【闭途径】必为简单环（否则可拆成两个更短闭途径，
 *    至少一个为负，矛盾）。故用 min-plus 矩阵幂逐阶检查对角线即可得到最小
 *    边数 k；此时所有长度为 k 的负闭途径都是简单环。
 * 3. 并列取舍（多项式时间，不枚举）：由于最小长度 k 上“负闭途径”与“负简单环”
 *    等价，“是否存在经过指定前缀、长度恰好 k 的负闭途径”可用矩阵幂 O(1)
 *    判定，且该判定对简单环同样精确（判定成立时，补全出的负闭途径自动是
 *    简单环）。于是逐位贪心构造字典序最小的规范化编号序列：
 *      - 首位：出现在某负闭途径中的最小编号断言，即环上最小编号；
 *      - 后续每位：当前结点出边中，满足 “已累权重 + c + 剩余步数内回到
 *        起点的最小权重 < 0” 的最小编号。
 *    结果天然以最小断言编号开头（沿原方向，未做反转）。编号整批唯一，
 *    故最小者唯一——平行边、自环、多环并存时结果稳定，与输入行序无关。
 *
 * 全程 O(n^3·k + k·E)：60 事件 / 240 断言的上限规模瞬时完成。
 */
import type { Assertion, NegativeCycleWitness, SolveResult } from './types';

/** min-plus 矩阵乘：C[i][j] = min_l A[i][l] + B[l][j]。 */
function minPlusMultiply(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    for (let l = 0; l < n; l++) {
      const ail = a[i][l];
      if (!Number.isFinite(ail)) continue;
      const bl = b[l];
      const ci = out[i];
      for (let j = 0; j < n; j++) {
        const blj = bl[j];
        if (!Number.isFinite(blj)) continue;
        const candidate = ail + blj;
        if (candidate < ci[j]) ci[j] = candidate;
      }
    }
  }
  return out;
}

/**
 * 在断言图上求证。断言须已通过整批校验（编号唯一等）。
 * 返回约束相容，或一个满足全部选取规则的负环见证。
 */
export function findNegativeCycle(assertions: Assertion[]): SolveResult {
  if (assertions.length === 0) return { kind: 'consistent' };

  // 事件名区分大小写：直接以字符串相等建立索引；排序仅为确定性。
  const events = [...new Set(assertions.flatMap((a) => [a.u, a.v]))].sort();
  const n = events.length;
  const indexOf = new Map(events.map((name, i) => [name, i] as const));

  // min-plus 邻接矩阵：平行边取最小权重用于最小边数判定与可行性下界。
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  for (const a of assertions) {
    const i = indexOf.get(a.u)!;
    const j = indexOf.get(a.v)!;
    if (a.c < matrix[i][j]) matrix[i][j] = a.c;
  }

  // 精确步数幂 powers[r] = M^r（恰好 r 步的最小权重）；powers[0] 为单位阵。
  // 首个使对角线出现负值的 k 即负简单环的最小边数。
  const powers: number[][][] = [
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)),
    ),
  ];
  let kMin = -1;
  let current = matrix;
  for (let k = 1; k <= n; k++) {
    if (k > 1) current = minPlusMultiply(current, matrix);
    powers.push(current);
    for (let i = 0; i < n; i++) {
      if (current[i][i] < 0) {
        kMin = k;
        break;
      }
    }
    if (kMin !== -1) break;
  }
  if (kMin === -1) return { kind: 'consistent' };

  // 出边表与全表均按编号升序，供贪心逐位取最小可行编号。
  const byId = [...assertions].sort((p, q) => p.id - q.id);
  const outgoing: Assertion[][] = Array.from({ length: n }, () => []);
  for (const a of byId) outgoing[indexOf.get(a.u)!].push(a);

  // 首位：出现在某长度为 kMin 的负闭途径中的最小编号断言。
  // 断言 e = (u -> v, c) 出现在其中 ⟺ c + (kMin-1 步从 v 回 u 的最小权重) < 0。
  let first: Assertion | null = null;
  for (const a of byId) {
    const u = indexOf.get(a.u)!;
    const v = indexOf.get(a.v)!;
    if (a.c + powers[kMin - 1][v][u] < 0) {
      first = a;
      break;
    }
  }
  if (first === null) {
    // 逻辑上不可达：kMin 已保证存在负闭途径，其上的断言都满足该判定。
    throw new Error('内部错误：已探测到负环，但找不到首条边');
  }

  // 逐位贪心：不变式为“当前前缀可补全成长度 kMin 的负闭途径（即负简单环）”。
  // 每步取当前结点出边中满足补全条件的最小编号；补全条件成立时，
  // 由矩阵幂补全出的负闭途径自动是简单环，故不会走入死路或重复事件。
  const startIdx = indexOf.get(first.u)!;
  const edges: Assertion[] = [first];
  let x = indexOf.get(first.v)!;
  let weight = first.c;
  for (let step = 2; step <= kMin; step++) {
    const remaining = kMin - step; // 走完本条边后剩余的步数
    let chosen: Assertion | null = null;
    for (const e of outgoing[x]) {
      const y = indexOf.get(e.v)!;
      if (weight + e.c + powers[remaining][y][startIdx] < 0) {
        chosen = e;
        break;
      }
    }
    if (chosen === null) {
      // 逻辑上不可达：不变式保证至少一条出边可行。
      throw new Error('内部错误：负环构造中断');
    }
    edges.push(chosen);
    weight += chosen.c;
    x = indexOf.get(chosen.v)!;
  }

  let cumulative = 0;
  const steps = edges.map((assertion) => {
    cumulative += assertion.c;
    return { assertion, cumulative };
  });
  const witness: NegativeCycleWitness = { edges, total: cumulative, steps };
  return { kind: 'negative-cycle', witness };
}
