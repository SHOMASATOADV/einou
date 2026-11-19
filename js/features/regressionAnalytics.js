// =========================================================================
// Feature: TSK-036 チッソ(N)施肥量 × 反収 二次曲線回帰分析ダッシュボード
//   - TSK-036-1: 圃場別チッソ量・反収ペア集計エンジン
//   - TSK-036-2: 最小二乗法による二次回帰計算アルゴリズム (y = ax^2 + bx + c)
//   - TSK-036-3: インタラクティブ散布図＆回帰曲線SVG描画UI
//   - TSK-036-4: 最適施肥診断＆過剰・不足アラート出力
// =========================================================================

window._regressionUseDemoData = false;

const REGRESSION_DEMO_POINTS = [
  { id: 'DEMO-1', name: '① 本場1号(参考)', crop: 'コシヒカリ (BL)', area: 30, nPer10a: 3.2, yieldPer10a: 492 },
  { id: 'DEMO-2', name: '② 本場2号(参考)', crop: 'コシヒカリ (BL)', area: 20, nPer10a: 4.5, yieldPer10a: 538 },
  { id: 'DEMO-3', name: '③ 本場3号(参考)', crop: 'コシヒカリ (BL)', area: 50, nPer10a: 5.6, yieldPer10a: 562 },
  { id: 'DEMO-4', name: '④ 川向4号(参考)', crop: 'つきあかり', area: 35, nPer10a: 6.4, yieldPer10a: 571 },
  { id: 'DEMO-5', name: '⑤ 上山田A(参考)', crop: 'コシヒカリ (BL)', area: 15, nPer10a: 7.5, yieldPer10a: 554 },
  { id: 'DEMO-6', name: '⑥ 上山田B(参考)', crop: 'コシヒカリ (BL)', area: 18, nPer10a: 8.6, yieldPer10a: 520 },
  { id: 'DEMO-7', name: '⑦ 棚田C(参考)', crop: 'コシヒカリ (BL)', area: 22, nPer10a: 2.4, yieldPer10a: 455 }
];

/**
 * TSK-036-1: 圃場別チッソ量 (x: kg/10a) ・反収 (y: kg/10a) ペア集計
 */
function collectNitrogenYieldPairs(cropFilter = 'ALL', useDemo = false) {
  if (useDemo) {
    return REGRESSION_DEMO_POINTS.filter(p => cropFilter === 'ALL' || p.crop === cropFilter);
  }
  const pairs = [];
  (fieldsData || []).forEach(f => {
    if (!f || !f.area || f.area <= 0) return;
    if (cropFilter !== 'ALL' && f.crop !== cropFilter) return;
    const x = Number(f.nPer10a || 0);
    const harvestKg = Number(f.harvestKg || 0);
    const y = harvestKg > 0 ? Math.round((harvestKg / (f.area / 10)) * 10) / 10 : 0;
    if (x > 0 && y > 0) {
      pairs.push({
        id: f.id,
        name: f.name,
        crop: f.crop || '',
        area: f.area,
        nPer10a: Math.round(x * 100) / 100,
        yieldPer10a: y
      });
    }
  });
  return pairs;
}

/**
 * TSK-036-2: 最小二乗法による二次曲線回帰 (y = a x^2 + b x + c)
 * @param {Array<{nPer10a:number, yieldPer10a:number}>} points
 */
function computeQuadraticRegression(points) {
  const n = Array.isArray(points) ? points.length : 0;
  if (n < 3) {
    return { valid: false, reason: '二次回帰分析には「施肥量(N)と収穫反収の両方が記録された圃場」が最低3筆必要です。', n };
  }

  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0;
  let sy = 0, sxy = 0, sx2y = 0;
  points.forEach(p => {
    const x = Number(p.nPer10a);
    const y = Number(p.yieldPer10a);
    const x2 = x * x;
    sx += x;
    sx2 += x2;
    sx3 += x2 * x;
    sx4 += x2 * x2;
    sy += y;
    sxy += x * y;
    sx2y += x2 * y;
  });

  // 正規方程式 M * [c, b, a]^T = rhs を部分ピボット付きガウス消去法で解く
  const M = [
    [n, sx, sx2, sy],
    [sx, sx2, sx3, sxy],
    [sx2, sx3, sx4, sx2y]
  ];

  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-10) {
      return { valid: false, reason: 'チッソ施肥量のばらつきが小さいため二次曲線を一意に決定できません。', n };
    }
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }
    const diag = M[col][col];
    for (let j = col; j < 4; j++) M[col][j] /= diag;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j < 4; j++) M[r][j] -= factor * M[col][j];
    }
  }

  const c = M[0][3];
  const b = M[1][3];
  const a = M[2][3];

  // 決定係数 R^2
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  points.forEach(p => {
    const x = Number(p.nPer10a);
    const y = Number(p.yieldPer10a);
    const yHat = a * x * x + b * x + c;
    ssTot += (y - meanY) * (y - meanY);
    ssRes += (y - yHat) * (y - yHat);
  });
  const r2 = ssTot > 1e-9 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

  // 頂点（最適施肥量）: a < 0 のとき上に凸の最大値
  const isConcaveDown = a < -1e-6;
  let optX = null;
  let optY = null;
  if (isConcaveDown) {
    optX = -b / (2 * a);
    optY = a * optX * optX + b * optX + c;
  } else {
    // 単調増加・下に凸の場合は実測最高反収の点を参考最適値とする
    const best = points.reduce((acc, cur) => (cur.yieldPer10a > acc.yieldPer10a ? cur : acc), points[0]);
    optX = best.nPer10a;
    optY = best.yieldPer10a;
  }

  return {
    valid: true,
    n,
    a,
    b,
    c,
    r2: Math.round(r2 * 1000) / 1000,
    isConcaveDown,
    optX: Math.round(optX * 100) / 100,
    optY: Math.round(optY * 10) / 10,
    predict: (x) => a * x * x + b * x + c
  };
}

/**
 * TSK-036-4: 最適チッソ量に対する各圃場の診断
 */
function diagnoseNitrogenStatus(point, optX, tolerance = 0.8) {
  const diff = Math.round((point.nPer10a - optX) * 100) / 100;
  if (diff > tolerance) {
    return {
      status: 'excess',
      label: '🔴 過剰施肥',
      badgeClass: 'bg-red-100 text-red-700 border-red-300',
      color: '#ef4444',
      diff,
      advice: `最適値より +${diff.toFixed(2)}kg 超過。倒伏・タンパク上昇リスクあり（次作は -${diff.toFixed(1)}kg 減肥推奨）。`
    };
  }
  if (diff < -tolerance) {
    return {
      status: 'deficit',
      label: '🔵 施肥不足',
      badgeClass: 'bg-sky-100 text-sky-700 border-sky-300',
      color: '#0284c7',
      diff,
      advice: `最適値より ${Math.abs(diff).toFixed(2)}kg 不足。穂肥・基肥を +${Math.abs(diff).toFixed(1)}kg 補うことで増収余地あり。`
    };
  }
  return {
    status: 'optimal',
    label: '🟢 適正範囲',
    badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    color: '#10b981',
    diff,
    advice: '最適施肥ピーク付近の理想的なバランスです。現行の施肥設計を維持してください。'
  };
}

function toggleRegressionDemoMode() {
  window._regressionUseDemoData = !window._regressionUseDemoData;
  renderNitrogenRegressionDashboard();
}

/**
 * TSK-036-3 & TSK-036-4: ダッシュボード描画（SVGグラフ + KPI + 診断テーブル）
 */
function renderNitrogenRegressionDashboard() {
  const container = document.getElementById('regressionDashboardBody');
  if (!container) return;

  const cropSel = document.getElementById('regressionCropFilter');
  if (cropSel) {
    const curVal = cropSel.value || 'ALL';
    const crops = [...new Set([
      ...(fieldsData || []).map(f => f.crop).filter(Boolean),
      ...(window._regressionUseDemoData ? REGRESSION_DEMO_POINTS.map(p => p.crop) : [])
    ])];
    cropSel.innerHTML = [
      '<option value="ALL">すべての品種（全圃場）</option>',
      ...crops.map(c => safeHtml`<option value="${c}">🌾 ${c}</option>`)
    ].join('');
    cropSel.value = [...cropSel.options].some(o => o.value === curVal) ? curVal : 'ALL';
  }
  const cropFilter = cropSel ? cropSel.value : 'ALL';

  const demoBtn = document.getElementById('regressionDemoToggleBtn');
  if (demoBtn) {
    demoBtn.textContent = window._regressionUseDemoData
      ? '✅ デモ試算モード中（実データへ戻す）'
      : '📊 サンプル7筆で回帰曲線を試算';
    demoBtn.className = window._regressionUseDemoData
      ? 'px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 transition'
      : 'px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--secondary)] text-[var(--secondary-foreground)] border border-[var(--border)] hover:opacity-80 transition';
  }

  const points = collectNitrogenYieldPairs(cropFilter, window._regressionUseDemoData);
  const reg = computeQuadraticRegression(points);

  if (!reg.valid) {
    container.innerHTML = safeHtml`
      <div class="p-6 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center space-y-3">
        <div class="text-sm font-bold text-slate-700">📈 二次回帰分析に十分なデータがありません（現在 ${reg.n} 筆）</div>
        <p class="text-xs text-slate-600">${reg.reason}</p>
        <p class="text-xs text-slate-500">タブ1「現場一括入力」で各圃場の「施肥」と「収穫」を記録するか、右上の「📊 サンプル7筆で回帰曲線を試算」ボタンで分析デモを確認できます。</p>
      </div>
    `;
    return;
  }

  const diagnosed = points.map(p => ({ ...p, diag: diagnoseNitrogenStatus(p, reg.optX) }));
  const excessCnt = diagnosed.filter(d => d.diag.status === 'excess').length;
  const deficitCnt = diagnosed.filter(d => d.diag.status === 'deficit').length;
  const optCnt = diagnosed.filter(d => d.diag.status === 'optimal').length;

  // SVG 散布図・回帰曲線の座標計算
  const W = 720, H = 330;
  const padL = 62, padR = 28, padT = 26, padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xs = points.map(p => p.nPer10a).concat(reg.isConcaveDown ? [reg.optX] : []);
  const ys = points.map(p => p.yieldPer10a).concat(reg.isConcaveDown ? [reg.optY] : []);
  const minX = Math.max(0, Math.floor(Math.min(...xs) - 1));
  const maxX = Math.ceil(Math.max(...xs) + 1.2);
  const minY = Math.max(0, Math.floor((Math.min(...ys) - 40) / 20) * 20);
  const maxY = Math.ceil((Math.max(...ys) + 40) / 20) * 20;

  const mapX = (x) => padL + ((x - minX) / Math.max(0.1, maxX - minX)) * plotW;
  const mapY = (y) => padT + plotH - ((y - minY) / Math.max(1, maxY - minY)) * plotH;

  // 滑らかな二次曲線パス生成
  const curveSteps = 60;
  const curvePts = [];
  for (let i = 0; i <= curveSteps; i++) {
    const xv = minX + ((maxX - minX) * i) / curveSteps;
    const yv = reg.predict(xv);
    if (yv >= minY - 20 && yv <= maxY + 20) {
      curvePts.push(`${mapX(xv).toFixed(1)},${mapY(Math.max(minY, Math.min(maxY, yv))).toFixed(1)}`);
    }
  }
  const curvePath = curvePts.length > 1 ? `M ${curvePts.join(' L ')}` : '';

  // グリッド線
  let gridSvg = '';
  for (let i = 0; i <= 4; i++) {
    const yVal = minY + ((maxY - minY) * i) / 4;
    const yp = mapY(yVal);
    gridSvg += `<line x1="${padL}" y1="${yp}" x2="${W - padR}" y2="${yp}" stroke="#e2e8f0" stroke-dasharray="3,3" />`;
    gridSvg += `<text x="${padL - 8}" y="${yp + 4}" text-anchor="end" font-size="11" fill="#475569">${Math.round(yVal)}</text>`;
  }
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const xVal = minX + ((maxX - minX) * i) / xTicks;
    const xp = mapX(xVal);
    gridSvg += `<line x1="${xp}" y1="${padT}" x2="${xp}" y2="${H - padB}" stroke="#e2e8f0" stroke-dasharray="3,3" />`;
    gridSvg += `<text x="${xp}" y="${H - padB + 18}" text-anchor="middle" font-size="11" fill="#475569">${xVal.toFixed(1)}</text>`;
  }

  // 最適施肥帯ハイライト
  const bandX1 = Math.max(padL, mapX(reg.optX - 0.8));
  const bandX2 = Math.min(W - padR, mapX(reg.optX + 0.8));
  const bandSvg = `<rect x="${bandX1}" y="${padT}" width="${Math.max(2, bandX2 - bandX1)}" height="${plotH}" fill="#10b981" fill-opacity="0.12" />`;

  // 頂点ピン
  const optPx = mapX(reg.optX);
  const optPy = mapY(reg.optY);
  const peakSvg = `
    <line x1="${optPx}" y1="${optPy}" x2="${optPx}" y2="${H - padB}" stroke="#059669" stroke-width="1.5" stroke-dasharray="4,3" />
    <circle cx="${optPx}" cy="${optPy}" r="7" fill="#059669" stroke="#ffffff" stroke-width="2" />
    <rect x="${Math.min(W - 185, Math.max(padL + 4, optPx - 82))}" y="${Math.max(padT + 2, optPy - 34)}" width="166" height="24" rx="6" fill="#065f46" />
    <text x="${Math.min(W - 102, Math.max(padL + 87, optPx + 1))}" y="${Math.max(padT + 18, optPy - 18)}" text-anchor="middle" font-size="11" font-weight="bold" fill="#ffffff">
      ★ 最適 N=${reg.optX.toFixed(2)}kg → ${reg.optY.toFixed(0)}kg
    </text>
  `;

  // データ点プロット
  const dotsSvg = diagnosed.map(d => {
    const cx = mapX(d.nPer10a);
    const cy = mapY(d.yieldPer10a);
    const clickableAttr = !window._regressionUseDemoData
      ? `data-action="inspectFieldFromRegression" data-arg="${escapeHtml(d.id)}" style="cursor:pointer"`
      : '';
    return `
      <g ${clickableAttr}>
        <circle cx="${cx}" cy="${cy}" r="6.5" fill="${d.diag.color}" stroke="#ffffff" stroke-width="2">
          <title>${escapeHtml(d.name)} | N: ${d.nPer10a}kg/10a | 反収: ${d.yieldPer10a}kg/10a (${escapeHtml(d.diag.label)})</title>
        </circle>
        <text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="10" font-weight="bold" fill="#1e293b">${escapeHtml(d.name.slice(0, 7))}</text>
      </g>
    `;
  }).join('');

  const svgHtml = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto bg-white rounded-xl border border-slate-300">
      ${bandSvg}
      ${gridSvg}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />
      <path d="${curvePath}" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" />
      ${peakSvg}
      ${dotsSvg}
      <text x="${padL + plotW / 2}" y="${H - 10}" text-anchor="middle" font-size="12" font-weight="bold" fill="#334155">10aあたり累計チッソ(N)施肥量 (kg / 10a)</text>
      <text x="16" y="${padT + plotH / 2}" text-anchor="middle" font-size="12" font-weight="bold" fill="#334155" transform="rotate(-90 16 ${padT + plotH / 2})">10aあたり反収 (kg / 10a)</text>
    </svg>
  `;

  const rowsHtml = diagnosed.map(d => safeHtml`
    <tr>
      <td class="border border-slate-300 p-2 font-bold">${d.name}</td>
      <td class="border border-slate-300 p-2">${d.crop}</td>
      <td class="border border-slate-300 p-2 text-right font-mono font-bold">${d.nPer10a.toFixed(2)} kg</td>
      <td class="border border-slate-300 p-2 text-right font-mono font-bold">${d.yieldPer10a.toFixed(1)} kg (${(d.yieldPer10a / 60).toFixed(1)}俵)</td>
      <td class="border border-slate-300 p-2 text-right font-mono">${d.diag.diff >= 0 ? '+' : ''}${d.diag.diff.toFixed(2)} kg</td>
      <td class="border border-slate-300 p-2 text-center">
        <span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${d.diag.badgeClass}">${d.diag.label}</span>
      </td>
      <td class="border border-slate-300 p-2 text-xs text-slate-700">${d.diag.advice}</td>
    </tr>
  `).join('');

  const eqSignB = reg.b >= 0 ? '+' : '-';
  const eqSignC = reg.c >= 0 ? '+' : '-';
  const eqText = `y = ${reg.a.toFixed(2)}x² ${eqSignB} ${Math.abs(reg.b).toFixed(2)}x ${eqSignC} ${Math.abs(reg.c).toFixed(1)}`;

  container.innerHTML = safeHtml`
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
        <div class="text-[11px] font-bold text-emerald-700">🌟 最適チッソ施肥量 (ピーク)</div>
        <div class="text-xl font-extrabold text-emerald-800 mt-0.5">${reg.optX.toFixed(2)} <span class="text-xs font-normal">kg/10a</span></div>
        <div class="text-[11px] text-emerald-700/80">${reg.isConcaveDown ? '収穫逓減ピークを自動検出' : '実測最高反収ベース参照'}</div>
      </div>
      <div class="p-3 rounded-xl bg-sky-50 border border-sky-200">
        <div class="text-[11px] font-bold text-sky-700">🌾 予測最大反収</div>
        <div class="text-xl font-extrabold text-sky-800 mt-0.5">${reg.optY.toFixed(1)} <span class="text-xs font-normal">kg/10a</span></div>
        <div class="text-[11px] text-sky-700/80">約 ${(reg.optY / 60).toFixed(1)} 俵 / 10a</div>
      </div>
      <div class="p-3 rounded-xl bg-slate-50 border border-slate-200">
        <div class="text-[11px] font-bold text-slate-700">📐 回帰適合度 (決定係数 R²)</div>
        <div class="text-xl font-extrabold text-slate-800 mt-0.5">${(reg.r2 * 100).toFixed(1)}%</div>
        <div class="text-[10px] font-mono text-slate-500 truncate">${eqText}</div>
      </div>
      <div class="p-3 rounded-xl bg-amber-50 border border-amber-200">
        <div class="text-[11px] font-bold text-amber-800">⚠️ 改善アラート対象</div>
        <div class="text-sm font-bold text-slate-800 mt-1">
          <span class="text-red-600">過剰 ${excessCnt}筆</span> ／
          <span class="text-sky-600">不足 ${deficitCnt}筆</span> ／
          <span class="text-emerald-600">適正 ${optCnt}筆</span>
        </div>
        <div class="text-[11px] text-amber-800/80">対象 ${reg.n} 筆（許容幅 ±0.8kg）</div>
      </div>
    </div>

    <div class="mb-4">
      ${rawHtml(svgHtml)}
      <div class="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-slate-600">
        <span>🟢 緑帯: 最適施肥ゾーン (${Math.max(0, reg.optX - 0.8).toFixed(1)}〜${(reg.optX + 0.8).toFixed(1)} kg/10a)</span>
        <span>🔴 赤点: 過剰施肥（倒伏・食味低下リスク）</span>
        <span>🔵 青点: 施肥不足（増収余地）</span>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full border-collapse border border-slate-300 text-xs text-slate-900">
        <thead>
          <tr class="bg-slate-100">
            <th class="border border-slate-300 p-2 text-left">圃場名</th>
            <th class="border border-slate-300 p-2 text-left">品種</th>
            <th class="border border-slate-300 p-2 text-right">累計N (10a)</th>
            <th class="border border-slate-300 p-2 text-right">実績反収</th>
            <th class="border border-slate-300 p-2 text-right">最適値乖離</th>
            <th class="border border-slate-300 p-2 text-center">診断判定</th>
            <th class="border border-slate-300 p-2 text-left">AI施肥改善アドバイス</th>
          </tr>
        </thead>
        <tbody>
          ${rawHtml(rowsHtml)}
        </tbody>
      </table>
    </div>
  `;
}

function inspectFieldFromRegression(fieldId) {
  if (!fieldId || String(fieldId).startsWith('DEMO-')) return;
  switchMainTab('gis');
  inspectField(fieldId);
}
