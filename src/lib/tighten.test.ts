import { describe, expect, it } from 'vitest';
import { findNegativeCycle } from './solver';
import { analyzeTightening } from './tighten';
import type { Assertion } from './types';

const A = (id: number, u: string, v: string, c: number): Assertion => ({ id, u, v, c, row: id });

/** 把 assertions 中编号为 targetId 的断言的 c 替换为 newC（其余原样）。 */
const revisedWith = (assertions: Assertion[], targetId: number, newC: number): Assertion[] =>
  assertions.map((a) => (a.id === targetId ? { ...a, c: newC } : a));

describe('修订预演：临界值与返回路径', () => {
  it('三角批次：临界值 = 返回路径最小权重取负', () => {
    // #1 靠港→补给 3（目标）；返回路径 补给→离港→靠港：2 + (-5) = -3，临界值 3。
    const assertions = [A(1, '靠港', '补给', 3), A(2, '补给', '离港', 2), A(3, '离港', '靠港', -5)];
    const analysis = analyzeTightening(assertions, 1, 3);
    expect(analysis.critical).toBe(3);
    expect(analysis.returnPath?.total).toBe(-3);
    expect(analysis.returnPath?.edges.map((e) => e.id)).toEqual([2, 3]);
    expect(analysis.safe).toBe(true);
    expect(analysis.contradiction).toBeNull();
  });

  it('临界值前后各一单位：相容性判断与负环求证一致', () => {
    // #1 a→b 5（目标）；#2 b→a -2。返回路径权重 -2，临界值 2。
    const assertions = [A(1, 'a', 'b', 5), A(2, 'b', 'a', -2)];

    // 临界值处（c = 2）：安全，负环求证判相容（2 + (-2) = 0）。
    const at = analyzeTightening(assertions, 1, 2);
    expect(at.critical).toBe(2);
    expect(at.safe).toBe(true);
    expect(at.contradiction).toBeNull();
    expect(findNegativeCycle(revisedWith(assertions, 1, 2)).kind).toBe('consistent');

    // 临界值前一单位（c = 1）：越界，负环求证判不自洽（1 + (-2) = -1）。
    const below = analyzeTightening(assertions, 1, 1);
    expect(below.safe).toBe(false);
    expect(below.contradiction?.total).toBe(-1);
    expect(findNegativeCycle(revisedWith(assertions, 1, 1)).kind).toBe('negative-cycle');
  });

  it('平行边：权重不同取权重最小者，权重相同取编号最小者，与行序无关', () => {
    // 目标 #1 a→b；返回路径候选 #2 (b→a, -3) 与 #3 (b→a, -2)：取权重小的 #2。
    const p1 = analyzeTightening([A(1, 'a', 'b', 0), A(2, 'b', 'a', -3), A(3, 'b', 'a', -2)], 1, 0);
    expect(p1.critical).toBe(3);
    expect(p1.returnPath?.edges.map((e) => e.id)).toEqual([2]);

    // 同权重平行边 #2/#3 均 -3：取编号小的 #2。
    const p2 = analyzeTightening([A(1, 'a', 'b', 0), A(2, 'b', 'a', -3), A(3, 'b', 'a', -3)], 1, 0);
    expect(p2.returnPath?.edges.map((e) => e.id)).toEqual([2]);

    // 输入行序打乱，结果不变。
    const p3 = analyzeTightening([A(3, 'b', 'a', -3), A(1, 'a', 'b', 0), A(2, 'b', 'a', -3)], 1, 0);
    expect(p3).toEqual(p2);
  });

  it('零权回路：边数关键字排除绕环路径', () => {
    // 目标 #1 a→b。返回路径：#2 b→c 1 + #3 c→a -2（权重 -1，2 边）；
    // 绕零权回路 #4 c→d 0 + #5 d→c 0 得 b→c→d→c→a（权重同为 -1，4 边）——不取。
    const assertions = [
      A(1, 'a', 'b', 0),
      A(2, 'b', 'c', 1),
      A(3, 'c', 'a', -2),
      A(4, 'c', 'd', 0),
      A(5, 'd', 'c', 0),
    ];
    const analysis = analyzeTightening(assertions, 1, 0);
    expect(analysis.critical).toBe(1);
    expect(analysis.returnPath?.edges.map((e) => e.id)).toEqual([2, 3]);
  });

  it('总权重相同、边数不同时取边数最少者', () => {
    // #2 b→a -1（1 边）与 #3 b→c 0 + #4 c→a -1（2 边）权重同为 -1：取 [#2]。
    const analysis = analyzeTightening(
      [A(1, 'a', 'b', 0), A(2, 'b', 'a', -1), A(3, 'b', 'c', 0), A(4, 'c', 'a', -1)],
      1,
      0,
    );
    expect(analysis.critical).toBe(1);
    expect(analysis.returnPath?.edges.map((e) => e.id)).toEqual([2]);
  });

  it('总权重与边数均相同时按编号序列字典序取最小', () => {
    // 路径 [5,6] 与 [4,7]：权重均 -1、边数均 2；[4,7] 字典序更小。
    const analysis = analyzeTightening(
      [A(1, 'a', 'b', 0), A(5, 'b', 'c', 0), A(6, 'c', 'a', -1), A(4, 'b', 'd', 0), A(7, 'd', 'a', -1)],
      1,
      0,
    );
    expect(analysis.returnPath?.edges.map((e) => e.id)).toEqual([4, 7]);
  });

  it('无返回路径：无有限临界值，任意收紧均安全', () => {
    // 排除 #1 后 b 无法回到 a（#2 在无关分量上）。
    const assertions = [A(1, 'a', 'b', 5), A(2, 'c', 'd', -3)];
    const analysis = analyzeTightening(assertions, 1, -100000);
    expect(analysis.critical).toBeNull();
    expect(analysis.returnPath).toBeNull();
    expect(analysis.safe).toBe(true);
    expect(analysis.contradiction).toBeNull();
    // 任意小的拟议值仍与负环求证一致：相容。
    expect(findNegativeCycle(revisedWith(assertions, 1, -1_000_000_000)).kind).toBe('consistent');
  });

  it('目标为自环：零边返回路径，临界值 0', () => {
    const assertions = [A(1, 'a', 'a', 3), A(2, 'b', 'c', 1)];
    const analysis = analyzeTightening(assertions, 1, 0);
    expect(analysis.critical).toBe(0);
    expect(analysis.returnPath?.total).toBe(0);
    expect(analysis.returnPath?.edges).toEqual([]);
    expect(analysis.safe).toBe(true);

    // c = -1（临界值前一单位）：负自环，矛盾链仅拟议断言一步。
    const below = analyzeTightening(assertions, 1, -1);
    expect(below.safe).toBe(false);
    expect(below.contradiction?.steps).toHaveLength(1);
    expect(below.contradiction?.steps[0].assertion.id).toBe(1);
    expect(below.contradiction?.steps[0].assertion.c).toBe(-1);
    expect(below.contradiction?.total).toBe(-1);
    expect(findNegativeCycle(revisedWith(assertions, 1, -1)).kind).toBe('negative-cycle');
  });

  it('矛盾链：拟议断言开头、逐步累计、总和为负', () => {
    const assertions = [A(1, '靠港', '补给', 3), A(2, '补给', '离港', 2), A(3, '离港', '靠港', -5)];
    // 临界值 3，拟议 1 越界：链 = #1(拟议 1) → #2(2) → #3(-5)，累计 1, 3, -2。
    const analysis = analyzeTightening(assertions, 1, 1);
    expect(analysis.safe).toBe(false);
    const chain = analysis.contradiction!;
    expect(chain.steps.map((s) => s.assertion.id)).toEqual([1, 2, 3]);
    expect(chain.steps[0].assertion.c).toBe(1); // 拟议值，非原值 3
    expect(chain.steps.map((s) => s.cumulative)).toEqual([1, 3, -2]);
    expect(chain.total).toBe(-2);
    // 链式相接：拟议断言 u→v，随后 v → … → u。
    expect(chain.steps[0].assertion.v).toBe(chain.steps[1].assertion.u);
    expect(chain.steps[2].assertion.v).toBe(chain.steps[0].assertion.u);
  });

  it('确定性：与输入行序无关', () => {
    const base = [
      A(1, 'a', 'b', 0),
      A(2, 'b', 'c', 1),
      A(3, 'c', 'a', -2),
      A(4, 'c', 'd', 0),
      A(5, 'd', 'c', 0),
    ];
    const shuffled = [base[3], base[1], base[4], base[0], base[2]];
    expect(analyzeTightening(shuffled, 1, -5)).toEqual(analyzeTightening(base, 1, -5));
  });

  it('目标断言不存在时抛错', () => {
    expect(() => analyzeTightening([A(1, 'a', 'b', 0)], 99, 0)).toThrow('断言 #99 不存在');
  });

  it('上限规模（60 事件 / 120 断言）预演即时完成', () => {
    // 60 环 + 60 条平行边；目标 #1（e0→e1, c=5）。
    // 排除 #1 后唯一返回路径：#2…#60（59 条零权边），临界值 0。
    const assertions: Assertion[] = [];
    for (let i = 0; i < 60; i++) {
      assertions.push(A(i + 1, `e${i}`, `e${(i + 1) % 60}`, i === 0 ? 5 : 0));
    }
    for (let i = 0; i < 60; i++) {
      assertions.push(A(61 + i, `e${i}`, `e${(i + 1) % 60}`, 7));
    }
    const t0 = performance.now();
    const analysis = analyzeTightening(assertions, 1, 0);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(analysis.critical).toBe(0);
    expect(analysis.returnPath?.edges.map((e) => e.id)).toEqual(
      Array.from({ length: 59 }, (_, i) => i + 2),
    );
    expect(analysis.safe).toBe(true);
  });
});

/**
 * 参考实现：暴力枚举排除目标边后 v→u 的全部简单路径，
 * 按（总权重, 边数, 编号序列字典序）取最小者，用于随机对照。
 */
function referenceReturnPath(
  assertions: Assertion[],
  targetId: number,
): { total: number; ids: number[] } | null {
  const target = assertions.find((a) => a.id === targetId)!;
  const rest = assertions.filter((a) => a.id !== targetId);
  const out = new Map<string, Assertion[]>();
  for (const a of rest) {
    const list = out.get(a.u) ?? [];
    list.push(a);
    out.set(a.u, list);
  }
  const paths: Assertion[][] = [];
  const path: Assertion[] = [];
  const visited = new Set<string>([target.v]);
  const dfs = (x: string): void => {
    if (x === target.u) {
      paths.push([...path]);
      return;
    }
    for (const e of out.get(x) ?? []) {
      if (visited.has(e.v)) continue;
      visited.add(e.v);
      path.push(e);
      dfs(e.v);
      path.pop();
      visited.delete(e.v);
    }
  };
  dfs(target.v);
  if (paths.length === 0) return null;
  const scored = paths.map((p) => ({ weight: p.reduce((s, e) => s + e.c, 0), ids: p.map((e) => e.id) }));
  scored.sort((a, b) => {
    if (a.weight !== b.weight) return a.weight - b.weight;
    if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
    const n = Math.min(a.ids.length, b.ids.length);
    for (let i = 0; i < n; i++) {
      if (a.ids[i] !== b.ids[i]) return a.ids[i] - b.ids[i];
    }
    return a.ids.length - b.ids.length;
  });
  return { total: scored[0].weight, ids: scored[0].ids };
}

describe('随机相容批次对照（平行边、自环、零权回路并存）', () => {
  it('安全判定、临界值两侧与返回路径均和负环求证 / 暴力参考一致', () => {
    let seed = 20260915;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let tested = 0;
    for (let attempt = 0; attempt < 5000 && tested < 200; attempt++) {
      const n = 1 + Math.floor(rand() * 7);
      const m = 1 + Math.floor(rand() * 12);
      const assertions: Assertion[] = [];
      for (let i = 0; i < m; i++) {
        const u = Math.floor(rand() * n);
        const v = Math.floor(rand() * n);
        const c = Math.floor(rand() * 21) - 5; // [-5, 15]，相容批次占比高
        assertions.push(A(i + 1, `e${u}`, `e${v}`, c));
      }
      // 预演前提：原批次相容；不相容的样本跳过。
      if (findNegativeCycle(assertions).kind !== 'consistent') continue;
      tested++;

      const target = assertions[Math.floor(rand() * assertions.length)];
      const proposedC = target.c - Math.floor(rand() * 8); // 不大于原值
      const analysis = analyzeTightening(assertions, target.id, proposedC);

      // 返回路径与暴力参考一致（总权重 → 边数 → 编号序列）。
      const ref = referenceReturnPath(assertions, target.id);
      if (ref === null) {
        expect(analysis.critical).toBeNull();
        expect(analysis.returnPath).toBeNull();
        expect(analysis.safe).toBe(true);
        // 无有限临界值：任意极小拟议值仍相容。
        expect(findNegativeCycle(revisedWith(assertions, target.id, -1_000_000_000)).kind).toBe(
          'consistent',
        );
      } else {
        const expectedCritical = ref.total === 0 ? 0 : -ref.total; // 归一化 -0
        expect(analysis.critical).toBe(expectedCritical);
        expect(analysis.returnPath?.total).toBe(ref.total);
        expect(analysis.returnPath?.edges.map((e) => e.id)).toEqual(ref.ids);
        expect(analysis.safe).toBe(proposedC >= expectedCritical);
        // 临界值两侧各一单位，与负环求证一致。
        expect(findNegativeCycle(revisedWith(assertions, target.id, -ref.total)).kind).toBe(
          'consistent',
        );
        expect(findNegativeCycle(revisedWith(assertions, target.id, -ref.total - 1)).kind).toBe(
          'negative-cycle',
        );
      }

      // 安全判定与负环求证一致。
      const expectConsistent = analysis.safe;
      expect(findNegativeCycle(revisedWith(assertions, target.id, proposedC)).kind === 'consistent').toBe(
        expectConsistent,
      );

      // 越界时矛盾链结构自检。
      if (!analysis.safe) {
        const chain = analysis.contradiction!;
        expect(chain.steps[0].assertion.id).toBe(target.id);
        expect(chain.steps[0].assertion.c).toBe(proposedC);
        expect(chain.steps[0].cumulative).toBe(proposedC);
        for (let i = 1; i < chain.steps.length; i++) {
          expect(chain.steps[i].cumulative).toBe(
            chain.steps[i - 1].cumulative + chain.steps[i].assertion.c,
          );
          expect(chain.steps[i].assertion.u).toBe(chain.steps[i - 1].assertion.v);
        }
        expect(chain.steps[chain.steps.length - 1].assertion.v).toBe(target.u);
        expect(chain.total).toBe(chain.steps[chain.steps.length - 1].cumulative);
        expect(chain.total).toBeLessThan(0);
      } else {
        expect(analysis.contradiction).toBeNull();
      }
    }
    expect(tested).toBe(200);
  });
});
