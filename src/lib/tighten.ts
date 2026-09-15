/**
 * 单条断言收紧的修订预演分析。
 *
 * 前置条件（由调用方保证）：assertions 已通过整批校验且当前相容
 * （findNegativeCycle 判为 consistent），targetId 是其中某条断言的编号，
 * proposedC 为拟议的新上界（整数，不大于原值）。
 *
 * 语义：把目标断言 e = (u, v, c) 的上界收紧为 c'。修订后若产生负环，
 * 该负环必含拟议边 e'（其余断言原本相容），环的其余部分恰是「排除 e 后
 * 从结束事件 v 回到起始事件 u 的路径」。设该路径的最小权重为 d，则
 * 含 e' 的任一闭途径权重 = c' +（某条 v→u 路径权重）≥ c' + d，于是：
 *
 * - c' ≥ -d ⟺ 修订后仍相容（临界值安全侧，含等号：和为零不成负环）；
 * - c' <  -d ⟺ 产生负环（e' 与最小权重返回路径即拼成一条）。
 *
 * 故临界值 critical = -d。若排除 e 后 v 根本无法回到 u，则任何含 e' 的
 * 环都不存在，无论如何收紧都不会闭环——无有限临界值（critical = null）。
 *
 * 证明链唯一性：最小权重返回路径若有多条，依次按
 *   1. 总权重最小；
 *   2. 边数最少（故必为简单路径——含环则环权重 ≥ 0，去环后权重不增、
 *      边数更少，与前两个关键字矛盾；零权回路因此被排除）；
 *   3. 编号整数序列字典序最小（编号整批唯一，故最小者唯一）。
 * 逐步贪心的可行性预言机是精确的：dist[r][x] 记录「从 x 恰好 r 步到达
 * 终点」的最小权重，接上出边 e = x→y 后仍能完成最优路径，当且仅当
 * 已累计权重 + e.c + dist[r-1][y] === d（等号成立即存在最优完成途径）。
 * 结果与输入行序无关，可重复复核。
 */
import type { Assertion } from './types';

/** 排除被修订边后，结束事件回到起始事件的最小权重路径。 */
export interface ReturnPath {
  /** 路径总权重（最小值），临界值即其相反数。 */
  total: number;
  /** 路径上的断言，按行进顺序；空数组表示目标为自环（零条边，权重 0）。 */
  edges: Assertion[];
}

/** 矛盾链上的一步：拟议断言开头，随后沿返回路径逐步累计。 */
export interface ContradictionStep {
  assertion: Assertion;
  /** 从拟议断言起累加到本步（含）的 c 值之和。 */
  cumulative: number;
}

export interface TightenAnalysis {
  /** 被修订的断言（原值）。 */
  target: Assertion;
  /** 拟议的新上界。 */
  proposedC: number;
  /**
   * 临界值：proposedC ≥ critical 时修订后仍相容，proposedC < critical 时
   * 产生负环。null 表示无有限临界值（结束事件无法回到起始事件，
   * 任意收紧均安全）。
   */
  critical: number | null;
  /** 最小权重返回路径；null 表示不存在（此时 critical 亦为 null）。 */
  returnPath: ReturnPath | null;
  /** 拟议是否安全（无有限临界值时恒为 true）。 */
  safe: boolean;
  /** 越界时的矛盾链（拟议断言 + 返回路径，逐步累计）；安全时为 null。 */
  contradiction: { steps: ContradictionStep[]; total: number } | null;
}

/**
 * 对单条断言的收紧做修订预演。不修改 assertions；返回完整分析结果。
 */
export function analyzeTightening(
  assertions: Assertion[],
  targetId: number,
  proposedC: number,
): TightenAnalysis {
  const target = assertions.find((a) => a.id === targetId);
  if (target === undefined) {
    throw new Error(`修订预演失败：断言 #${targetId} 不存在`);
  }
  // 排除被修订边：编号整批唯一，恰排除目标一条；平行边照常保留。
  const rest = assertions.filter((a) => a.id !== targetId);

  // 事件名区分大小写，按字符串相等建索引；排序仅为确定性。
  // 索引基于全部断言（含目标），保证目标的两个端点必在列。
  const events = [...new Set(assertions.flatMap((a) => [a.u, a.v]))].sort();
  const n = events.length;
  const indexOf = new Map(events.map((name, i) => [name, i] as const));
  const source = indexOf.get(target.v)!; // 返回路径起点：目标边的结束事件
  const sink = indexOf.get(target.u)!; // 返回路径终点：目标边的起始事件

  // dist[r][x] = 排除被修订边后，从 x 恰好 r 步到达 sink 的最小权重。
  // 反向 Bellman-Ford：dist[0][sink] = 0，
  // dist[r][x] = min_{x→y} (c + dist[r-1][y])。
  // 前提原批次相容（无负环），最小权重路径必可取为简单路径，边数 ≤ n-1。
  const dist: number[][] = [];
  const init = new Array<number>(n).fill(Infinity);
  init[sink] = 0;
  dist.push(init);
  for (let r = 1; r <= n - 1; r++) {
    const prev = dist[r - 1];
    const cur = new Array<number>(n).fill(Infinity);
    for (const a of rest) {
      const x = indexOf.get(a.u)!;
      const y = indexOf.get(a.v)!;
      const candidate = a.c + prev[y];
      if (candidate < cur[x]) cur[x] = candidate;
    }
    dist.push(cur);
  }

  // 第一、二关键字：总权重最小、边数最少。按 r 升序扫描、严格小于才更新，
  // 故同权重时保留最小边数。
  let bestWeight = Infinity;
  let bestLen = -1;
  for (let r = 0; r <= n - 1; r++) {
    if (dist[r][source] < bestWeight) {
      bestWeight = dist[r][source];
      bestLen = r;
    }
  }

  if (!Number.isFinite(bestWeight)) {
    // 结束事件无法回到起始事件：任何含拟议边的环都不存在，任意收紧均安全。
    return {
      target,
      proposedC,
      critical: null,
      returnPath: null,
      safe: true,
      contradiction: null,
    };
  }

  // 归一化 -0：权重和为 0 时临界值应为 +0，避免展示与比较时出现 -0。
  const critical = bestWeight === 0 ? 0 : -bestWeight;
  const safe = proposedC >= critical;

  // 第三关键字：编号序列字典序最小。出边按编号升序，逐步贪心——当前在
  // x、已累计 acc、还剩 r 步时，出边 e = x→y 可行当且仅当
  // acc + e.c + dist[r-1][y] === bestWeight。所有（最小权重、最少边数）
  // 路径都是简单路径，预言机自动避开重复事件（含绕零权回路）。
  const outgoing: Assertion[][] = Array.from({ length: n }, () => []);
  for (const a of rest) outgoing[indexOf.get(a.u)!].push(a);
  for (const list of outgoing) list.sort((p, q) => p.id - q.id);

  const edges: Assertion[] = [];
  let x = source;
  let acc = 0;
  for (let r = bestLen; r >= 1; r--) {
    let chosen: Assertion | null = null;
    for (const e of outgoing[x]) {
      const y = indexOf.get(e.v)!;
      if (acc + e.c + dist[r - 1][y] === bestWeight) {
        chosen = e;
        break;
      }
    }
    if (chosen === null) {
      // 逻辑上不可达：bestLen 的定义已保证存在完整最优路径。
      throw new Error('内部错误：返回路径构造中途丢失可行后继');
    }
    edges.push(chosen);
    acc += chosen.c;
    x = indexOf.get(chosen.v)!;
  }

  const returnPath: ReturnPath = { total: bestWeight, edges };

  let contradiction: TightenAnalysis['contradiction'] = null;
  if (!safe) {
    // 矛盾链 = 拟议断言（沿用原编号、c 取拟议值）+ 最小权重返回路径。
    const proposed: Assertion = { ...target, c: proposedC };
    const steps: ContradictionStep[] = [{ assertion: proposed, cumulative: proposedC }];
    let cumulative = proposedC;
    for (const e of edges) {
      cumulative += e.c;
      steps.push({ assertion: e, cumulative });
    }
    contradiction = { steps, total: cumulative };
  }

  return { target, proposedC, critical, returnPath, safe, contradiction };
}
