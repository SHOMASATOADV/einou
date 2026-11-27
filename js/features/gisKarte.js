// Feature: GIS SVG Heatmap, Field Karte, GDD & Patrol Alerts (RF-21B)
function setHeatmapLayer(layer) {
  currentHeatmapLayer = layer;
  ['all', '耕起', '草刈り', '施肥', '防除', 'temp'].forEach(l => {
    const btn = document.getElementById('heatBtn-' + l);
    if (!btn) return;
    if (l === layer) {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white';
    } else {
      btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--secondary)] text-[var(--secondary-foreground)]';
    }
  });
  renderGisHeatmap();
}

function getFieldHeatmapStyle_(f) {
  let color = '#64748b';
  let label = f.stage;

  if (currentHeatmapLayer === 'temp') {
    const tStats = calcAccumulatedTempStats(f);
    color = tStats.statusColor;
    label = `${tStats.accumulatedC}℃ (${tStats.statusLabel})`;
  } else if (currentHeatmapLayer === 'all') {
    if (f.doneCats.length >= 3) color = '#10b981';
    else if (f.doneCats.length >= 1) color = '#f59e0b';
  } else {
    if (f.doneCats.includes(currentHeatmapLayer)) {
      color = '#10b981';
      label = `${currentHeatmapLayer} 完了`;
    } else {
      color = '#64748b';
      label = `${currentHeatmapLayer} 未実施`;
    }
  }
  if (Array.isArray(f.alerts) && f.alerts.length > 0) {
    label = `⚠️ ${label}`;
  }
  return { color, label };
}

// F08以降の新規圃場・GeoJSONインポート圃場をSVGマップ下段右エリアへ動的配置・ポリゴン描画
function renderDynamicGisPolygons_() {
  const dynGroup = document.getElementById('gisDynamicPolygonGroup');
  if (!dynGroup) return;

  const staticIds = new Set(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07']);
  const dynamicFields = fieldsData.filter(f => !staticIds.has(f.id));
  if (dynamicFields.length === 0) {
    dynGroup.innerHTML = '';
    return;
  }

  const cols = Math.min(3, Math.max(2, Math.ceil(Math.sqrt(dynamicFields.length))));
  const boxX0 = 310, boxY0 = 265, boxW = 435, boxH = 160;
  const cellW = Math.floor(boxW / cols);
  const rows = Math.ceil(dynamicFields.length / cols);
  const cellH = Math.min(68, Math.floor(boxH / Math.max(1, rows)));

  const svgItems = [
    `<text x="${boxX0}" y="${boxY0 - 8}" fill="#a7f3d0" font-size="11" font-weight="bold">🆕 追加・GeoJSON移行圃場エリア（${dynamicFields.length}筆）</text>`
  ];

  dynamicFields.forEach((f, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = boxX0 + col * cellW + 4;
    const y = boxY0 + row * cellH + 4;
    const w = cellW - 10;
    const h = cellH - 8;
    const cx = Math.round(x + w / 2);
    const cy = Math.round(y + h / 2);

    // GeoJSON頂点座標（polygonCoords: [[lng,lat], ...]）がある場合は実形状をセル内に正規化投影
    let pointsStr = `${x},${y} ${x + w},${y} ${x + w - 4},${y + h} ${x},${y + h}`;
    if (Array.isArray(f.polygonCoords) && f.polygonCoords.length >= 3) {
      const lngs = f.polygonCoords.map(p => Number(p[0])).filter(n => !isNaN(n));
      const lats = f.polygonCoords.map(p => Number(p[1])).filter(n => !isNaN(n));
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const spanLng = Math.max(1e-6, maxLng - minLng);
      const spanLat = Math.max(1e-6, maxLat - minLat);
      pointsStr = f.polygonCoords.map(p => {
        const px = Math.round(x + 6 + ((Number(p[0]) - minLng) / spanLng) * (w - 12));
        const py = Math.round(y + h - 6 - ((Number(p[1]) - minLat) / spanLat) * (h - 12));
        return `${px},${py}`;
      }).join(' ');
    }

    const { color, label } = getFieldHeatmapStyle_(f);
    const selCls = f.id === currentInspectedFieldId ? ' field-selected' : '';
    const shortName = f.name.length > 10 ? f.name.slice(0, 10) + '…' : f.name;

    svgItems.push(`
      <g data-action="inspectField" data-arg="${escapeHtml(f.id)}" class="field-polygon" id="poly-${escapeHtml(f.id)}">
        <polygon points="${pointsStr}" fill="${color}" fill-opacity="0.8" stroke="#ffffff" stroke-width="2" class="${selCls.trim()}"/>
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="bold">${escapeHtml(shortName)} (${escapeHtml(f.area)}a)</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="#f1f5f9" font-size="10" id="polyStatus-${escapeHtml(f.id)}">${escapeHtml(label)}</text>
      </g>
    `);
  });

  dynGroup.innerHTML = svgItems.join('');
}

function renderGisHeatmap() {
  renderDynamicGisPolygons_();

  fieldsData.forEach(f => {
    const polyGroup = document.getElementById('poly-' + f.id);
    if (!polyGroup) return;
    const poly = polyGroup.querySelector('polygon');
    const statusTxt = document.getElementById('polyStatus-' + f.id);
    const { color, label } = getFieldHeatmapStyle_(f);

    poly.setAttribute('fill', color);
    statusTxt.textContent = label;

    if (f.id === currentInspectedFieldId) {
      poly.classList.add('field-selected');
    } else {
      poly.classList.remove('field-selected');
    }
  });

  const pillList = document.getElementById('gisFieldPillList');
  if (pillList) {
    pillList.innerHTML = fieldsData.map(f => {
      const isCur = f.id === currentInspectedFieldId;
      const alertMark = Array.isArray(f.alerts) && f.alerts.length > 0 ? ` ⚠️${f.alerts.length}` : '';
      return `<button data-action="inspectField" data-arg="${escapeHtml(f.id)}" class="px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
        isCur ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--border)]'
      }">${escapeHtml(f.name)}${alertMark} (${escapeHtml(f.area)}a)</button>`;
    }).join('');
  }
  refreshInteractiveMaps_();
}

function inspectField(fieldId) {
  currentInspectedFieldId = fieldId;
  renderGisHeatmap();

  const f = fieldsData.find(item => item.id === fieldId) || fieldsData[0];
  if (!f) {
    if (document.getElementById('karteTitle')) {
      document.getElementById('karteTitle').textContent = '圃場未登録（新規追加またはデータ移行から登録してください）';
    }
    if (document.getElementById('karteArea')) document.getElementById('karteArea').textContent = '-';
    if (document.getElementById('karteCrop')) document.getElementById('karteCrop').textContent = '-';
    if (document.getElementById('karteHarvest')) document.getElementById('karteHarvest').textContent = '-';
    if (document.getElementById('karteHistoryList')) {
      document.getElementById('karteHistoryList').innerHTML = `<div class="p-4 rounded-xl bg-[var(--background)] border border-[var(--border)] text-xs text-[var(--muted-foreground)]">圃場がまだ登録されていません。</div>`;
    }
    return;
  }
  document.getElementById('karteTitle').textContent = `${f.name} (${f.lot})`;
  document.getElementById('karteArea').textContent = `${f.area} a (${(f.area / 10).toFixed(1)} 反)`;
  document.getElementById('karteCrop').textContent = f.crop;
  document.getElementById('karteHarvest').textContent = f.harvest;

  // 機能①：出穂後積算温度（1,000℃）＆刈取適期予測
  const tStats = calcAccumulatedTempStats(f);
  const headingInput = document.getElementById('karteHeadingDateInput');
  if (headingInput) {
    headingInput.value = String(tStats.headingDate || '2026/08/05').replace(/\//g, '-');
  }
  const tempBadge = document.getElementById('karteTempBadge');
  if (tempBadge) {
    tempBadge.textContent = tStats.statusLabel;
    tempBadge.style.backgroundColor = `${tStats.statusColor}22`;
    tempBadge.style.color = tStats.statusColor;
  }
  const tempText = document.getElementById('karteTempText');
  if (tempText) {
    tempText.textContent = `出穂後${tStats.elapsedDays}日 ／ ${tStats.accumulatedC}℃ (目標 ${tStats.targetC}℃)`;
  }
  const tempBar = document.getElementById('karteTempBar');
  if (tempBar) {
    tempBar.style.width = `${tStats.progressPct}%`;
    tempBar.style.backgroundColor = tStats.statusColor;
  }
  const predText = document.getElementById('kartePredictedHarvestText');
  if (predText) {
    predText.textContent = tStats.remainingDays > 0
      ? `🌾 1,000℃到達（刈取適期）予測: ${tStats.predictedHarvestDate}（あと約 ${tStats.remainingDays} 日 ／ 日平均 ${tStats.meanTemp}℃換算）`
      : `🌾 刈取適期（${tStats.targetC}℃）に到達しています（予測適期日: ${tStats.predictedHarvestDate}）`;
  }

  // TSK-038: 気象API自動連携＆高温・病害虫AI予察カード更新
  if (typeof renderFieldWeatherCard === 'function') {
    renderFieldWeatherCard(f.id);
  }

  // 機能③：現地見回りメモ＆被害・生育アラート
  if (!Array.isArray(f.alerts)) f.alerts = [];
  const alertCntBadge = document.getElementById('karteAlertCountBadge');
  if (alertCntBadge) {
    alertCntBadge.textContent = f.alerts.length > 0 ? `⚠️ 未解決 ${f.alerts.length}件` : '異常なし (0件)';
    alertCntBadge.className = f.alerts.length > 0
      ? 'px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-600 border border-amber-500/40'
      : 'px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600';
  }
  const alertListEl = document.getElementById('karteAlertList');
  if (alertListEl) {
    if (f.alerts.length === 0) {
      alertListEl.innerHTML = `<div class="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--border)] text-xs text-[var(--muted-foreground)]">現在ピン留めされた被害・見回りアラートはありません。</div>`;
    } else {
      alertListEl.innerHTML = f.alerts.map(a => safeHtml`
        <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-between gap-2 text-xs">
          <div>
            <span class="font-bold text-amber-700">${a.text || a.tag || ''}</span>
            <span class="text-[var(--muted-foreground)] ml-1.5">(${a.date || ''})</span>
          </div>
          <button data-action="resolveFieldAlert" data-arg="${f.id}" data-arg2="${a.id}" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition shrink-0">
            ✅ 解決済
          </button>
        </div>
      `).join('');
    }
  }

  const totalN = (f.nPer10a * (f.area / 10)).toFixed(1);
  const totalP = (f.pPer10a * (f.area / 10)).toFixed(1);
  const totalK = (f.kPer10a * (f.area / 10)).toFixed(1);

  document.getElementById('karteNText').textContent = `${f.nPer10a.toFixed(2)} kg / 10a (圃場総量 ${totalN} kg)`;
  document.getElementById('kartePText').textContent = `${f.pPer10a.toFixed(2)} kg / 10a (圃場総量 ${totalP} kg)`;
  document.getElementById('karteKText').textContent = `${f.kPer10a.toFixed(2)} kg / 10a (圃場総量 ${totalK} kg)`;

  document.getElementById('karteNBar').style.width = Math.min(100, Math.round((f.nPer10a / 6.0) * 100)) + '%';
  document.getElementById('kartePBar').style.width = Math.min(100, Math.round((f.pPer10a / 6.0) * 100)) + '%';
  document.getElementById('karteKBar').style.width = Math.min(100, Math.round((f.kPer10a / 6.0) * 100)) + '%';

  const fieldLogs = workLogs.filter(l => (l.fieldIds || []).includes(fieldId));
  const histContainer = document.getElementById('karteHistoryList');

  if (fieldLogs.length === 0) {
    histContainer.innerHTML = `<div class="p-4 rounded-xl bg-[var(--background)] border border-[var(--border)] text-xs text-[var(--muted-foreground)]">まだ作業履歴がありません。</div>`;
  } else {
    histContainer.innerHTML = fieldLogs.map(l => {
      const ratio = logAreaRatio_(l, f);
      const allocHr = ((Number(l.duration) || 0) * ratio).toFixed(2);
      const weatherInfo = l.weather ? ` ／ ${formatWeatherSummary_(l)}` : '';
      const syncedBadge = l.synced ? '' : rawHtml(' <span class="text-amber-600 font-semibold">(未同期)</span>');
      const memoHtml = l.memo
        ? rawHtml(safeHtml`<div class="mt-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800">📔 ${l.memo}</div>`)
        : '';
      return safeHtml`
        <div class="p-3 rounded-xl bg-[var(--background)] border border-[var(--border)] text-xs">
          <div class="flex items-center justify-between font-bold text-[var(--foreground)]">
            <span>📅 ${l.date} — ${l.cat}${weatherInfo}${syncedBadge}</span>
            <span class="text-emerald-600">按分時間: ${allocHr}h</span>
          </div>
          <div class="text-[var(--muted-foreground)] mt-1">${l.materialSummary}</div>
          <div class="text-[var(--muted-foreground)] mt-0.5">作業者: ${l.worker} ／ 機械: ${l.machineName}</div>
          ${memoHtml}
          <div class="flex justify-end gap-1.5 mt-2">
            <button data-action="editWorkLog" data-arg="${l.id}" class="px-2 py-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] font-semibold hover:opacity-80">✏️ 修正</button>
            <button data-action="deleteWorkLog" data-arg="${l.id}" class="px-2 py-0.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 font-semibold hover:bg-red-500/20">🗑️ 取消</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function jumpToInputWithField() {
  selectedFieldIds = [currentInspectedFieldId];
  renderInputFieldGrid();
  recalculatePreview();
  switchMainTab('input');
}

function updateFieldHeadingDate(newDateVal) {
  const f = fieldsData.find(item => item.id === currentInspectedFieldId);
  if (!f || !newDateVal) return;
  f.headingDate = newDateVal.replace(/-/g, '/');
  const tStats = calcAccumulatedTempStats(f);
  f.harvest = tStats.predictedHarvestDate;
  saveStateToStorage();
  refreshAllViews();
  showToast(`🌡️ ${f.name} の出穂日を ${f.headingDate} に更新しました`, `1,000℃到達（刈取適期）予測日が ${tStats.predictedHarvestDate} に自動再計算されました。`);
}

function addFieldAlert() {
  const f = fieldsData.find(item => item.id === currentInspectedFieldId);
  if (!f) return;
  if (!Array.isArray(f.alerts)) f.alerts = [];
  const preset = document.getElementById('karteAlertPresetSelect')?.value || '⚠️ 現地確認メモ';
  const custom = (document.getElementById('karteAlertCustomInput')?.value || '').trim();
  const fullText = custom ? `${preset}（${custom}）` : preset;
  const newAlert = {
    id: 'AL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    date: getTodayIsoDate().replace(/-/g, '/'),
    text: fullText
  };
  f.alerts.unshift(newAlert);
  if (document.getElementById('karteAlertCustomInput')) {
    document.getElementById('karteAlertCustomInput').value = '';
  }
  saveStateToStorage();
  refreshAllViews();
  showToast(`📸 ${f.name} に見回りアラートをピン留めしました`, `${fullText}（GISマップと圃場タイルに⚠️マークを表示）`);
}

function resolveFieldAlert(fieldId, alertId) {
  const f = fieldsData.find(item => item.id === fieldId);
  if (!f || !Array.isArray(f.alerts)) return;
  const target = f.alerts.find(a => a.id === alertId);
  f.alerts = f.alerts.filter(a => a.id !== alertId);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ ${f.name} のアラートを解決済にしました`, target ? target.text : '');
}

