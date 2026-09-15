import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** 逐行录入断言；行数超过初始 3 行时先点“添加断言行”。 */
async function fillRows(page: Page, rows: [string, string, string, string][]) {
  for (let i = 0; i < rows.length; i++) {
    if (i >= 3) await page.getByTestId('add-row').click();
    await page.getByTestId(`row-${i}-id`).fill(rows[i][0]);
    await page.getByTestId(`row-${i}-u`).fill(rows[i][1]);
    await page.getByTestId(`row-${i}-v`).fill(rows[i][2]);
    await page.getByTestId(`row-${i}-c`).fill(rows[i][3]);
  }
}

test('相容结论旁显示修订预演面板；负环结论旁不显示', async ({ page }) => {
  await page.getByTestId('load-consistent').click();
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();
  await expect(page.getByTestId('tighten-panel')).toBeVisible();
  await expect(page.getByTestId('preview-run')).toBeDisabled(); // 未选断言时不可预演

  await page.getByTestId('load-negative').click();
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-cycle')).toBeVisible();
  await expect(page.getByTestId('tighten-panel')).toHaveCount(0);
});

test('安全预演：显示临界值，一键写回并清除旧结论，写回后可再次考证', async ({ page }) => {
  // #1 a→b 5；#2 b→a -2。排除 #1 后返回路径 b→a 权重 -2，临界值 2。
  await fillRows(page, [
    ['1', 'a', 'b', '5'],
    ['2', 'b', 'a', '-2'],
  ]);
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();

  await page.getByTestId('preview-target').selectOption('1');
  await page.getByTestId('preview-c').fill('2'); // 恰为临界值
  await page.getByTestId('preview-run').click();

  await expect(page.getByTestId('preview-critical')).toContainText('临界值 = 2');
  await expect(page.getByTestId('preview-critical')).toContainText('总权重 = -2');
  await expect(page.getByTestId('preview-safe')).toContainText('拟议 c = 2 安全');
  // 预演不改动录入表
  await expect(page.getByTestId('row-0-c')).toHaveValue('5');

  await page.getByTestId('preview-writeback').click();
  // 写回该行并清除旧结论
  await expect(page.getByTestId('row-0-c')).toHaveValue('2');
  await expect(page.getByTestId('result-consistent')).toHaveCount(0);
  await expect(page.getByTestId('tighten-panel')).toHaveCount(0);

  // 写回后的再次考证：2 + (-2) = 0，仍相容
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();
});

test('临界值前一单位越界：展示逐步累计矛盾链且禁止写回', async ({ page }) => {
  // 同上：临界值 2，拟议 c = 1（临界值前一单位）越界。
  await fillRows(page, [
    ['1', 'a', 'b', '5'],
    ['2', 'b', 'a', '-2'],
  ]);
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();

  await page.getByTestId('preview-target').selectOption('1');
  await page.getByTestId('preview-c').fill('1');
  await page.getByTestId('preview-run').click();

  await expect(page.getByTestId('preview-critical')).toContainText('临界值 = 2');
  await expect(page.getByTestId('preview-unsafe')).toContainText('拟议 c = 1 越界');

  // 矛盾链 = 拟议断言 + 返回路径，逐步累计。
  await expect(page.getByTestId('preview-step-0')).toContainText('断言 #1（拟议）');
  await expect(page.getByTestId('preview-step-0')).toContainText('date(b) − date(a) ≤ 1');
  await expect(page.getByTestId('preview-step-0-sum')).toHaveText('累计和 = 1');
  await expect(page.getByTestId('preview-step-1')).toContainText('断言 #2');
  await expect(page.getByTestId('preview-step-1')).toContainText('date(a) − date(b) ≤ -2');
  await expect(page.getByTestId('preview-step-1-sum')).toHaveText('累计和 = -1');
  await expect(page.getByTestId('preview-step-2')).toHaveCount(0);
  await expect(page.getByTestId('preview-total')).toContainText('累计总和 = -1');
  await expect(page.getByTestId('preview-total')).toContainText('总和小于零');

  // 禁止写回；录入表保持原值。
  await expect(page.getByTestId('preview-writeback')).toHaveCount(0);
  await expect(page.getByTestId('row-0-c')).toHaveValue('5');
});

test('平行边与零权回路：返回路径按总权重、边数、编号序列取舍', async ({ page }) => {
  // #1 a→b 2（目标）。返回路径（b→…→a）候选：
  //   [#4] 权重 -1（1 边）；[#7] 与 #4 平行同权重（编号更大）；
  //   [#2,#3] 权重 -1（2 边）；绕零权回路 [#2,#5,#6,#3] 权重 -1（4 边）。
  // 临界值 1，证明链取 [#4]。
  await fillRows(page, [
    ['1', 'a', 'b', '2'],
    ['2', 'b', 'c', '1'],
    ['3', 'c', 'a', '-2'],
    ['4', 'b', 'a', '-1'],
    ['5', 'c', 'd', '0'],
    ['6', 'd', 'c', '0'],
    ['7', 'b', 'a', '-1'],
  ]);
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();

  // 临界值处（c = 1）安全，可写回。
  await page.getByTestId('preview-target').selectOption('1');
  await page.getByTestId('preview-c').fill('1');
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-critical')).toContainText('临界值 = 1');
  await expect(page.getByTestId('preview-safe')).toBeVisible();

  // 临界值前一单位（c = 0）越界：矛盾链仅 [#1(拟议), #4] 两步。
  await page.getByTestId('preview-c').fill('0');
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-unsafe')).toBeVisible();
  await expect(page.getByTestId('preview-step-0')).toContainText('断言 #1（拟议）');
  await expect(page.getByTestId('preview-step-0-sum')).toHaveText('累计和 = 0');
  await expect(page.getByTestId('preview-step-1')).toContainText('断言 #4');
  await expect(page.getByTestId('preview-step-1')).toContainText('date(a) − date(b) ≤ -1');
  await expect(page.getByTestId('preview-step-1-sum')).toHaveText('累计和 = -1');
  await expect(page.getByTestId('preview-step-2')).toHaveCount(0);
  await expect(page.getByTestId('preview-total')).toContainText('累计总和 = -1');
  await expect(page.getByTestId('preview-writeback')).toHaveCount(0);
});

test('无返回路径：标为无有限临界值，任意收紧安全并可写回', async ({ page }) => {
  // 排除 #1 后 b 无法回到 a（#2 在无关分量上）。
  await fillRows(page, [
    ['1', 'a', 'b', '5'],
    ['2', 'c', 'd', '1'],
  ]);
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();

  await page.getByTestId('preview-target').selectOption('1');
  await page.getByTestId('preview-c').fill('-100000'); // 收紧到合法范围下限
  await page.getByTestId('preview-run').click();

  await expect(page.getByTestId('preview-critical')).toContainText('无有限临界值');
  await expect(page.getByTestId('preview-safe')).toContainText('拟议 c = -100000 安全');

  await page.getByTestId('preview-writeback').click();
  await expect(page.getByTestId('row-0-c')).toHaveValue('-100000');

  // 写回后的再次考证：b 与 a 不连通，仍相容。
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();
});

test('录入变化立即作废预演并就地反馈', async ({ page }) => {
  await fillRows(page, [
    ['1', 'a', 'b', '5'],
    ['2', 'b', 'a', '-2'],
  ]);
  await page.getByTestId('compute-button').click();
  await page.getByTestId('preview-target').selectOption('1');
  await page.getByTestId('preview-c').fill('2');
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-result')).toBeVisible();

  // 修改任一录入字段：预演结果立即消失，就地给作废反馈。
  await page.getByTestId('row-1-c').fill('-3');
  await expect(page.getByTestId('preview-result')).toHaveCount(0);
  await expect(page.getByTestId('tighten-panel')).toHaveCount(0); // 旧结论一并作废
  await expect(page.getByTestId('preview-stale')).toBeVisible();
  await expect(page.getByTestId('preview-stale')).toContainText('已作废');

  // 重新考证后作废提示消失，可重新预演。
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();
  await expect(page.getByTestId('preview-stale')).toHaveCount(0);
  await expect(page.getByTestId('tighten-panel')).toBeVisible();
});

test('删除目标行立即作废预演并就地反馈', async ({ page }) => {
  await fillRows(page, [
    ['1', 'a', 'b', '5'],
    ['2', 'b', 'a', '-2'],
  ]);
  await page.getByTestId('compute-button').click();
  await page.getByTestId('preview-target').selectOption('1');
  await page.getByTestId('preview-c').fill('2');
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-result')).toBeVisible();

  await page.getByTestId('row-0-remove').click(); // 删除目标断言 #1 所在行
  await expect(page.getByTestId('preview-result')).toHaveCount(0);
  await expect(page.getByTestId('preview-stale')).toBeVisible();
  await expect(page.getByTestId('preview-stale')).toContainText('已被删除');
});

test('预演输入须为范围内且不大于原值的整数', async ({ page }) => {
  await fillRows(page, [
    ['1', 'a', 'b', '5'],
    ['2', 'b', 'a', '-2'],
  ]);
  await page.getByTestId('compute-button').click();
  await page.getByTestId('preview-target').selectOption('1');

  await page.getByTestId('preview-c').fill('7'); // 大于原值 5
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-error')).toContainText('不大于原值 5');
  await expect(page.getByTestId('preview-result')).toHaveCount(0);

  await page.getByTestId('preview-c').fill('-100001'); // 超出合法范围
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-error')).toContainText('-100000 至 100000');

  await page.getByTestId('preview-c').fill('1.5'); // 非整数
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-error')).toContainText('整数');

  // 修正为合法值后正常预演。
  await page.getByTestId('preview-c').fill('3');
  await page.getByTestId('preview-run').click();
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  await expect(page.getByTestId('preview-result')).toBeVisible();
  await expect(page.getByTestId('preview-safe')).toContainText('拟议 c = 3 安全');
});
