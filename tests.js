const assert = require('assert');
const Engine = require('./engine.js');

function makeState(overrides = {}) {
  return {
    settings: {
      startDate: '2027-11-07',
      cycleDays: 26,
      cycleSalary: 8500,
      lagDays: 7,
      ...(overrides.settings || {})
    },
    restDates: overrides.restDates || [],
    payments: overrides.payments || []
  };
}

// 1. 本地日期解析与加减测试（无时区偏差）
assert.strictEqual(Engine.addDays('2027-11-07', 32), '2027-12-09');
assert.strictEqual(Engine.diffCalendarDays('2027-11-07', '2027-12-10'), 33);

// 2. 需求文档中的核心例子：2027-11-07 上户，11月21日休息一天，12月10日累计满33天首次发薪
{
  const state = makeState({
    restDates: [{ date: '2027-11-21', note: '休息' }]
  });
  const dash = Engine.calculateDashboard(state, '2027-12-10');
  assert.strictEqual(dash.workDays, 33, '11/7 到 12/10 扣除 11/21 休息日应为 33 个工作日');
  assert.strictEqual(dash.restDays, 1);
  assert.strictEqual(dash.nextPayDate, '2027-12-10', '首次发薪日应为 2027-12-10');
  assert.strictEqual(dash.remainingWorkdaysToNextPay, 0);
  assert.strictEqual(dash.nextPayAmount, 8500);
}

// 3. 如果后续再休息一天（如 12月15日休息），第2期发薪日自动向后顺延一天
{
  const stateNoExtraRest = makeState({
    restDates: [{ date: '2027-11-21' }],
    payments: [{ cycleIndex: 1, paid: true, actualDate: '2027-12-10', actualAmount: 8500 }]
  });
  const dash1 = Engine.calculateDashboard(stateNoExtraRest, '2027-12-11');

  const stateWithExtraRest = makeState({
    restDates: [{ date: '2027-11-21' }, { date: '2027-12-15' }],
    payments: [{ cycleIndex: 1, paid: true, actualDate: '2027-12-10', actualAmount: 8500 }]
  });
  const dash2 = Engine.calculateDashboard(stateWithExtraRest, '2027-12-16');

  assert.strictEqual(
    Engine.diffCalendarDays(dash1.nextPayDate, dash2.nextPayDate),
    1,
    '再休息一天后，第2期预计发薪日应顺延 1 天'
  );
  // 已支付的第1期记录保持不变
  assert.strictEqual(dash2.cycles[0].paid, true);
  assert.strictEqual(dash2.cycles[0].actualDate, '2027-12-10');
  assert.strictEqual(dash2.cycles[0].actualAmount, 8500);
}

// 4. 上户前的状态处理（例如今天是 2026-11-27）
{
  const state = makeState();
  const dash = Engine.calculateDashboard(state, '2026-11-27');
  assert.strictEqual(dash.hasStarted, false);
  assert.strictEqual(dash.workDays, 0);
  assert.strictEqual(dash.nextPayDate, '2027-12-09'); // 无休息日时，11/7 起第33天是 12/9
  assert.strictEqual(dash.remainingWorkdaysToNextPay, 33);
}

// 5. 离职结算测试：累计工作33天且第1期已付8500元 -> 结清剩余7天工资
{
  const state = makeState({
    restDates: [{ date: '2027-11-21' }],
    payments: [{ cycleIndex: 1, paid: true, actualDate: '2027-12-10', actualAmount: 8500 }]
  });
  const resign = Engine.calculateResignation(state, '2027-12-10');
  assert.strictEqual(resign.workDays, 33);
  assert.strictEqual(resign.totalPaid, 8500);
  assert.strictEqual(resign.remainingDays, 7);
  assert.strictEqual(resign.finalSettlement, Math.round((7 / 26) * 8500 * 100) / 100);
}

// 6. 离职结算测试：累计工作60天，仅第1期已付8500，第2期（59天触发）尚未付 -> 结清第2期8500 + 剩余8天
{
  const state = makeState({
    payments: [{ cycleIndex: 1, paid: true, actualDate: '2027-12-09', actualAmount: 8500 }]
  });
  const resignDate = Engine.addDays('2027-11-07', 59); // 60个自然日无休息 = 60工作日
  const resign = Engine.calculateResignation(state, resignDate);
  assert.strictEqual(resign.workDays, 60);
  assert.strictEqual(resign.completedCycles, 2);
  assert.strictEqual(resign.unpaidCompletedCyclesAmount, 8500);
  assert.strictEqual(resign.remainingDays, 8);
  assert.strictEqual(
    resign.finalSettlement,
    Math.round(((60 / 26) * 8500 - 8500) * 100) / 100
  );
}

console.log('All NannySalaryEngine tests passed!');
