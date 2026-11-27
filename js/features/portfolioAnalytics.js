// =========================================================================
// Feature: TSK-037 全圃場4象限ポートフォリオ解析（バブルチャート＆4グループ自動分類）
//   - TSK-037-1: 粗利/10a × 作業時間/10a 指標集計
//   - TSK-037-2: 4象限マトリクス座標系・中央値/平均値分割ロジック
//   - TSK-037-3: 面積比例バブルチャートSVG描画UI（タップでGISカルテ遷移）
//   - TSK-037-4: 4グループ診断＆経営改善アクション提示
// =========================================================================

const PORTFOLIO_DEMO_ITEMS = [
  { id: 'DEMO-P1', name: '① 本場1号(参考)', crop: 'コシヒカリ (BL)', area: 30, hoursPer10a: 4.2, profitPer10aYen: 138000 },
  { id: 'DEMO-P2', name: '② 本場2号(参考)', crop: 'コシヒカリ (BL)', area: 20, hoursPer10a: 4.8, profitPer10aYen: 126000 },
  { id: 'DEMO-P3', name: '③ 本場3号・大町(参考)', crop: 'コシヒカリ (BL)', area: 50, hoursPer10a: 3.6, profitPer10aYen: 152000 },
  { id: 'DEMO-P4', name: '④ 川向4号(参考)', crop: 'つきあかり', area: 35, hoursPer10a: 5.1, profitPer10aYen: 102000 },
  { id: 'DEMO-P5', name: '⑤ 上山田A(参考)', crop: 'コシヒカリ (BL)', area: 15, hoursPer10a: 8.6, profitPer10aYen: 128000 },
  { id: 'DEMO-P6', name: '⑥ 上山田B(参考)', crop: 'コシヒカリ (BL)', area: 18, hoursPer10a: 9.4, profitPer10aYen: 78000 },
  { id: 'DEMO-P7', name: '⑦ 棚田C(参考)', crop: 'コシヒカリ (BL)', area: 22, hoursPer10a: 10.8, profitPer10aYen: 64000 }
];

const PORTFOLIO_QUADRANT_META = {
  star: {
    key: 'star',
    label: '🌟 優良主力田',
    desc: '高収益・省力',
    color: '#10b981',
    bgClass: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    action: '経営の柱となる理想的な圃場です。現行の施肥・作業手順を標準モデルとして他圃場へ横展開しましょう。'
  },
  improve: {
    key: 'improve',
    label: '🔧 改善余地田',
    desc: '低収益・省力',
    color: '#0284c7',
    bgClass: 'bg-sky-50 border-sky-200 text-sky-800',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-300',
    action: '手間はかかっていないため、施肥設計（TSK-036最適チッソ）や土壌改良・品種見直しで反収底上げを狙いましょう。'
  },
  heavy: {
    key: 'heavy',
    label: '💦 労力過多田',
    desc: '高収益・多労力',
    color: '#f59e0b',
    bgClass: 'bg-amber-50 border-amber-200 text-amber-800',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    action: '収益性は高いものの労力負担が大きめ。畦畔草刈りの省力化・ドローン防除・近隣圃場との同時作業化が効果的です。'
  },
  review: {
    key: 'review',
    label: '⚠️ 要見直し田',
    desc: '低収益・多労力',
    color: '#ef4444',
    bgClass: 'bg-red-50 border-red-200 text-red-800',
    badgeClass: 'bg-red-100 text-red-800 border-red-300',
    action: '労力・コスト過多かつ低収益のボトルネック圃場。粗放管理・省力品種への転換、または中山間交付金活用・委託再編を検討。'
  }
};

function calcMedian_(nums) {
  if (!Array.isArray(nums) || nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * TSK-037-1: 全圃場の「10aあたり粗利益」×「10aあたり作業時間」×「面積」を集計
 */
function collectFieldPortfolioMetrics(cropFilter = 'ALL', useDemo = false) {
  if (useDemo) {
    return PORTFOLIO_DEMO_ITEMS.filter(item => cropFilter === 'ALL' || item.crop === cropFilter);
  }
  const list = [];
  (fieldsData || []).forEach(f => {
    if (!f || !f.area || f.area <= 0) return;
    if (cropFilter !== 'ALL' && f.crop !== cropFilter) return;
    const prof = typeof calcFieldProfitability === 'function'
      ? calcFieldProfitability(f)
      : { cumHr: 0, profitPer10aYen: 0 };
    const area10a = f.area / 10;
    const hoursPer10a = Math.round(((Number(prof.cumHr) || 0) / area10a) * 100) / 100;
    const profitPer10aYen = Math.round(Number(prof.profitPer10aYen) || 0);
    list.push({
      id: f.id,
      name: f.name,
      crop: f.crop || '',
      area: f.area,
      hoursPer10a,
      profitPer10aYen
    });
  });
  return list;
}

/**
 * TSK-037-2: 中央値（または平均値）を基準軸に全圃場を4象限へ自動クラスタリング
 */
function classifyPortfolioQuadrants(items, axisMode = 'median') {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, axisHours: 0, axisProfit: 0, items: [], counts: { star: 0, improve: 0, heavy: 0, review: 0 } };
  }
  const hoursArr = items.map(i => Number(i.hoursPer10a) || 0);
  const profitArr = items.map(i => Number(i.profitPer10aYen) || 0);

  const axisHours = axisMode === 'mean'
    ? hoursArr.reduce((s, v) => s + v, 0) / hoursArr.length
    : calcMedian_(hoursArr);
  const axisProfit = axisMode === 'mean'
    ? profitArr.reduce((s, v) => s + v, 0) / profitArr.length
    : calcMedian_(profitArr);

  const counts = { star: 0, improve: 0, heavy: 0, review: 0 };
  const classified = items.map(item => {
    const highProfit = item.profitPer10aYen >= axisProfit;
    const lowHours = item.hoursPer10a <= axisHours;
    let qKey = 'review';
    if (highProfit && lowHours) qKey = 'star';
    else if (!highProfit && lowHours) qKey = 'improve';
    else if (highProfit && !lowHours) qKey = 'heavy';
    counts[qKey]++;
    return { ...item, quadrant: PORTFOLIO_QUADRANT_META[qKey] };
  });

  return {
    valid: true,
    axisMode,
    axisHours: Math.round(axisHours * 100) / 100,
    axisProfit: Math.round(axisProfit),
    items: classified,
    counts
  };
}

function togglePortfolioDemoMode() {
  UiState.portfolioUseDemoData = !UiState.portfolioUseDemoData;
  renderPortfolioDashboard();
}

function changePortfolioAxisMode(mode) {
  UiState.portfolioAxisMode = mode === 'mean' ? 'mean' : 'median';
  renderPortfolioDashboard();
}

/**
 * TSK-037-3 & TSK-037-4: 4象限バブルチャートSVG ＆ 経営改善アクションテーブル描画
 */
function renderPortfolioDashboard() {
  const container = document.getElementById('portfolioDashboardBody');
  if (!container) return;

  const isDemo = Boolean(UiState.portfolioUseDemoData);
  const cropFilter = syncCropFilterSelect_('portfolioCropFilter', isDemo ? PORTFOLIO_DEMO_ITEMS : []);
  updateDemoToggleButton_(
    'portfolioDemoToggleBtn',
    isDemo,
    '✅ デモ試算モード中（実データへ戻す）',
    '📊 サンプル7筆で4象限を試算'
  );

  const rawItems = collectFieldPortfolioMetrics(cropFilter, isDemo);
  const res = classifyPortfolioQuadrants(rawItems, UiState.portfolioAxisMode);

  if (!res.valid || res.items.length < 2) {
    container.innerHTML = safeHtml`
      <div class="p-6 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center space-y-2">
        <div class="text-sm font-bold text-slate-700">🎯 4象限ポートフォリオ解析には圃場が2筆以上必要です（現在 ${rawItems.length} 筆）</div>
        <p class="text-xs text-slate-600">圃場を登録・作業記録するか、右上の「📊 サンプル7筆で4象限を試算」ボタンでバブルチャートを体験できます。</p>
      </div>
    `;
    return;
  }

  // SVG バブルチャート座標（左が少労力・右が多労力、上が高粗利・下が低粗利）
  const W = 720, H = 360;
  const padL = 74, padR = 30, padT = 30, padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const hVals = res.items.map(i => i.hoursPer10a).concat([res.axisHours]);
  const pVals = res.items.map(i => i.profitPer10aYen).concat([res.axisProfit]);
  const minH = Math.max(0, Math.floor(Math.min(...hVals) - 1));
  const maxH = Math.max(minH + 2, Math.ceil(Math.max(...hVals) + 1.5));
  const minP = Math.floor((Math.min(...pVals) - 20000) / 10000) * 10000;
  const maxP = Math.max(minP + 40000, Math.ceil((Math.max(...pVals) + 20000) / 10000) * 10000);
  const maxArea = Math.max(10, ...res.items.map(i => i.area));

  const { svg: axesGridSvg, mapX, mapY } = renderSvgAxesAndGrid_({
    W, H, padL, padR, padT, padB,
    minX: minH, maxX: maxH, minY: minP, maxY: maxP,
    xSteps: 5, ySteps: 4,
    xFormatter: (hv) => `${hv.toFixed(1)}h`,
    yFormatter: (pv) => `${(pv / 10000).toFixed(1)}万`,
    dashArray: '2,3'
  });
  const mapR = (area) => 9 + Math.sqrt(area / maxArea) * 18;

  const axX = mapX(res.axisHours);
  const axY = mapY(res.axisProfit);

  // 4象限の背景ゾーン
  const bgZones = `
    <rect x="${padL}" y="${padT}" width="${Math.max(0, axX - padL)}" height="${Math.max(0, axY - padT)}" fill="#10b981" fill-opacity="0.09" />
    <rect x="${axX}" y="${padT}" width="${Math.max(0, W - padR - axX)}" height="${Math.max(0, axY - padT)}" fill="#f59e0b" fill-opacity="0.09" />
    <rect x="${padL}" y="${axY}" width="${Math.max(0, axX - padL)}" height="${Math.max(0, H - padB - axY)}" fill="#0284c7" fill-opacity="0.08" />
    <rect x="${axX}" y="${axY}" width="${Math.max(0, W - padR - axX)}" height="${Math.max(0, H - padB - axY)}" fill="#ef4444" fill-opacity="0.09" />
    <text x="${padL + 8}" y="${padT + 16}" font-size="11" font-weight="bold" fill="#047857">🌟 優良主力田（高粗利・省力）</text>
    <text x="${W - padR - 8}" y="${padT + 16}" text-anchor="end" font-size="11" font-weight="bold" fill="#b45309">💦 労力過多田（高粗利・多労力）</text>
    <text x="${padL + 8}" y="${H - padB - 8}" font-size="11" font-weight="bold" fill="#0369a1">🔧 改善余地田（低粗利・省力）</text>
    <text x="${W - padR - 8}" y="${H - padB - 8}" text-anchor="end" font-size="11" font-weight="bold" fill="#b91c1c">⚠️ 要見直し田（低粗利・多労力）</text>
  `;

  // 基準軸ライン
  const axisLabel = res.axisMode === 'mean' ? '平均' : '中央値';
  const crossHair = `
    <line x1="${axX}" y1="${padT}" x2="${axX}" y2="${H - padB}" stroke="#334155" stroke-width="1.5" stroke-dasharray="5,4" />
    <line x1="${padL}" y1="${axY}" x2="${W - padR}" y2="${axY}" stroke="#334155" stroke-width="1.5" stroke-dasharray="5,4" />
    <text x="${axX + 4}" y="${padT + 30}" font-size="10" font-weight="bold" fill="#334155">${axisLabel}: ${res.axisHours}h/10a</text>
    <text x="${W - padR - 4}" y="${axY - 5}" text-anchor="end" font-size="10" font-weight="bold" fill="#334155">${axisLabel}: ¥${res.axisProfit.toLocaleString()}</text>
  `;

  // バブル描画
  const bubblesSvg = res.items.map(item => {
    const cx = mapX(item.hoursPer10a);
    const cy = mapY(item.profitPer10aYen);
    const r = mapR(item.area);
    const clickAttr = !isDemo
      ? `data-action="inspectFieldFromPortfolio" data-arg="${escapeHtml(item.id)}" style="cursor:pointer"`
      : '';
    return `
      <g ${clickAttr}>
        <circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${item.quadrant.color}" fill-opacity="0.72" stroke="#ffffff" stroke-width="2">
          <title>${escapeHtml(item.name)} (${item.area}a) | 作業時間: ${item.hoursPer10a}h/10a | 10a粗利: ¥${item.profitPer10aYen.toLocaleString()} | ${escapeHtml(item.quadrant.label)}</title>
        </circle>
        <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="9.5" font-weight="bold" fill="#0f172a">${escapeHtml(item.name.slice(0, 6))}</text>
      </g>
    `;
  }).join('');

  const svgHtml = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto bg-white rounded-xl border border-slate-300">
      ${bgZones}
      ${axesGridSvg}
      ${crossHair}
      ${bubblesSvg}
      <text x="${padL + plotW / 2}" y="${H - 10}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#334155">10aあたり作業・機械時間 (h/10a) ← 左ほど省力</text>
      <text x="16" y="${padT + plotH / 2}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#334155" transform="rotate(-90 16 ${padT + plotH / 2})">10aあたり粗利益 (円/10a) ↑ 上ほど高収益</text>
    </svg>
  `;

  const rowsHtml = res.items.map(item => safeHtml`
    <tr>
      <td class="border border-slate-300 p-2 font-bold">${item.name}</td>
      <td class="border border-slate-300 p-2 text-right font-mono">${item.area} a</td>
      <td class="border border-slate-300 p-2 text-right font-mono font-bold">${item.hoursPer10a.toFixed(1)} h</td>
      <td class="border border-slate-300 p-2 text-right font-mono font-bold">¥${item.profitPer10aYen.toLocaleString()}</td>
      <td class="border border-slate-300 p-2 text-center">
        <span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${item.quadrant.badgeClass}">${item.quadrant.label}</span>
      </td>
      <td class="border border-slate-300 p-2 text-xs text-slate-700">${item.quadrant.action}</td>
    </tr>
  `).join('');

  container.innerHTML = safeHtml`
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="p-3 rounded-xl border ${PORTFOLIO_QUADRANT_META.star.bgClass}">
        <div class="text-xs font-bold">🌟 優良主力田</div>
        <div class="text-2xl font-extrabold mt-0.5">${res.counts.star} <span class="text-xs font-normal">筆</span></div>
        <div class="text-[11px] opacity-80">高収益・省力（標準モデル）</div>
      </div>
      <div class="p-3 rounded-xl border ${PORTFOLIO_QUADRANT_META.improve.bgClass}">
        <div class="text-xs font-bold">🔧 改善余地田</div>
        <div class="text-2xl font-extrabold mt-0.5">${res.counts.improve} <span class="text-xs font-normal">筆</span></div>
        <div class="text-[11px] opacity-80">低収益・省力（反収UP狙い）</div>
      </div>
      <div class="p-3 rounded-xl border ${PORTFOLIO_QUADRANT_META.heavy.bgClass}">
        <div class="text-xs font-bold">💦 労力過多田</div>
        <div class="text-2xl font-extrabold mt-0.5">${res.counts.heavy} <span class="text-xs font-normal">筆</span></div>
        <div class="text-[11px] opacity-80">高収益・多労力（省力化対象）</div>
      </div>
      <div class="p-3 rounded-xl border ${PORTFOLIO_QUADRANT_META.review.bgClass}">
        <div class="text-xs font-bold">⚠️ 要見直し田</div>
        <div class="text-2xl font-extrabold mt-0.5">${res.counts.review} <span class="text-xs font-normal">筆</span></div>
        <div class="text-[11px] opacity-80">低収益・多労力（構造改善）</div>
      </div>
    </div>

    <div class="mb-4">
      ${rawHtml(svgHtml)}
      <div class="text-[11px] text-slate-600 mt-1.5">※ 円の大きさは圃場面積(a)に比例します。実データ表示時はバブルをクリックすると該当圃場のGISカルテへ移動します。</div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full border-collapse border border-slate-300 text-xs text-slate-900">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-300 p-2 text-left">圃場名</th>
            <th class="border border-slate-300 p-2 text-right">面積</th>
            <th class="border border-slate-300 p-2 text-right">10a作業時間</th>
            <th class="border border-slate-300 p-2 text-right">10a粗利益</th>
            <th class="border border-slate-300 p-2 text-center">4象限分類</th>
            <th class="border border-slate-300 p-2 text-left">経営改善アクション提案</th>
          </tr>
        </thead>
        <tbody>
          ${rawHtml(rowsHtml)}
        </tbody>
      </table>
    </div>
  `;
}

function inspectFieldFromPortfolio(fieldId) {
  if (!fieldId || String(fieldId).startsWith('DEMO-')) return;
  switchMainTab('gis');
  inspectField(fieldId);
}

registerActionHandlers({
  togglePortfolioDemoMode: () => togglePortfolioDemoMode(),
  renderPortfolioDashboard: () => renderPortfolioDashboard(),
  changePortfolioAxisMode: (el) => changePortfolioAxisMode(el.value),
  inspectFieldFromPortfolio: (el) => inspectFieldFromPortfolio(el.dataset.arg)
});
