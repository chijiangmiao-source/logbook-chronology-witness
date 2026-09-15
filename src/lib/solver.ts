/**
 * 差分约束负环求证。
 *
 * 断言 (u, v, c) 构成有向边 u -> v，权重 c。约束系统不自洽，当且仅当图中
 * 存在权重和小于零的有向环。本模块在找到负环时给出可逐步复核的见证：
 *
 * 1. 见证是权重和小于零的有向【简单】环：除闭合首尾外事件不重复，
 *    断言自然也不重复（同一断言若在环上出现两次必然重复事件）。
 * 2. 在所有负简单环中先取边数最少者：
 *    边数最少的负【闭途径】必为简单环（否则可拆成两个更短闭途径，
 *    至少一个为负，矛盾），故用 min-plus 矩阵幂逐阶检查对角线即可
 *    得到最小边数 k；此时所有长度为 k 的负闭途径都是简单环。
 * 3. 并列候选沿原方向旋转至最小编号开头（禁止反转），再按编号整数
 *    序列字典序取最小者。编号整批唯一，故最小者唯一，结果稳定，
 *    与平行边、自环、多环的存在无关。
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

/** 按整数数值比较两个编号序列的字典序。 */
export function compareIdSequences(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** 沿原方向旋转，使环以最小断言编号开头；不改变方向、不重排边。 */
export function normalizeCycleRotation(edges: Assertion[]): Assertion[] {
  let minIndex = 0;
  for (let i = 1; i < edges.length; i++) {
    if (edges[i].id < edges[minIndex].id) minIndex = i;
  }
  return [...edges.slice(minIndex), ...edges.slice(0, minIndex)];
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

  // min-plus 邻接矩阵：平行边取最小权重用于下界与最小边数判定。
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
  for (const a of assertions) {
    const i = indexOf.get(a.u)!;
    const j = indexOf.get(a.v)!;
    if (a.c < matrix[i][j]) matrix[i][j] = a.c;
  }

  // 逐阶计算精确步数幂 P_k = M^k，(P_k)[i][i] < 0 即存在长度为 k 的负闭途径。
  // 首个使对角线变负的 k 就是负简单环的最小边数。
  const powers: number[][][] = [];
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

  // 出边表：按编号升序，保证枚举顺序确定（最小值选取与枚举顺序无关）。
  const outgoing: Assertion[][] = Array.from({ length: n }, () => []);
  for (const a of assertions) outgoing[indexOf.get(a.u)!].push(a);
  for (const list of outgoing) list.sort((p, q) => p.id - q.id);

  // 用持有对象收集最优候选：属性不会被闭包赋值的控制流分析误判。
  const best: { edges: Assertion[] | null; seq: number[] | null } = { edges: null, seq: null };
  const consider = (path: Assertion[]): void => {
    const rotated = normalizeCycleRotation(path);
    const seq = rotated.map((a) => a.id);
    if (best.seq === null || compareIdSequences(seq, best.seq) < 0) {
      best.edges = rotated;
      best.seq = seq;
    }
  };

  // 枚举所有长度为 kMin、权重和为负的简单环。
  // 剪枝：powers[r-1][x][s] 是从 x 恰好 r 步回到 s 的最小权重（允许重复的
  // 途径，因而是简单路径权重的下界）；若 当前权重 + 下界 >= 0 则不可能成负环。
  const path: Assertion[] = [];
  for (let s = 0; s < n; s++) {
    const visited = new Array<boolean>(n).fill(false);
    visited[s] = true;
    const dfs = (x: number, weight: number): void => {
      const remaining = kMin - path.length;
      if (remaining === 0) {
        if (x === s && weight < 0) consider(path.slice());
        return;
      }
      const lowerBound = powers[remaining - 1][x][s];
      if (!Number.isFinite(lowerBound) || weight + lowerBound >= 0) return;
      for (const edge of outgoing[x]) {
        const y = indexOf.get(edge.v)!;
        if (y === s) {
          // 仅当这是最后一条边时才能闭合成简单环；提前回到 s 会重复事件。
          if (remaining !== 1) continue;
          path.push(edge);
          dfs(y, weight + edge.c);
          path.pop();
          continue;
        }
        if (visited[y]) continue;
        visited[y] = true;
        path.push(edge);
        dfs(y, weight + edge.c);
        path.pop();
        visited[y] = false;
      }
    };
    dfs(s, 0);
  }

  if (best.edges === null || best.seq === null) {
    // 逻辑上不可达：kMin 已保证存在负闭途径，而它必为简单环且会被枚举到。
    throw new Error('内部错误：已探测到负环，但枚举候选为空');
  }

  let cumulative = 0;
  const steps = best.edges.map((assertion) => {
    cumulative += assertion.c;
    return { assertion, cumulative };
  });
  const witness: NegativeCycleWitness = { edges: best.edges, total: cumulative, steps };
  return { kind: 'negative-cycle', witness };
}
