(function () {
  'use strict';

  var STORAGE_KEY = 'nanny_salary_manager_v1';
  var Engine = window.NannySalaryEngine;

  function getDefaultState() {
    return {
      settings: {
        startDate: '2027-11-07',
        cycleDays: 26,
        cycleSalary: 8500,
        lagDays: 7
      },
      restDates: [],
      holidays: [],
      payments: []
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultState();
      var parsed = JSON.parse(raw);
      return {
        settings: Object.assign(getDefaultState().settings, parsed.settings || {}),
        restDates: Array.isArray(parsed.restDates) ? parsed.restDates : [],
        holidays: Array.isArray(parsed.holidays) ? parsed.holidays : [],
        payments: Array.isArray(parsed.payments) ? parsed.payments : []
      };
    } catch (e) {
      return getDefaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  var state = loadState();
  var activeModalCycle = null;
  var toastTimer = null;

  function showToast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, 2600);
  }

  function formatMoney(num) {
    var n = Number(num) || 0;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' 元';
  }

  function formatCNDate(dateStr) {
    if (!dateStr) return '--';
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return parts[0] + '年' + parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
  }

  function renderAll() {
    var today = Engine.getTodayStr();
    var dash = Engine.calculateDashboard(state, today);

    // 顶部状态徽章
    var pill = document.getElementById('status-pill');
    var subtitle = document.getElementById('header-subtitle');
    var btnWork = document.getElementById('btn-work-today');
    var btnRest = document.getElementById('btn-rest-today');

    if (!dash.hasStarted) {
      pill.textContent = '距上户还有 ' + dash.daysUntilStart + ' 天';
      pill.className = 'status-pill is-pending';
      subtitle.textContent = '上户日期 ' + formatCNDate(dash.startDate) + '，可提前规划休假与节日';
    } else if (dash.isTodayRest) {
      pill.textContent = '今日已记普通休息';
      pill.className = 'status-pill is-rest';
      subtitle.textContent = '今日不发工资且不计工作日，后续发薪日已自动顺延';
    } else if (dash.todayHoliday) {
      var isDouble = dash.todayHoliday.mode === 'work';
      pill.textContent = isDouble ? '今日节假日2倍' : '今日节假日1倍休';
      pill.className = 'status-pill is-pending';
      subtitle.textContent = isDouble
        ? '节假日工作按2倍计薪（计1个工作日 + 1倍日薪补贴）'
        : '节假日休息按1倍计薪（正常计入工作日，发薪不顺延）';
    } else {
      pill.textContent = '正常累计中';
      pill.className = 'status-pill';
      subtitle.textContent = '默认每日自动累计工作日，休息或节假日点击下方按钮';
    }

    btnWork.classList.toggle('is-active', !dash.isTodayRest && !dash.todayHoliday);
    btnRest.classList.toggle('is-active', dash.isTodayRest);
    document.getElementById('btn-holiday-rest-today').classList.toggle(
      'is-active',
      Boolean(dash.todayHoliday && dash.todayHoliday.mode === 'rest')
    );
    document.getElementById('btn-holiday-work-today').classList.toggle(
      'is-active',
      Boolean(dash.todayHoliday && dash.todayHoliday.mode === 'work')
    );

    document.getElementById('btn-work-sub').textContent =
      dash.isTodayRest || dash.todayHoliday
        ? '点击恢复今日为普通工作日'
        : '默认自动累计';
    document.getElementById('btn-rest-sub').textContent = dash.isTodayRest
      ? '今日已标记休息'
      : '不发工资·顺延发薪日';

    // 主卡片
    document.getElementById('hero-next-date').textContent = formatCNDate(dash.nextPayDate);
    document.getElementById('hero-next-amount').textContent = formatMoney(dash.nextPayAmount);
    document.getElementById('hero-remaining-days').textContent =
      dash.remainingWorkdaysToNextPay === 0
        ? '已达发薪条件（今日可发）'
        : '还剩 ' + dash.remainingWorkdaysToNextPay + ' 个工作日';

    // 10项核心指标
    document.getElementById('m-start-date').textContent = formatCNDate(dash.startDate);
    document.getElementById('m-today-date').textContent = formatCNDate(dash.today);
    document.getElementById('m-work-days').textContent = dash.workDays + ' 天';
    document.getElementById('m-rest-days').textContent = dash.restDays + ' 天';
    document.getElementById('m-holiday-summary').textContent =
      dash.holidayRestDays + ' 天 / ' + dash.holidayWorkDays + ' 天（+' + formatMoney(dash.holidayExtraTotal) + '）';
    document.getElementById('m-next-pay-date').textContent = formatCNDate(dash.nextPayDate);
    document.getElementById('m-remaining-days').textContent = dash.remainingWorkdaysToNextPay + ' 天';
    document.getElementById('m-next-pay-amount').textContent = formatMoney(dash.nextPayAmount);
    document.getElementById('m-total-paid').textContent = formatMoney(dash.totalPaid);
    document.getElementById('m-held-salary').textContent = formatMoney(dash.heldSalary);
    document.getElementById('m-resign-estimate').textContent = formatMoney(dash.estimatedResignSettlement);

    renderRestList(dash);
    renderHolidayList(dash);
    renderSalaryCycles(dash);
    renderResignation();
    syncSettingsInputs();
  }

  function renderHolidayList(dash) {
    var listEl = document.getElementById('holiday-history-list');
    var sorted = dash.holidayList.slice().reverse();
    document.getElementById('holiday-count-badge').textContent = sorted.length + ' 天';

    if (sorted.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无节假日记录。</div>';
      return;
    }

    listEl.innerHTML = sorted
      .map(function (item) {
        var isWork = item.mode === 'work';
        var badge = isWork
          ? '<span class="badge badge-holiday-2x">2倍工资</span>'
          : '<span class="badge badge-holiday-1x">1倍工资</span>';
        var note = item.note
          ? escapeHtml(item.note)
          : isWork
            ? '节假日工作（计1天+额外1倍日薪）'
            : '节假日休息（1倍带薪·不顺延）';
        return (
          '<div class="rest-row">' +
          '<div>' +
          '<div class="rest-date-text">' + badge + formatCNDate(item.date) + '</div>' +
          '<div class="rest-note-text">' + note + '</div>' +
          '</div>' +
          '<button class="delete-btn" data-remove-holiday="' + item.date + '" type="button">撤销</button>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderRestList(dash) {
    var listEl = document.getElementById('rest-history-list');
    var sorted = dash.restList.slice().reverse();
    document.getElementById('rest-count-badge').textContent = sorted.length + ' 天';

    if (sorted.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无休息记录，所有日期均按正常工作日累计。</div>';
      return;
    }

    listEl.innerHTML = sorted
      .map(function (item) {
        var note = item.note ? escapeHtml(item.note) : '休息一天（已顺延发薪日）';
        return (
          '<div class="rest-row">' +
          '<div>' +
          '<div class="rest-date-text">' + formatCNDate(item.date) + '</div>' +
          '<div class="rest-note-text">' + note + '</div>' +
          '</div>' +
          '<button class="delete-btn" data-remove-rest="' + item.date + '" type="button">撤销</button>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderSalaryCycles(dash) {
    document.getElementById('s-paid-count').textContent = dash.paidCycleCount + ' 期';
    document.getElementById('s-paid-total').textContent = formatMoney(dash.totalPaid);
    document.getElementById('s-unpaid-total').textContent = formatMoney(dash.heldSalary);

    var container = document.getElementById('salary-cycles-list');
    container.innerHTML = dash.cycles
      .map(function (c) {
        var badgeClass = c.paid ? 'badge-paid' : c.isDue ? 'badge-due' : 'badge-pending';
        var badgeText = c.paid ? '已支付' : c.isDue ? '已到期待发' : '未到期';
        var actualDateStr = c.paid ? formatCNDate(c.actualDate) : '未发放';
        var actualAmtStr = c.paid ? formatMoney(c.actualAmount) : '--';

        var actionHtml = c.paid
          ? '<button class="btn-small-ghost" data-unpay-cycle="' + c.cycleIndex + '" type="button">撤销已发状态</button>'
          : '<button class="btn-small-primary" data-pay-cycle="' + c.cycleIndex + '" data-default-date="' + c.expectedPayDate + '" data-default-amount="' + c.expectedAmount + '" type="button">确认已发工资</button>';

        var extraLine = c.holidayWorkDays > 0
          ? ' · 含节假日2倍补贴 +' + formatMoney(c.holidayExtraAmount)
          : '';

        return (
          '<div class="cycle-card">' +
          '<div class="cycle-top">' +
          '<div>' +
          '<div class="cycle-title">第 ' + c.cycleIndex + ' 期工资</div>' +
          '<div class="cycle-sub">对应第 ' + c.workStart + '–' + c.workEnd + ' 工作日 · 满 ' + c.triggerWorkday + ' 天发放' + extraLine + '</div>' +
          '</div>' +
          '<span class="badge ' + badgeClass + '">' + badgeText + '</span>' +
          '</div>' +
          '<div class="cycle-details">' +
          '<div class="cycle-detail-item"><span>应发金额</span><strong>' + formatMoney(c.expectedAmount) + '</strong></div>' +
          '<div class="cycle-detail-item"><span>预计发薪日期</span><strong>' + formatCNDate(c.expectedPayDate) + '</strong></div>' +
          '<div class="cycle-detail-item"><span>实际发薪日期</span><strong>' + actualDateStr + '</strong></div>' +
          '<div class="cycle-detail-item"><span>实际支付金额</span><strong>' + actualAmtStr + '</strong></div>' +
          '</div>' +
          '<div class="cycle-actions">' + actionHtml + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderResignation() {
    var resignInput = document.getElementById('resign-date-input');
    if (!resignInput.value) {
      resignInput.value = Engine.getTodayStr();
    }
    var res = Engine.calculateResignation(state, resignInput.value);
    document.getElementById('r-work-days').textContent = res.workDays + ' 天';
    document.getElementById('r-rest-days').textContent = res.restDays + ' 天';
    document.getElementById('r-unpaid-cycles').textContent = formatMoney(res.unpaidCompletedCyclesAmount);
    document.getElementById('r-partial-amount').textContent =
      formatMoney(res.remainingDaysAmount) + '（' + res.remainingDays + '天）';
    document.getElementById('r-holiday-extra').textContent =
      formatMoney(res.holidayExtraTotal) + '（' + res.holidayWorkDays + '天）';
    document.getElementById('r-total-paid').textContent = formatMoney(res.totalPaid);
    document.getElementById('r-final-amount').textContent = formatMoney(res.finalSettlement);
    document.getElementById('r-explain-text').textContent =
      '计算口径：按日薪约 ' + res.dailyRate + ' 元（' + state.settings.cycleSalary + '÷' + state.settings.cycleDays + '），计薪工作日 ' +
      res.workDays + ' 天 + 节假日2倍加班 ' + res.holidayWorkDays + ' 天，总应得 ' + formatMoney(res.totalEarned) +
      '，扣除已支付 ' + formatMoney(res.totalPaid) + '，最终应结清 ' + formatMoney(res.finalSettlement) + '。';
  }

  function syncSettingsInputs() {
    document.getElementById('set-start-date').value = state.settings.startDate;
    document.getElementById('set-cycle-days').value = state.settings.cycleDays;
    document.getElementById('set-cycle-salary').value = state.settings.cycleSalary;
    document.getElementById('set-lag-days').value = state.settings.lagDays;
  }

  function addRestDate(dateStr, note) {
    if (!dateStr) {
      showToast('请选择休息日期');
      return;
    }
    var exists = state.restDates.some(function (r) { return r.date === dateStr; });
    if (exists) {
      showToast(formatCNDate(dateStr) + ' 已经标记为休息日，无需重复操作');
      return;
    }
    // 普通休息与节假日互斥，避免同一天重复计算
    state.holidays = state.holidays.filter(function (h) { return h.date !== dateStr; });
    state.restDates.push({ date: dateStr, note: note || '' });
    saveState();
    renderAll();
    showToast('已标记 ' + formatCNDate(dateStr) + ' 为普通休息日，后续发薪日已顺延');
  }

  function removeRestDate(dateStr) {
    state.restDates = state.restDates.filter(function (r) { return r.date !== dateStr; });
    saveState();
    renderAll();
    showToast('已撤销 ' + formatCNDate(dateStr) + ' 的休息记录');
  }

  function setHolidayDate(dateStr, mode, note) {
    if (!dateStr) {
      showToast('请选择节假日日期');
      return;
    }
    var existing = state.holidays.find(function (h) { return h.date === dateStr; });
    if (existing && existing.mode === mode && (!note || existing.note === note)) {
      showToast(formatCNDate(dateStr) + ' 已是该节假日状态');
      return;
    }
    state.restDates = state.restDates.filter(function (r) { return r.date !== dateStr; });
    state.holidays = state.holidays.filter(function (h) { return h.date !== dateStr; });
    state.holidays.push({ date: dateStr, mode: mode, note: note || '' });
    saveState();
    renderAll();
    showToast(
      mode === 'work'
        ? '已标记 ' + formatCNDate(dateStr) + ' 为节假日工作（2倍工资）'
        : '已标记 ' + formatCNDate(dateStr) + ' 为节假日休息（1倍工资）'
    );
  }

  function removeHolidayDate(dateStr) {
    state.holidays = state.holidays.filter(function (h) { return h.date !== dateStr; });
    saveState();
    renderAll();
    showToast('已撤销 ' + formatCNDate(dateStr) + ' 的节假日记录');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 事件绑定
  document.getElementById('btn-rest-today').addEventListener('click', function () {
    addRestDate(Engine.getTodayStr(), '今天休息');
  });

  document.getElementById('btn-work-today').addEventListener('click', function () {
    var today = Engine.getTodayStr();
    var isRest = state.restDates.some(function (r) { return r.date === today; });
    var isHoliday = state.holidays.some(function (h) { return h.date === today; });
    if (isRest || isHoliday) {
      state.restDates = state.restDates.filter(function (r) { return r.date !== today; });
      state.holidays = state.holidays.filter(function (h) { return h.date !== today; });
      saveState();
      renderAll();
      showToast('已恢复今日为普通工作日');
    } else {
      showToast('今日已按正常工作日累计');
    }
  });

  document.getElementById('btn-holiday-rest-today').addEventListener('click', function () {
    setHolidayDate(Engine.getTodayStr(), 'rest', '节假日休息');
  });

  document.getElementById('btn-holiday-work-today').addEventListener('click', function () {
    setHolidayDate(Engine.getTodayStr(), 'work', '节假日工作');
  });

  document.getElementById('btn-add-holiday').addEventListener('click', function () {
    var d = document.getElementById('holiday-date-input').value;
    var mode = document.getElementById('holiday-mode-select').value;
    var note = document.getElementById('holiday-note-input').value.trim();
    setHolidayDate(d, mode, note);
    document.getElementById('holiday-note-input').value = '';
  });

  document.getElementById('holiday-history-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove-holiday]');
    if (!btn) return;
    removeHolidayDate(btn.getAttribute('data-remove-holiday'));
  });

  document.getElementById('btn-add-rest').addEventListener('click', function () {
    var d = document.getElementById('rest-date-input').value;
    var note = document.getElementById('rest-note-input').value.trim();
    addRestDate(d, note);
    document.getElementById('rest-note-input').value = '';
  });

  document.getElementById('rest-history-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove-rest]');
    if (!btn) return;
    removeRestDate(btn.getAttribute('data-remove-rest'));
  });

  document.getElementById('salary-cycles-list').addEventListener('click', function (e) {
    var payBtn = e.target.closest('[data-pay-cycle]');
    if (payBtn) {
      activeModalCycle = parseInt(payBtn.getAttribute('data-pay-cycle'), 10);
      document.getElementById('pay-modal-title').textContent = '确认第 ' + activeModalCycle + ' 期已发工资';
      document.getElementById('modal-pay-date').value = payBtn.getAttribute('data-default-date');
      document.getElementById('modal-pay-amount').value = payBtn.getAttribute('data-default-amount');
      document.getElementById('pay-modal').classList.remove('hidden');
      return;
    }

    var unpayBtn = e.target.closest('[data-unpay-cycle]');
    if (unpayBtn) {
      var idx = parseInt(unpayBtn.getAttribute('data-unpay-cycle'), 10);
      state.payments = state.payments.filter(function (p) { return p.cycleIndex !== idx; });
      saveState();
      renderAll();
      showToast('已撤销第 ' + idx + ' 期发薪记录');
    }
  });

  document.getElementById('btn-close-modal').addEventListener('click', function () {
    document.getElementById('pay-modal').classList.add('hidden');
    activeModalCycle = null;
  });

  document.getElementById('btn-confirm-pay').addEventListener('click', function () {
    if (!activeModalCycle) return;
    var actualDate = document.getElementById('modal-pay-date').value;
    var actualAmount = parseFloat(document.getElementById('modal-pay-amount').value);
    if (!actualDate || isNaN(actualAmount) || actualAmount < 0) {
      showToast('请填写正确的日期和金额');
      return;
    }
    state.payments = state.payments.filter(function (p) { return p.cycleIndex !== activeModalCycle; });
    state.payments.push({
      cycleIndex: activeModalCycle,
      paid: true,
      actualDate: actualDate,
      actualAmount: actualAmount
    });
    saveState();
    document.getElementById('pay-modal').classList.add('hidden');
    showToast('已记录第 ' + activeModalCycle + ' 期工资发放');
    activeModalCycle = null;
    renderAll();
  });

  document.getElementById('resign-date-input').addEventListener('change', renderResignation);

  document.getElementById('btn-save-settings').addEventListener('click', function () {
    var startDate = document.getElementById('set-start-date').value;
    var cycleDays = parseInt(document.getElementById('set-cycle-days').value, 10);
    var cycleSalary = parseFloat(document.getElementById('set-cycle-salary').value);
    var lagDays = parseInt(document.getElementById('set-lag-days').value, 10);

    if (!startDate || !cycleDays || cycleDays < 1 || isNaN(cycleSalary) || cycleSalary <= 0 || isNaN(lagDays) || lagDays < 0) {
      showToast('请检查规则参数是否有效');
      return;
    }

    state.settings = {
      startDate: startDate,
      cycleDays: cycleDays,
      cycleSalary: cycleSalary,
      lagDays: lagDays
    };
    saveState();
    renderAll();
    showToast('规则设置已保存并生效');
  });

  document.getElementById('btn-export-json').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '育儿嫂工资备份-' + Engine.getTodayStr() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('备份文件已导出');
  });

  document.getElementById('btn-copy-json').addEventListener('click', function () {
    var text = JSON.stringify(state, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('备份内容已复制到剪贴板');
      });
    } else {
      showToast('当前浏览器不支持自动复制，请使用导出文件');
    }
  });

  document.getElementById('input-import-json').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var parsed = JSON.parse(ev.target.result);
        if (!parsed || !parsed.settings) throw new Error('格式不正确');
        state = {
          settings: Object.assign(getDefaultState().settings, parsed.settings),
          restDates: Array.isArray(parsed.restDates) ? parsed.restDates : [],
          holidays: Array.isArray(parsed.holidays) ? parsed.holidays : [],
          payments: Array.isArray(parsed.payments) ? parsed.payments : []
        };
        saveState();
        renderAll();
        showToast('数据已成功恢复');
      } catch (err) {
        showToast('导入失败：备份文件格式无效');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-reset-data').addEventListener('click', function () {
    if (!window.confirm('确定要恢复为默认初始数据吗？当前所有休息和发薪记录将被清空。')) return;
    state = getDefaultState();
    saveState();
    renderAll();
    showToast('已恢复默认初始数据');
  });

  // Tab 切换
  document.querySelectorAll('.tab-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-item').forEach(function (t) {
        t.classList.remove('active');
      });
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.remove('active');
      });
      btn.classList.add('active');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // 初始化默认日期输入并渲染
  document.getElementById('rest-date-input').value = Engine.getTodayStr();
  document.getElementById('holiday-date-input').value = Engine.getTodayStr();
  document.getElementById('resign-date-input').value = Engine.getTodayStr();
  renderAll();
})();
