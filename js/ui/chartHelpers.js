// =========================================================================
// UI Helpers: RF-20 共通 SVG チャート＆AI分析UIヘルパー (js/ui/chartHelpers.js)
//   - 品種フィルタ <select> 同期、デモ試算ボタン切替、SVG座標スケール・軸/グリッド描画
// =========================================================================

/**
 * 分析ダッシュボード用の品種フィルタ <select> 選択肢を最新化し、現在選択値を維持する
 */
function syncCropFilterSelect_(selectId, extraItems = []) {
  const sel = document.getElementById(selectId);
  if (!sel) return 'ALL';
  const curVal = sel.value || 'ALL';
  const crops = [...new Set([
    ...(fieldsData || []).map(f => f && f.crop).filter(Boolean),
    ...(extraItems || []).map(p => p && p.crop).filter(Boolean)
  ])];
  sel.innerHTML = [
    '<option value="ALL">すべての品種（全圃場）</option>',
    ...crops.map(c => safeHtml`<option value="${c}">🌾 ${c}</option>`)
  ].join('');
  sel.value = [...sel.options].some(o => o.value === curVal) ? curVal : 'ALL';
  return sel.value;
}

/**
 * 分析ダッシュボードの「サンプルデータで試算」トグルボタンの表示を統一更新する
 */
function updateDemoToggleButton_(btnId, isDemo, activeLabel, idleLabel) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.textContent = isDemo ? activeLabel : idleLabel;
  btn.className = isDemo
    ? 'px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 transition'
    : 'px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300 hover:opacity-80 transition';
}

/**
 * 線形スケール関数を生成する（SVG座標変換用）
 */
function createLinearScale_(domainMin, domainMax, rangeStart, rangeEnd) {
  const span = Math.max(1e-6, domainMax - domainMin);
  return (val) => rangeStart + ((val - domainMin) / span) * (rangeEnd - rangeStart);
}

/**
 * SVG の破線グリッド線・X/Y軸線・目盛りラベルを一括生成する
 */
function renderSvgAxesAndGrid_(opts) {
  const {
    W, H, padL, padR, padT, padB,
    minX, maxX, minY, maxY,
    xSteps = 5, ySteps = 4,
    xFormatter = (v) => v.toFixed(1),
    yFormatter = (v) => String(Math.round(v)),
    dashArray = '3,3'
  } = opts;
  const mapX = createLinearScale_(minX, maxX, padL, W - padR);
  const mapY = createLinearScale_(minY, maxY, H - padB, padT);

  let svg = '';
  for (let i = 0; i <= ySteps; i++) {
    const yv = minY + ((maxY - minY) * i) / ySteps;
    const yp = mapY(yv);
    svg += `<line x1="${padL}" y1="${yp.toFixed(1)}" x2="${W - padR}" y2="${yp.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="${dashArray}" />`;
    svg += `<text x="${padL - 8}" y="${(yp + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#475569">${escapeHtml(yFormatter(yv))}</text>`;
  }
  for (let i = 0; i <= xSteps; i++) {
    const xv = minX + ((maxX - minX) * i) / xSteps;
    const xp = mapX(xv);
    svg += `<line x1="${xp.toFixed(1)}" y1="${padT}" x2="${xp.toFixed(1)}" y2="${H - padB}" stroke="#e2e8f0" stroke-dasharray="${dashArray}" />`;
    svg += `<text x="${xp.toFixed(1)}" y="${H - padB + 17}" text-anchor="middle" font-size="10.5" fill="#475569">${escapeHtml(xFormatter(xv))}</text>`;
  }
  svg += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />`;
  svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#64748b" stroke-width="1.5" />`;
  return { svg, mapX, mapY };
}
