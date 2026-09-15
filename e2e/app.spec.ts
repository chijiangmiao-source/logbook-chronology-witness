import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('首页展示录入表单与规则说明', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '航海日志差分约束负环考证' })).toBeVisible();
  await expect(page.getByTestId('row-0-id')).toBeVisible();
  await expect(page.getByTestId('compute-button')).toBeVisible();
});

test('录入负环批次并按环序展示不等式、累计和与总和小于零结论', async ({ page }) => {
  await page.getByTestId('load-negative').click();
  await page.getByTestId('compute-button').click();

  await expect(page.getByTestId('result-cycle')).toBeVisible();
  await expect(page.getByTestId('cycle-meta')).toContainText('3 条边');
  await expect(page.getByTestId('cycle-meta')).toContainText('[2, 5, 7]');

  // 环序（已旋转至最小编号开头）：#2 补给→离港，#5 离港→靠港，#7 靠港→补给。
  await expect(page.getByTestId('cycle-step-0')).toContainText('断言 #2');
  await expect(page.getByTestId('cycle-step-0')).toContainText('date(离港) − date(补给) ≤ 2');
  await expect(page.getByTestId('cycle-step-0-sum')).toHaveText('累计和 = 2');

  await expect(page.getByTestId('cycle-step-1')).toContainText('断言 #5');
  await expect(page.getByTestId('cycle-step-1')).toContainText('date(靠港) − date(离港) ≤ -6');
  await expect(page.getByTestId('cycle-step-1-sum')).toHaveText('累计和 = -4');

  await expect(page.getByTestId('cycle-step-2')).toContainText('断言 #7');
  await expect(page.getByTestId('cycle-step-2')).toContainText('date(补给) − date(靠港) ≤ 3');
  await expect(page.getByTestId('cycle-step-2-sum')).toHaveText('累计和 = -1');

  await expect(page.getByTestId('cycle-total')).toContainText('累计总和 = -1');
  await expect(page.getByTestId('cycle-total')).toContainText('总和小于零');
});

test('相容批次只显示约束相容，不出现矛盾链', async ({ page }) => {
  await page.getByTestId('load-consistent').click();
  await page.getByTestId('compute-button').click();

  await expect(page.getByTestId('result-consistent')).toBeVisible();
  await expect(page.getByTestId('result-consistent')).toContainText('约束相容');
  await expect(page.getByTestId('result-cycle')).toHaveCount(0);
});

test('手工逐行录入自环负环', async ({ page }) => {
  await page.getByTestId('row-0-id').fill('1');
  await page.getByTestId('row-0-u').fill('靠港');
  await page.getByTestId('row-0-v').fill('靠港');
  await page.getByTestId('row-0-c').fill('-1');
  await page.getByTestId('compute-button').click();

  await expect(page.getByTestId('result-cycle')).toBeVisible();
  await expect(page.getByTestId('cycle-step-0')).toContainText('date(靠港) − date(靠港) ≤ -1');
  await expect(page.getByTestId('cycle-total')).toContainText('总和小于零');
});

test('非法编号就地标错并阻止计算', async ({ page }) => {
  await page.getByTestId('row-0-id').fill('0'); // 违反 [1-9][0-9]{0,5}
  await page.getByTestId('row-0-u').fill('靠港');
  await page.getByTestId('row-0-v').fill('补给');
  await page.getByTestId('row-0-c').fill('3');

  await expect(page.getByTestId('row-0-id-error')).toBeVisible();
  await expect(page.getByTestId('compute-button')).toBeDisabled();
  await expect(page.getByTestId('compute-blocked')).toBeVisible();

  // 修正后放行。
  await page.getByTestId('row-0-id').fill('10');
  await expect(page.getByTestId('row-0-id-error')).toHaveCount(0);
  await expect(page.getByTestId('compute-button')).toBeEnabled();
});

test('编号重复时两行均被就地标错', async ({ page }) => {
  await page.getByTestId('row-0-id').fill('7');
  await page.getByTestId('row-0-u').fill('a');
  await page.getByTestId('row-0-v').fill('b');
  await page.getByTestId('row-0-c').fill('0');
  await page.getByTestId('row-1-id').fill('7');
  await page.getByTestId('row-1-u').fill('b');
  await page.getByTestId('row-1-v').fill('a');
  await page.getByTestId('row-1-c').fill('0');

  await expect(page.getByTestId('row-0-id-error')).toContainText('重复');
  await expect(page.getByTestId('row-1-id-error')).toContainText('重复');
  await expect(page.getByTestId('batch-errors')).toContainText('断言编号 7 重复出现于第 1、2 行');
  await expect(page.getByTestId('compute-button')).toBeDisabled();
});

test('c 越界就地标错', async ({ page }) => {
  await page.getByTestId('row-0-id').fill('1');
  await page.getByTestId('row-0-u').fill('a');
  await page.getByTestId('row-0-v').fill('b');
  await page.getByTestId('row-0-c').fill('100001');
  await expect(page.getByTestId('row-0-c-error')).toContainText('-100000 至 100000');
  await expect(page.getByTestId('compute-button')).toBeDisabled();
});

test('部分填写的行视为非法行并阻止计算', async ({ page }) => {
  await page.getByTestId('row-0-id').fill('1');
  await page.getByTestId('row-0-u').fill('a');
  await page.getByTestId('row-0-v').fill('b');
  await page.getByTestId('row-0-c').fill('0');
  await page.getByTestId('row-1-id').fill('2'); // 其余字段留空

  await expect(page.getByTestId('row-1-u-error')).toBeVisible();
  await expect(page.getByTestId('compute-button')).toBeDisabled();
});

test('输入变化后旧结论被清除', async ({ page }) => {
  await page.getByTestId('load-negative').click();
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-cycle')).toBeVisible();

  await page.getByTestId('row-0-c').fill('100'); // 修改后负环消失
  await expect(page.getByTestId('result-cycle')).toHaveCount(0);
  await page.getByTestId('compute-button').click();
  await expect(page.getByTestId('result-consistent')).toBeVisible();
});
