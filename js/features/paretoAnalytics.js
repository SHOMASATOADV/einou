// =========================================================================
// Feature: TSK-040 時系列・労務＆コスト パレート分析（ABC分析・ボトルネック特定）
//   - TSK-040-1: 月別・旬別（上旬/中旬/下旬）作業工数・機械稼働・コスト集計
//   - TSK-040-2: パレート（80-20）累積比率アルゴリズム＆ABCランク判定
//   - TSK-040-3: パレート図（棒＋累積折れ線）＆時系列推移グラフSVG描画UI
//   - TSK-040-4: ボトルネック改善インパクト試算シミュレータ（10〜30%削減試算）
// =========================================================================

const PARETO_DEMO_LOGS = [
  { date: '2026/04/12', cat: '耕起', duration: 14.0, machineId: 'M01' },
  { date: '2026/04/24', cat: '代かき', duration: 16.0, machineId: 'M01' },
  { date: '2026/05/03', cat: '施肥', duration: 8.5, machineId: 'M01' },
  { date: '2026/05/08', cat: '田植え', duration: 18.0, machineId: 'M04' },
  { date: '2026/05/22', cat: '草刈り', duration: 12.0, machineId: 'M02' },
  { date: '2026/06/14', cat: '草刈り', duration: 15.5, machineId: 'M02' },
  { date: '2026/06/26', cat: '防除', duration: 5.0, machineId: 'M03' },
  { date: '2026/07/09', cat: '草刈り', duration: 16.5, machineId: 'M02' },
  { date: '2026/07/20', cat: '施肥', duration: 6.0, machineId: 'M01' },
  { date: '2026/08/05', cat: '防除', duration: 5.5, machineId: 'M03' },
  { date: '2026/08/15', cat: '草刈り', duration: 14.0, machineId: 'M02' },
  { date: '2026/09/18', cat: '収穫', duration: 22.0, machineId: 'M01' }
];

function getJunBucket_(dateStr) {
  const clean = String(dateStr || '').replace(/-/g, '/');
  const m = clean.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return { monthKey: '不明', junKey: '不明', sortKey: '9999-99-9' };
  const yr = m[1];
  const mo = m[2].padStart(2, '0');
  const dy = Number(m[3]);
  const junIdx = dy <= 10 ? 1 : (dy <= 20 ? 2 : 3);
  const junLabel = junIdx === 1 ? '上旬' : (junIdx === 2 ? '中旬' : '下旬');
  return {
    monthKey: `${Number(mo)}月`,
    junKey: `${Number(mo)}月${junLabel}`,
    sortKey: `${yr}-${mo}-${junIdx}`
  };
}

/**
 * TSK-040-1: 月別・旬別の作業工数・機械稼働・労務＆機械コストを集計
 */
function aggregateMonthlyJunWorkStats(logs = [], machineMap = {}, costCfg = null) {
  const hourlyWage = Number(costCfg?.hourlyWageYen) || 1500;
  const byCategory = {};
  const byMonth = {};
  const byJun = {};

  (logs || []).forEach(l => {
    if (!l) return;
    const cat = String(l.cat || 'その他');
    const dur = Math.max(0, Number(l.duration) || 0);
    if (dur <= 0) return;

    const mach = l.machineId && machineMap[l.machineId] ? machineMap[l.machineId] : null;
    const machRate = mach ? (Number(mach.hourlyCostYen) || 2500) : 0;
    const machHr = mach ? dur : 0;
    const laborCost = Math.round(dur * hourlyWage);
    const machCost = Math.round(machHr * machRate);
    const totalCost = laborCost + machCost;

    if (!byCategory[cat]) {
      byCategory[cat] = { cat, hours: 0, machineHours: 0, laborCostYen: 0, machineCostYen: 0, totalCostYen: 0, count: 0 };
    }
    byCategory[cat].hours += dur;
    byCategory[cat].machineHours += machHr;
    byCategory[cat].laborCostYen += laborCost;
    byCategory[cat].machineCostYen += machCost;
    byCategory[cat].totalCostYen += totalCost;
    byCategory[cat].count += 1;

    const bucket = getJunBucket_(l.date);
    if (!byMonth[bucket.monthKey]) {
      byMonth[bucket.monthKey] = { label: bucket.monthKey, sortKey: bucket.sortKey.slice(0, 7), hours: 0, costYen: 0 };
    }
    byMonth[bucket.monthKey].hours += dur;
    byMonth[bucket.monthKey].costYen += totalCost;

    if (!byJun[bucket.junKey]) {
      byJun[bucket.junKey] = { label: bucket.junKey, sortKey: bucket.sortKey, hours: 0, costYen: 0 };
    }
    byJun[bucket.junKey].hours += dur;
    byJun[bucket.junKey].costYen += totalCost;
  });

  const categories = Object.values(byCategory).map(c => ({
    ...c,
    hours: Math.round(c.hours * 10) / 10,
    machineHours: Math.round(c.machineHours * 10) / 10
  }));
  const monthly = Object.values(byMonth)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(m => ({ ...m, hours: Math.round(m.hours * 10) / 10 }));
  const junSeries = Object.values(byJun)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(j => ({ ...j, hours: Math.round(j.hours * 10) / 10 }));

  return { categories, monthly, junSeries };
}

/**
 * TSK-040-2: パレート（80-20）累積比率アルゴリズム＆ABCランク分類
 * @param {Array} categories aggregateMonthlyJunWorkStats の categories
 * @param {string} metric 'hours' | 'cost'
 */
function computeParetoAbcAnalysis(categories = [], metric = 'hours') {
  if (!Array.isArray(categories) || categories.length === 0) {
    return { valid: false, totalValue: 0, items: [], aRankItems: [] };
  }
  const getVal = (c) => (metric === 'cost' ? Number(c.totalCostYen || 0) : Number(c.hours || 0));
  const sorted = [...categories].sort((a, b) => getVal(b) - getVal(a));
  const totalValue = sorted.reduce((s, c) => s + getVal(c), 0);
  if (totalValue <= 0) return { valid: false, totalValue: 0, items: [], aRankItems: [] };

  let cumVal = 0;
  const items = sorted.map((c, idx) => {
    const val = getVal(c);
    const prevPct = (cumVal / totalValue) * 100;
    cumVal += val;
    const sharePct = Math.round((val / totalValue) * 1000) / 10;
    const cumPct = Math.round((cumVal / totalValue) * 1000) / 10;
    // ABC分類: 直前累積が80%未満（または最上位項目）はAランク（ボトルネック）
    let rank = 'C';
    if (idx === 0 || prevPct < 80) rank = 'A';
    else if (prevPct < 95) rank = 'B';
    return { ...c, value: val, sharePct, cumPct, rank };
  });

  return {
    valid: true,
    metric,
    totalValue: Math.round(totalValue * 10) / 10,
    items,
    aRankItems: items.filter(i => i.rank === 'A')
  };
}

/**
 * TSK-040-4: 上位ボトルネック（Aランク）の工数削減インパクト試算
 */
function simulateBottleneckSavings(paretoResult, reductionPct = 20) {
  const pct = Math.max(5, Math.min(50, Number(reductionPct) || 20));
  const targets = (paretoResult && Array.isArray(paretoResult.aRankItems)) ? paretoResult.aRankItems : [];
  const baseHours = targets.reduce((s, i) => s + Number(i.hours || 0), 0);
  const baseCostYen = targets.reduce((s, i) => s + Number(i.totalCostYen || 0), 0);
  const savedHours = Math.round(baseHours * (pct / 100) * 10) / 10;
  const savedCostYen = Math.round(baseCostYen * (pct / 100));
  return {
    reductionPct: pct,
    targetCount: targets.length,
    targetNames: targets.map(t => t.cat),
    baseHours: Math.round(baseHours * 10) / 10,
    baseCostYen,
    savedHours,
    savedCostYen
  };
}

function toggleParetoDemoMode() {
  UiState.paretoUseDemoData = !UiState.paretoUseDemoData;
  renderParetoDashboard();
}

function changeParetoMetricMode(mode) {
  UiState.paretoMetricMode = mode === 'cost' ? 'cost' : 'hours';
  renderParetoDashboard();
}

function changeParetoPeriodMode(mode) {
  UiState.paretoPeriodMode = mode === 'jun' ? 'jun' : 'month';
  renderParetoDashboard();
}

function changeParetoReductionPct(val) {
  UiState.paretoReductionPct = Math.max(5, Math.min(50, Number(val) || 20));
  renderParetoDashboard();
}

/**
 * TSK-040-3 & TSK-040-4: パレート複合グラフ・時系列推移グラフ・削減シミュレータ描画
 */
function renderParetoDashboard() {
  const container = document.getElementById('paretoDashboardBody');
  if (!container) return;

  const isDemo = Boolean(UiState.paretoUseDemoData);
  updateDemoToggleButton_(
    'paretoDemoToggleBtn',
    isDemo,
    '✅ デモ試算モード中（実データへ戻す）',
    '📊 年間サンプルデータで試算'
  );

  const srcLogs = isDemo ? PARETO_DEMO_LOGS : (workLogs || []);
  const stats = aggregateMonthlyJunWorkStats(srcLogs, machines, costSettings);
  const pareto = computeParetoAbcAnalysis(stats.categories, UiState.paretoMetricMode);

  if (!pareto.valid) {
    container.innerHTML = safeHtml`
      <div class="p-6 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center space-y-2">
        <div class="text-sm font-bold text-slate-700">📉 パレート分析に必要な作業日誌データがありません</div>
        <p class="text-xs text-slate-600">タブ1「現場一括入力」で作業履歴を登録するか、右上の「📊 年間サンプルデータで試算」ボタンで分析デモを確認できます。</p>
      </div>
    `;
    return;
  }

  const sim = simulateBottleneckSavings(pareto, UiState.paretoReductionPct);
  const isCost = UiState.paretoMetricMode === 'cost';
  const unitStr = isCost ? '円' : 'h';
  const fmtVal = (v) => (isCost ? `¥${Math.round(v).toLocaleString()}` : `${Number(v).toFixed(1)}h`);

  // --- SVG 1: パレート図（棒グラフ＋累積折れ線＋80%ライン） ---
  const W = 720, H = 310;
  const padL = 68, padR = 50, padT = 26, padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxBar = Math.max(1, pareto.items[0].value * 1.15);
  const barStep = plotW / pareto.items.length;
  const barW = Math.min(64, Math.max(20, barStep * 0.56));

  let paretoBarsSvg = '';
  const linePts = [];
  pareto.items.forEach((item, idx) => {
    const cx = padL + barStep * idx + barStep / 2;
    const bh = (item.value / maxBar) * plotH;
    const by = padT + plotH - bh;
    const barColor = item.rank === 'A' ? '#ef4444' : (item.rank === 'B' ? '#f59e0b' : '#94a3b8');
    paretoBarsSvg += `
      <rect x="${(cx - barW / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${barColor}" fill-opacity="0.82">
        <title>${escapeHtml(item.cat)} (${item.rank}ランク) | ${fmtVal(item.value)} (${item.sharePct}%) | 累積 ${item.cumPct}%</title>
      </rect>
      <text x="${cx.toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="bold" fill="#1e293b">${isCost ? `${Math.round(item.value / 1000)}千` : `${item.value}h`}</text>
      <text x="${cx.toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="11" font-weight="bold" fill="#334155">${escapeHtml(item.cat)}</text>
      <text x="${cx.toFixed(1)}" y="${H - padB + 30}" text-anchor="middle" font-size="9.5" fill="#64748b">${item.rank} (${item.sharePct}%)</text>
    `;
    const ly = padT + plotH - (item.cumPct / 100) * plotH;
    linePts.push({ x: cx, y: ly, pct: item.cumPct });
  });

  const linePath = linePts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lineDots = linePts.map(p => `
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#0f172a" stroke="#ffffff" stroke-width="1.5" />
    <text x="${p.x.toFixed(1)}" y="${Math.max(padT + 10, p.y - 8).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="bold" fill="#0f172a">${p.pct.toFixed(0)}%</text>
  `).join('');

  const y80 = padT + plotH * 0.2;
  const paretoSvg = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto bg-white rounded-xl border border-slate-300">
      <line x1="${padL}" y1="${y80}" x2="${W - padR}" y2="${y80}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="5,4" />
      <text x="${W - padR + 4}" y="${y80 + 4}" font-size="10" font-weight="bold" fill="#dc2626">80%</text>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />
      <line x1="${W - padR}" y1="${padT}" x2="${W - padR}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />
      ${paretoBarsSvg}
      <path d="${linePath}" fill="none" stroke="#0f172a" stroke-width="2.5" />
      ${lineDots}
      <text x="${padL - 8}" y="${padT + 6}" text-anchor="end" font-size="10" fill="#475569">${isCost ? 'コスト' : '時間(h)'}</text>
      <text x="${W - padR + 4}" y="${padT + 6}" font-size="10" fill="#475569">100%</text>
    </svg>
  `;

  // --- SVG 2: 月別・旬別 時系列推移グラフ ---
  const series = UiState.paretoPeriodMode === 'jun' ? stats.junSeries : stats.monthly;
  const maxSer = Math.max(1, ...series.map(s => (isCost ? s.costYen : s.hours))) * 1.15;
  const tsH = 210, tsPadL = 56, tsPadR = 20, tsPadT = 22, tsPadB = 38;
  const tsW = W - tsPadL - tsPadR;
  const tsPlotH = tsH - tsPadT - tsPadB;
  const tsStep = tsW / Math.max(1, series.length);
  const tsBarW = Math.min(44, Math.max(14, tsStep * 0.55));
  const peakItem = series.reduce((acc, cur) => ((isCost ? cur.costYen : cur.hours) > (isCost ? acc.costYen : acc.hours) ? cur : acc), series[0]);

  const tsBarsSvg = series.map((s, idx) => {
    const val = isCost ? s.costYen : s.hours;
    const cx = tsPadL + tsStep * idx + tsStep / 2;
    const bh = (val / maxSer) * tsPlotH;
    const by = tsPadT + tsPlotH - bh;
    const isPeak = s.label === peakItem.label;
    return `
      <rect x="${(cx - tsBarW / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${tsBarW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${isPeak ? '#059669' : '#38bdf8'}">
        <title>${escapeHtml(s.label)} | ${fmtVal(val)}</title>
      </rect>
      <text x="${cx.toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="bold" fill="#1e293b">${isCost ? `${Math.round(val / 1000)}千` : `${val}h`}</text>
      <text x="${cx.toFixed(1)}" y="${tsH - tsPadB + 15}" text-anchor="middle" font-size="10" fill="#334155">${escapeHtml(s.label)}</text>
    `;
  }).join('');

  const timeSeriesSvg = `
    <svg viewBox="0 0 ${W} ${tsH}" class="w-full h-auto bg-white rounded-xl border border-slate-300">
      <line x1="${tsPadL}" y1="${tsPadT}" x2="${tsPadL}" y2="${tsH - tsPadB}" stroke="#64748b" stroke-width="1.5" />
      <line x1="${tsPadL}" y1="${tsH - tsPadB}" x2="${W - tsPadR}" y2="${tsH - tsPadB}" stroke="#64748b" stroke-width="1.5" />
      ${tsBarsSvg}
    </svg>
  `;

  const rowsHtml = pareto.items.map(item => {
    const badgeCls = item.rank === 'A'
      ? 'bg-red-100 text-red-700 border-red-300'
      : (item.rank === 'B' ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-100 text-slate-700 border-slate-300');
    return safeHtml`
      <tr>
        <td class="border border-slate-300 p-2 font-bold">${item.cat}</td>
        <td class="border border-slate-300 p-2 text-center"><span class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeCls}">${item.rank}ランク</span></td>
        <td class="border border-slate-300 p-2 text-right font-mono">${item.count}回</td>
        <td class="border border-slate-300 p-2 text-right font-mono font-bold">${item.hours.toFixed(1)} h</td>
        <td class="border border-slate-300 p-2 text-right font-mono">¥${item.totalCostYen.toLocaleString()}</td>
        <td class="border border-slate-300 p-2 text-right font-mono font-bold">${item.sharePct.toFixed(1)}%</td>
        <td class="border border-slate-300 p-2 text-right font-mono">${item.cumPct.toFixed(1)}%</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = safeHtml`
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div class="p-3.5 rounded-xl bg-red-50 border border-red-200">
        <div class="text-[11px] font-bold text-red-700">🚨 最重要ボトルネック（Aランク・上位80%）</div>
        <div class="text-base font-extrabold text-red-900 mt-0.5">${sim.targetNames.join('・')}</div>
        <div class="text-[11px] text-red-700/80">合計 ${sim.baseHours}h ／ ¥${sim.baseCostYen.toLocaleString()}</div>
      </div>
      <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
        <div class="text-[11px] font-bold text-emerald-700">✨ 改善シミュレータ（Aランク ${sim.reductionPct}% 省力化時）</div>
        <div class="text-xl font-extrabold text-emerald-800 mt-0.5">-¥${sim.savedCostYen.toLocaleString()} <span class="text-xs font-normal">/ 年間</span></div>
        <div class="text-[11px] text-emerald-700/80">創出可能時間：+${sim.savedHours} 時間（約 ${(sim.savedHours / 8).toFixed(1)} 人日）</div>
      </div>
      <div class="p-3.5 rounded-xl bg-sky-50 border border-sky-200">
        <div class="text-[11px] font-bold text-sky-700">📅 最大繁忙ピーク（${UiState.paretoPeriodMode === 'jun' ? '旬別' : '月別'}）</div>
        <div class="text-xl font-extrabold text-sky-900 mt-0.5">${peakItem.label}</div>
        <div class="text-[11px] text-sky-700/80">ピーク負荷：${fmtVal(isCost ? peakItem.costYen : peakItem.hours)}</div>
      </div>
    </div>

    <div class="no-print p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 mb-4 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div class="font-bold text-emerald-800">🛠️ ボトルネック作業（${sim.targetNames.join('・')}）の省力化率シミュレーション：</div>
      <div class="flex items-center gap-2">
        <input type="range" id="paretoReductionSlider" min="10" max="30" step="5" value="${sim.reductionPct}" data-input="changeParetoReductionPct" class="w-36 accent-emerald-600">
        <span class="font-mono font-extrabold text-emerald-800 w-12">${sim.reductionPct}%減</span>
      </div>
    </div>

    <div class="mb-4">
      <div class="text-xs font-bold text-slate-700 mb-1.5">📉 作業分類別 パレート図（棒：${isCost ? '労務＋機械コスト' : '労働時間'} ／ 折れ線：累積構成比%）</div>
      ${rawHtml(paretoSvg)}
    </div>

    <div class="mb-4">
      <div class="text-xs font-bold text-slate-700 mb-1.5">📅 ${UiState.paretoPeriodMode === 'jun' ? '旬別（上旬/中旬/下旬）' : '月別'} 労務・稼働負荷推移（緑＝最大繁忙ピーク）</div>
      ${rawHtml(timeSeriesSvg)}
    </div>

    <div class="overflow-x-auto">
      <table class="w-full border-collapse border border-slate-300 text-xs text-slate-900">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-300 p-2 text-left">作業分類</th>
            <th class="border border-slate-300 p-2 text-center">ABCランク</th>
            <th class="border border-slate-300 p-2 text-right">実施回数</th>
            <th class="border border-slate-300 p-2 text-right">総労働時間</th>
            <th class="border border-slate-300 p-2 text-right">労務＋機械コスト</th>
            <th class="border border-slate-300 p-2 text-right">構成比</th>
            <th class="border border-slate-300 p-2 text-right">累積構成比</th>
          </tr>
        </thead>
        <tbody>
          ${rawHtml(rowsHtml)}
        </tbody>
      </table>
    </div>
  `;
}

registerActionHandlers({
  toggleParetoDemoMode: () => toggleParetoDemoMode(),
  changeParetoMetricMode: (el) => changeParetoMetricMode(el.value),
  changeParetoPeriodMode: (el) => changeParetoPeriodMode(el.value),
  changeParetoReductionPct: (el) => changeParetoReductionPct(el.value),
  renderParetoDashboard: () => renderParetoDashboard()
});
