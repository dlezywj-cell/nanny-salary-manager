/**
 * 育儿嫂工资自动结算与日期管理 - 核心计算引擎
 * 所有日期均使用本地日期 (YYYY-MM-DD)，避免时区偏差。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NannySalaryEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 将 YYYY-MM-DD 解析为本地午夜 Date 对象
   */
  function parseLocalDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
      throw new Error('Invalid date string: ' + dateStr);
    }
    var parts = dateStr.split('-');
    if (parts.length !== 3) {
      throw new Error('Date must be YYYY-MM-DD: ' + dateStr);
    }
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    var dt = new Date(y, m - 1, d);
    if (
      dt.getFullYear() !== y ||
      dt.getMonth() !== m - 1 ||
      dt.getDate() !== d
    ) {
      throw new Error('Invalid calendar date: ' + dateStr);
    }
    return dt;
  }

  /**
   * 将 Date 对象格式化为本地 YYYY-MM-DD
   */
  function formatLocalDate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /**
   * 获取本地今天 YYYY-MM-DD
   */
  function getTodayStr(now) {
    var d = now ? new Date(now) : new Date();
    return formatLocalDate(d);
  }

  /**
   * 本地日期加减天数
   */
  function addDays(dateStr, days) {
    var dt = parseLocalDate(dateStr);
    dt.setDate(dt.getDate() + days);
    return formatLocalDate(dt);
  }

  /**
   * 两个本地日期相差的自然天数 (b - a)
   */
  function diffCalendarDays(aStr, bStr) {
    var a = parseLocalDate(aStr);
    var b = parseLocalDate(bStr);
    var msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((b.getTime() - a.getTime()) / msPerDay);
  }

  /**
   * 统计 [startDate, endDate] 闭区间内的工作天数与休息天数
   */
  function countWorkAndRestDays(startDate, endDate, restDatesSet) {
    if (endDate < startDate) {
      return { workDays: 0, restDays: 0, totalCalendarDays: 0 };
    }
    var totalCalendarDays = diffCalendarDays(startDate, endDate) + 1;
    var restDays = 0;
    restDatesSet.forEach(function (d) {
      if (d >= startDate && d <= endDate) {
        restDays += 1;
      }
    });
    return {
      workDays: Math.max(0, totalCalendarDays - restDays),
      restDays: restDays,
      totalCalendarDays: totalCalendarDays
    };
  }

  /**
   * 从 startDate 开始（含），找到第 targetWorkday 个工作日的本地日期
   * targetWorkday >= 1
   */
  function findDateForWorkday(startDate, targetWorkday, restDatesSet) {
    if (targetWorkday <= 0) return startDate;
    var current = startDate;
    var workCount = 0;
    // 安全上限防止死循环
    for (var i = 0; i < 36500; i++) {
      if (!restDatesSet.has(current)) {
        workCount += 1;
        if (workCount === targetWorkday) {
          return current;
        }
      }
      current = addDays(current, 1);
    }
    return current;
  }

  /**
   * 四舍五入到两位小数
   */
  function round2(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * 核心状态计算
   * @param {Object} state
   * @param {Object} state.settings { startDate, cycleDays, cycleSalary, lagDays }
   * @param {Array} state.restDates [{ date: 'YYYY-MM-DD', note?: string }]
   * @param {Array} state.payments [{ cycleIndex, paid, actualDate, actualAmount }]
   * @param {string} [todayStr] 默认本地今天
   */
  function calculateDashboard(state, todayStr) {
    var settings = state.settings || {};
    var startDate = settings.startDate || '2027-11-07';
    var cycleDays = Number(settings.cycleDays) || 26;
    var cycleSalary = Number(settings.cycleSalary) || 8500;
    var lagDays = Number(settings.lagDays) || 7;
    var today = todayStr || getTodayStr();

    var restList = (state.restDates || []).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    var restSet = new Set(restList.map(function (r) { return r.date; }));

    var paymentMap = {};
    (state.payments || []).forEach(function (p) {
      paymentMap[p.cycleIndex] = p;
    });

    var hasStarted = today >= startDate;
    var daysUntilStart = hasStarted ? 0 : diffCalendarDays(today, startDate);

    var counts = countWorkAndRestDays(startDate, today, restSet);
    var workDays = counts.workDays;
    var restDays = counts.restDays;
    var isTodayRest = restSet.has(today);

    // 计算已支付总额与已锁定的最大已支付周期
    var totalPaid = 0;
    var paidCycleCount = 0;
    Object.keys(paymentMap).forEach(function (key) {
      var p = paymentMap[key];
      if (p && p.paid) {
        totalPaid += Number(p.actualAmount) || 0;
        paidCycleCount += 1;
      }
    });
    totalPaid = round2(totalPaid);

    // 确定需要展示的工资周期数量：至少覆盖到当前已工作天数之后至少 3 个周期
    var firstTriggerWorkday = cycleDays + lagDays; // 默认 26 + 7 = 33
    var currentCycleEstimate =
      workDays < firstTriggerWorkday
        ? 1
        : Math.floor((workDays - firstTriggerWorkday) / cycleDays) + 2;
    var maxExplicitCycle = 0;
    Object.keys(paymentMap).forEach(function (k) {
      var idx = parseInt(k, 10);
      if (idx > maxExplicitCycle) maxExplicitCycle = idx;
    });
    var totalCyclesToGenerate = Math.max(currentCycleEstimate + 2, maxExplicitCycle + 1, 4);

    var cycles = [];
    for (var i = 1; i <= totalCyclesToGenerate; i++) {
      var workStart = (i - 1) * cycleDays + 1;
      var workEnd = i * cycleDays;
      var triggerWorkday = i * cycleDays + lagDays; // 第1期33天，第2期59天，第3期85天...
      var paymentRecord = paymentMap[i] || null;
      var isPaid = Boolean(paymentRecord && paymentRecord.paid);

      // 预计发薪日期：根据当前休息日动态计算（已支付的记录保留实际支付日期，不因后续休息日改变）
      var expectedPayDate = findDateForWorkday(startDate, triggerWorkday, restSet);

      cycles.push({
        cycleIndex: i,
        workStart: workStart,
        workEnd: workEnd,
        triggerWorkday: triggerWorkday,
        expectedAmount: cycleSalary,
        expectedPayDate: expectedPayDate,
        paid: isPaid,
        actualDate: isPaid ? paymentRecord.actualDate : null,
        actualAmount: isPaid ? Number(paymentRecord.actualAmount) : null,
        isDue: !isPaid && workDays >= triggerWorkday
      });
    }

    // 下一次未支付的发薪周期
    var nextCycle = null;
    for (var j = 0; j < cycles.length; j++) {
      if (!cycles[j].paid) {
        nextCycle = cycles[j];
        break;
      }
    }

    var remainingWorkdaysToNextPay = nextCycle
      ? Math.max(0, nextCycle.triggerWorkday - workDays)
      : 0;

    // 工资价值与暂缓/离职计算
    var dailyRate = cycleSalary / cycleDays;
    var totalEarned = round2(workDays * dailyRate);
    var totalUnpaidEarned = round2(Math.max(0, totalEarned - totalPaid));

    // 当前暂缓支付（未满发薪触发点或滞后暂押部分）
    // 已完成周期数（按每 cycleDays 天一个周期）
    var completedCycles = Math.floor(workDays / cycleDays);
    var unpaidCompletedCyclesAmount = round2(
      Math.max(0, completedCycles * cycleSalary - totalPaid)
    );
    var partialCycleDays = workDays % cycleDays;
    var partialCycleAmount = round2(partialCycleDays * dailyRate);

    // 暂缓支付金额：在滞后支付模式下，已完成工作但尚未到发薪日/尚未发放的部分
    // 具体表现为：如果已超过上个周期满额，则是暂押的滞后天数工资（最多 lagDays 天对应的金额，加上尚未满周期的在途工资）
    var heldSalary = totalUnpaidEarned;

    return {
      today: today,
      startDate: startDate,
      hasStarted: hasStarted,
      daysUntilStart: daysUntilStart,
      cycleDays: cycleDays,
      cycleSalary: cycleSalary,
      lagDays: lagDays,
      dailyRate: round2(dailyRate),
      workDays: workDays,
      restDays: restDays,
      isTodayRest: isTodayRest,
      totalPaid: totalPaid,
      paidCycleCount: paidCycleCount,
      totalEarned: totalEarned,
      heldSalary: heldSalary,
      estimatedResignSettlement: totalUnpaidEarned,
      unpaidCompletedCyclesAmount: unpaidCompletedCyclesAmount,
      partialCycleDays: partialCycleDays,
      partialCycleAmount: partialCycleAmount,
      completedCycles: completedCycles,
      nextPayDate: nextCycle ? nextCycle.expectedPayDate : null,
      nextPayAmount: nextCycle ? nextCycle.expectedAmount : cycleSalary,
      remainingWorkdaysToNextPay: remainingWorkdaysToNextPay,
      nextCycleIndex: nextCycle ? nextCycle.cycleIndex : null,
      cycles: cycles,
      restList: restList
    };
  }

  /**
   * 离职结算专项计算
   */
  function calculateResignation(state, resignDateStr) {
    var dash = calculateDashboard(state, resignDateStr);
    var workDays = dash.workDays;
    var cycleDays = dash.cycleDays;
    var cycleSalary = dash.cycleSalary;
    var lagDays = dash.lagDays;
    var dailyRate = cycleSalary / cycleDays;

    var completedCycles = Math.floor(workDays / cycleDays);
    var completedCyclesEarned = round2(completedCycles * cycleSalary);
    var unpaidCompletedCycles = round2(
      Math.max(0, completedCyclesEarned - dash.totalPaid)
    );
    var remainingDays = workDays % cycleDays;
    var remainingDaysAmount = round2(remainingDays * dailyRate);

    // 其中属于"暂押7天"口径的说明：
    // 若已工作满33天并已发放第1期，则第1期后的前7天正是滞后暂押的7天
    var heldLagDays =
      workDays >= cycleDays + lagDays && dash.paidCycleCount >= completedCycles
        ? Math.min(lagDays, remainingDays)
        : Math.min(lagDays, workDays);

    var finalSettlement = round2(Math.max(0, dash.totalEarned - dash.totalPaid));

    return {
      resignDate: resignDateStr,
      startDate: dash.startDate,
      workDays: workDays,
      restDays: dash.restDays,
      dailyRate: round2(dailyRate),
      completedCycles: completedCycles,
      unpaidCompletedCyclesAmount: unpaidCompletedCycles,
      remainingDays: remainingDays,
      remainingDaysAmount: remainingDaysAmount,
      heldLagDays: heldLagDays,
      heldLagAmount: round2(heldLagDays * dailyRate),
      totalEarned: dash.totalEarned,
      totalPaid: dash.totalPaid,
      finalSettlement: finalSettlement
    };
  }

  return {
    parseLocalDate: parseLocalDate,
    formatLocalDate: formatLocalDate,
    getTodayStr: getTodayStr,
    addDays: addDays,
    diffCalendarDays: diffCalendarDays,
    countWorkAndRestDays: countWorkAndRestDays,
    findDateForWorkday: findDateForWorkday,
    calculateDashboard: calculateDashboard,
    calculateResignation: calculateResignation
  };
});
