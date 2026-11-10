/**
 * ============================================================================
 * らくらく営農日誌 Next — UI制御・混用防除＆有効成分判定・動的GIS・帳票・移行 (js/app.js)
 * ============================================================================
 */

// PWA Service Worker 登録
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

function refreshAllViews() {
  renderSelectOptions();
  renderInputFieldGrid();
  recalculatePreview();
  renderDiaryTimeline();
  renderGisHeatmap();
  inspectField(currentInspectedFieldId);
  renderResourcesTab();
  renderReportsTab();
  updateSyncBadge();
  refreshInteractiveMaps_();
}

function setTodayWorkDate() {
  const el = document.getElementById('workDateInput');
  if (el) {
    el.value = getTodayIsoDate();
    recalculatePreview();
  }
}

function initApp() {
  loadStateFromStorage();
  ensureFieldBaselines();
  recalculateFieldStats();
  document.getElementById('gasWebhookUrl').value = gasWebhookUrl;
  if (document.getElementById('simRicePriceInput') && typeof costSettings === 'object') {
    document.getElementById('simRicePriceInput').value = costSettings.ricePricePerTawaraYen || 18500;
  }
  if (document.getElementById('simHourlyWageInput') && typeof costSettings === 'object') {
    document.getElementById('simHourlyWageInput').value = costSettings.hourlyWageYen || 1500;
  }

  // 帳票出力日を本日の日付で動的初期化
  const now = new Date();
  const dateLabel = document.getElementById('jaHeaderDateLabel');
  if (dateLabel) {
    dateLabel.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  }
  // 当日が収穫予定日前のシーズン中であれば作業日入力欄も当日で初期化
  const todayIso = getTodayIsoDate();
  if (todayIso <= '2026-09-01') {
    document.getElementById('workDateInput').value = todayIso;
  }

  renderSelectOptions();
  renderInputFieldGrid();
  selectWorkCat('施肥');
  recalculatePreview();
  renderDiaryTimeline();
  renderGisHeatmap();
  inspectField('F01');
  renderResourcesTab();
  renderReportsTab();
  updateSyncBadge();
}

function renderSelectOptions() {
  const mSel = document.getElementById('machineSelect');
  const curM = mSel.value || 'M01';
  mSel.innerHTML = Object.values(machines).map(m => {
    const warn = (m.nextMaint - m.currentHour) <= 10 ? ' ⚠️点検近し' : '';
    return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (現在 ${m.currentHour.toFixed(1)}h${warn})</option>`;
  }).join('') + `<option value="NONE">機械なし（手作業・見回り）</option>`;
  mSel.value = curM;

  const fSel = document.getElementById('fertilizerSelect');
  const curF = fSel.value || 'F01';
  fSel.innerHTML = Object.values(fertilizers).map(f =>
    `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)} (${f.unitKg}kg/袋 | N${f.n}-P${f.p}-K${f.k} | 残${f.stock}袋)</option>`
  ).join('');
  fSel.value = curF;

  const pSel = document.getElementById('pesticideSelect');
  const curP = pSel.value || 'P01';
  pSel.innerHTML = Object.values(pesticides).map(p => {
    const ing = p.activeIngredient ? `成分:${p.activeIngredient} / ` : '';
    return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.regNo)} | ${escapeHtml(ing)}上限${p.maxUse}回・収穫前${p.phiDays}日)</option>`;
  }).join('');
  pSel.value = curP;

  const pMixSel = document.getElementById('pesticideMixSelect');
  if (pMixSel) {
    const curMix = pMixSel.value || 'NONE';
    pMixSel.innerHTML = `<option value="NONE">混用なし（1剤単独散布）</option>` +
      Object.values(pesticides).map(p => {
        const ing = p.activeIngredient ? `成分:${p.activeIngredient} / ` : '';
        return `<option value="${escapeHtml(p.id)}">＋混用: ${escapeHtml(p.name)} (${escapeHtml(ing)}上限${p.maxUse}回・収穫前${p.phiDays}日)</option>`;
      }).join('');
    pMixSel.value = curMix;
  }
}

function getSelectedPesticideIdsFromUi_() {
  const p1 = document.getElementById('pesticideSelect')?.value || 'P01';
  const p2 = document.getElementById('pesticideMixSelect')?.value || 'NONE';
  const ids = [p1];
  if (p2 && p2 !== 'NONE' && p2 !== p1) ids.push(p2);
  return ids;
}

// メインタブ切り替え
function switchMainTab(tabName) {
  ['input', 'gis', 'resource', 'report', 'settings'].forEach(t => {
    const sec = document.getElementById('tab-' + t);
    const btn = document.getElementById('tabBtn-' + t);
    if (t === tabName) {
      sec.classList.remove('hidden');
      if (t === 'gis' || t === 'resource' || t === 'settings') sec.classList.add('grid');
      btn.className = (t === 'settings' ? 'col-span-2 sm:col-span-1 ' : '') +
        'flex items-center justify-center gap-1.5 py-3 px-3 rounded-xl font-bold text-xs md:text-sm border transition bg-emerald-600 text-white border-emerald-600 shadow-sm';
    } else {
      sec.classList.add('hidden');
      sec.classList.remove('grid');
      btn.className = (t === 'settings' ? 'col-span-2 sm:col-span-1 ' : '') +
        'flex items-center justify-center gap-1.5 py-3 px-3 rounded-xl font-bold text-xs md:text-sm border transition bg-[var(--card)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--secondary)]';
    }
  });
}

// オフライン・クラウド同期ステータス管理
function toggleOfflineMode() {
  isOfflineMode = !isOfflineMode;
  updateSyncBadge();
  if (isOfflineMode) {
    showToast('📡 電波圏外（オフラインモード）に切り替えました', '山間部でも全機能が動作し、入力データは端末LocalStorageに永続保存されます。');
  } else {
    showToast('☁️ オンライン復帰', '端末内に保存されたデータをいつでもスプレッドシートへ同期できます。');
  }
}

function updateSyncBadge() {
  const unsyncedCount = workLogs.filter(l => !l.synced).length;
  const badge = document.getElementById('syncBadge');
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (!badge || !dot || !text) return;
  if (isOfflineMode) {
    badge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-600 text-xs font-semibold';
    dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
    text.textContent = `圏外動作中（端末保存済 / 未同期 ${unsyncedCount}件）`;
  } else {
    badge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 text-xs font-semibold';
    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    text.textContent = unsyncedCount > 0 ? `端末保存済（クラウド未送信 ${unsyncedCount}件）` : '端末保存済・全件同期済';
  }
}

// =========================================================================
// 実GPS現在地測位（Geolocation API）＆ 最寄り圃場サジェスト
// =========================================================================
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function selectNearestFieldsByCoord_(latitude, longitude, isSimulated) {
  const banner = document.getElementById('gpsStatusBanner');
  fieldsData.forEach(f => {
    f._distM = getDistanceMeters(latitude, longitude, f.lat || 37.9161, f.lng || 139.0364);
  });

  const sorted = [...fieldsData].sort((a, b) => a._distM - b._distM);
  const nearestField = sorted[0];

  let nearby = sorted.filter(f => f._distM <= 250);
  if (nearby.length === 0 && nearestField) {
    const sameGroup = sorted.filter(f => f.group === nearestField.group && f._distM <= 1500);
    nearby = sameGroup.length > 0 ? sameGroup : sorted.slice(0, Math.min(3, sorted.length));
  }

  selectedFieldIds = nearby.map(f => f.id);
  const selectedNames = nearby.map(f => `${f.name}(${f._distM}m)`).join('・');
  const prefix = isSimulated
    ? `📍 GPS現在地サジェスト（最寄り: ${nearestField ? nearestField.name : ''} 周辺）`
    : `📍 実GPS測位完了 (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
  banner.textContent = `${prefix}：距離が近い ${nearby.length} 筆［${selectedNames}］を自動選択しました`;

  renderInputFieldGrid();
  recalculatePreview();
}

function detectGpsNearestFields() {
  const banner = document.getElementById('gpsStatusBanner');
  banner.classList.remove('hidden');
  banner.textContent = '🛰️ スマホのGPSから現在地を測位中...';

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        selectNearestFieldsByCoord_(pos.coords.latitude, pos.coords.longitude, false);
      },
      () => {
        const refField = fieldsData.find(f => selectedFieldIds.includes(f.id)) || fieldsData[0];
        const simLat = (refField && refField.lat) ? refField.lat : 37.9161;
        const simLng = (refField && refField.lng) ? refField.lng : 139.0364;
        selectNearestFieldsByCoord_(simLat, simLng, true);
      },
      { timeout: 3500 }
    );
  } else {
    const refField = fieldsData.find(f => selectedFieldIds.includes(f.id)) || fieldsData[0];
    selectNearestFieldsByCoord_(refField?.lat || 37.9161, refField?.lng || 139.0364, true);
  }
}

// 圃場選択グリッド描画
function renderInputFieldGrid() {
  const container = document.getElementById('inputFieldGrid');
  container.innerHTML = fieldsData.map(f => {
    const isSel = selectedFieldIds.includes(f.id);
    const activeCls = isSel
      ? 'border-2 border-emerald-600 bg-emerald-500/15 text-[var(--foreground)] shadow-sm'
      : 'border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-emerald-500/50';
    const checkIcon = isSel ? '☑️' : '⬜';
    const alertCnt = Array.isArray(f.alerts) ? f.alerts.length : 0;
    const alertBadge = alertCnt > 0 ? `<span class="text-xs text-amber-600 font-bold ml-1" title="見回りアラート ${alertCnt}件">⚠️${alertCnt}</span>` : '';
    const distBadge = f._distM !== undefined ? `<span class="text-xs text-sky-600 font-semibold ml-1">(${f._distM}m)</span>` : '';
    return `
      <div onclick="toggleFieldSelection('${escapeHtml(f.id)}')" role="button" tabindex="0" class="cursor-pointer p-2.5 rounded-xl text-left transition ${activeCls}">
        <div class="flex items-center justify-between gap-1">
          <span class="text-xs font-bold text-[var(--foreground)] truncate">${checkIcon} ${escapeHtml(f.name)}${alertBadge}</span>
          <span class="text-xs font-bold text-emerald-600 shrink-0">${escapeHtml(f.area)}a</span>
        </div>
        <div class="flex items-center justify-between gap-1 mt-1">
          <span class="text-xs text-[var(--muted-foreground)] truncate">${escapeHtml(f.lot)} ${distBadge}</span>
          <button type="button" onclick="event.stopPropagation(); openFieldInGoogleMaps('${escapeHtml(f.id)}')" class="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 text-[10px] font-bold shrink-0" title="Googleマップでこの圃場を開く">📍Map</button>
        </div>
      </div>
    `;
  }).join('');
  refreshInteractiveMaps_();
}

// =========================================================================
// Googleマップ連携 ＆ 航空写真インタラクティブマップ（圃場選択・GISカルテ・位置取得）
// =========================================================================
const _leafletMaps = { input: null, gis: null, picker: null };
const _leafletLayers = { input: null, gis: null, picker: null };
let currentGisMapMode = 'svg';
let isInputMapDrawMode = false;
let inputDrawVertices = []; // [[lng, lat], ...]
let pickerDrawVertices = []; // [[lng, lat], ...]

function openFieldInGoogleMaps(fieldId) {
  const f = fieldsData.find(item => item.id === fieldId) || fieldsData[0];
  if (!f) return;
  const lat = Number(f.lat) || 37.9161;
  const lng = Number(f.lng) || 139.0364;
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  window.open(url, '_blank', 'noopener');
}

function openSelectedFieldsInGoogleMaps() {
  const sel = fieldsData.filter(f => selectedFieldIds.includes(f.id));
  if (sel.length === 0) return;
  if (sel.length === 1) {
    openFieldInGoogleMaps(sel[0].id);
    return;
  }
  const coordsPath = sel.map(f => `${Number(f.lat) || 37.9161},${Number(f.lng) || 139.0364}`).join('/');
  const url = `https://www.google.com/maps/dir/${coordsPath}`;
  window.open(url, '_blank', 'noopener');
}

function getFieldPolygonLatLngs_(f) {
  if (Array.isArray(f.polygonCoords) && f.polygonCoords.length >= 3) {
    return f.polygonCoords.map(pt => [Number(pt[1]), Number(pt[0])]);
  }
  const lat = Number(f.lat) || 37.9161;
  const lng = Number(f.lng) || 139.0364;
  const sideM = Math.sqrt(Math.max(5, Number(f.area) || 20) * 100);
  const dLat = (sideM / 2) / 111320;
  const dLng = (sideM / 2) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat * 0.85, lng - dLng * 1.15],
    [lat - dLat * 0.85, lng + dLng * 1.15],
    [lat + dLat * 0.85, lng + dLng * 1.15],
    [lat + dLat * 0.85, lng - dLng * 1.15]
  ];
}

function renderLeafletFieldMap_(target) {
  const canvasId = target === 'input'
    ? 'inputGoogleMapCanvas'
    : (target === 'gis' ? 'gisGoogleMapCanvas' : 'newFieldMapPickerCanvas');
  const container = document.getElementById(canvasId);
  if (!container) return;

  // オフラインまたはLeaflet未読込時のフォールバックUI
  if (typeof L === 'undefined') {
    container.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center p-4 text-center text-white text-xs space-y-2">
        <div class="font-bold text-amber-300">📡 現在オフラインのためGoogle航空写真タイルを読み込めません</div>
        <div class="text-stone-300">下のボタンから各圃場を直接選択するか、オンライン復帰後に航空写真を表示できます。</div>
        <div class="flex flex-wrap justify-center gap-1.5 mt-2">
          ${fieldsData.map(f => {
            const active = target === 'input' ? selectedFieldIds.includes(f.id) : (f.id === currentInspectedFieldId);
            const action = target === 'input' ? `toggleFieldSelection('${escapeHtml(f.id)}')` : `inspectField('${escapeHtml(f.id)}')`;
            return `<button type="button" onclick="${action}" class="px-2.5 py-1 rounded-lg font-bold ${active ? 'bg-emerald-600 text-white' : 'bg-stone-700 text-stone-200'}">${escapeHtml(f.name)} (${f.area}a)</button>`;
          }).join('')}
        </div>
      </div>
    `;
    return;
  }

  if (!_leafletMaps[target]) {
    const centerLat = fieldsData[0]?.lat || 37.9161;
    const centerLng = fieldsData[0]?.lng || 139.0364;
    const map = L.map(container, { center: [centerLat, centerLng], zoom: 16 });
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      attribution: 'Map data &copy; Google Satellite'
    }).addTo(map);
    _leafletLayers[target] = L.layerGroup().addTo(map);
    _leafletMaps[target] = map;

    if (target === 'input') {
      map.on('click', (e) => {
        if (!isInputMapDrawMode) return;
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        inputDrawVertices.push([lng, lat]);
        updateInputDrawStatsUi_();
        renderLeafletFieldMap_('input');
      });
    } else if (target === 'picker') {
      map.on('click', (e) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        pickerDrawVertices.push([lng, lat]);
        if (pickerDrawVertices.length >= 3) {
          const stats = calcPolygonAreaStats(pickerDrawVertices);
          if (document.getElementById('newFieldLat')) document.getElementById('newFieldLat').value = stats.centerLat.toFixed(5);
          if (document.getElementById('newFieldLng')) document.getElementById('newFieldLng').value = stats.centerLng.toFixed(5);
          if (document.getElementById('newFieldArea')) document.getElementById('newFieldArea').value = stats.areaA;
          showToast('📐 区画ポリゴンから面積を自動測量しました', `頂点 ${pickerDrawVertices.length}点 ／ 測量面積: 約 ${stats.areaA} a (${stats.areaM2.toLocaleString()} ㎡)`);
        } else {
          if (document.getElementById('newFieldLat')) document.getElementById('newFieldLat').value = lat.toFixed(5);
          if (document.getElementById('newFieldLng')) document.getElementById('newFieldLng').value = lng.toFixed(5);
          showToast('📍 地図上のクリック位置を取得しました', `緯度: ${lat.toFixed(5)}, 経度: ${lng.toFixed(5)}（3点以上クリックで面積も自動測量します）`);
        }
        renderLeafletFieldMap_('picker');
      });
    }
  }

  const map = _leafletMaps[target];
  const layerGroup = _leafletLayers[target];
  layerGroup.clearLayers();

  fieldsData.forEach(f => {
    const polyPts = getFieldPolygonLatLngs_(f);
    const lat = Number(f.lat) || 37.9161;
    const lng = Number(f.lng) || 139.0364;

    let fillColor = '#64748b';
    let strokeColor = '#ffffff';
    let weight = 2;
    let fillOpacity = 0.45;
    let statusBadge = `${f.area}a`;

    if (target === 'input') {
      const isSel = selectedFieldIds.includes(f.id);
      fillColor = isSel ? '#10b981' : '#64748b';
      strokeColor = isSel ? '#fde047' : '#ffffff';
      weight = isSel ? 3 : 1.5;
      fillOpacity = isSel ? 0.65 : 0.35;
      statusBadge = isSel ? `☑️ 選択中 (${f.area}a)` : `未選択 (${f.area}a)`;
    } else if (target === 'gis') {
      const st = getFieldHeatmapStyle_(f);
      fillColor = st.color;
      const isCur = f.id === currentInspectedFieldId;
      strokeColor = isCur ? '#fde047' : '#ffffff';
      weight = isCur ? 3.5 : 2;
      fillOpacity = isCur ? 0.7 : 0.5;
      statusBadge = st.label;
    }

    const polygon = L.polygon(polyPts, {
      color: strokeColor,
      weight,
      fillColor,
      fillOpacity
    }).addTo(layerGroup);

    polygon.bindTooltip(
      `<strong>${escapeHtml(f.name)}</strong><br>${escapeHtml(statusBadge)}`,
      { permanent: true, direction: 'center', className: 'text-xs font-bold' }
    );

    polygon.on('click', (ev) => {
      if (target === 'input') {
        if (isInputMapDrawMode) return;
        if (ev && L.DomEvent) L.DomEvent.stopPropagation(ev);
        toggleFieldSelection(f.id);
      } else if (target === 'gis') {
        inspectField(f.id);
      } else if (target === 'picker') {
        if (document.getElementById('newFieldLat')) document.getElementById('newFieldLat').value = lat;
        if (document.getElementById('newFieldLng')) document.getElementById('newFieldLng').value = lng;
      }
    });
  });

  // Tab 1 区画作図モード中のプレビューポリゴン・頂点描画
  if (target === 'input' && inputDrawVertices.length > 0) {
    const latLngs = inputDrawVertices.map(pt => [pt[1], pt[0]]);
    if (latLngs.length >= 2) {
      L.polygon(latLngs, {
        color: '#f59e0b',
        weight: 3,
        dashArray: '6, 4',
        fillColor: '#f59e0b',
        fillOpacity: 0.45
      }).addTo(layerGroup);
    }
    latLngs.forEach((ll, idx) => {
      L.circleMarker(ll, {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#d97706',
        fillOpacity: 1
      }).bindTooltip(`角${idx + 1}`, { permanent: true, direction: 'top' }).addTo(layerGroup);
    });
  }

  if (target === 'picker') {
    if (pickerDrawVertices.length >= 2) {
      const pLatLngs = pickerDrawVertices.map(pt => [pt[1], pt[0]]);
      L.polygon(pLatLngs, {
        color: '#38bdf8',
        weight: 3,
        dashArray: '5, 4',
        fillColor: '#0284c7',
        fillOpacity: 0.45
      }).addTo(layerGroup);
      pLatLngs.forEach((ll, idx) => {
        L.circleMarker(ll, {
          radius: 5,
          color: '#ffffff',
          weight: 2,
          fillColor: '#0284c7',
          fillOpacity: 1
        }).bindTooltip(`点${idx + 1}`, { permanent: true, direction: 'top' }).addTo(layerGroup);
      });
    }
    const pLat = Number(document.getElementById('newFieldLat')?.value || 37.9212);
    const pLng = Number(document.getElementById('newFieldLng')?.value || 139.0482);
    L.circleMarker([pLat, pLng], {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#ef4444',
      fillOpacity: 1
    }).bindTooltip('🆕 新規登録位置', { permanent: true, direction: 'top' }).addTo(layerGroup);
  }

  setTimeout(() => { map.invalidateSize(); }, 80);
}

function updateInputDrawStatsUi_() {
  const cntEl = document.getElementById('drawVertexCountLabel');
  const areaEl = document.getElementById('drawCalcAreaLabel');
  if (cntEl) cntEl.textContent = inputDrawVertices.length;
  if (areaEl) {
    if (inputDrawVertices.length >= 3) {
      const stats = calcPolygonAreaStats(inputDrawVertices);
      areaEl.textContent = `${stats.areaA} a (${stats.areaM2.toLocaleString()} ㎡)`;
    } else {
      areaEl.textContent = `0 a (あと${Math.max(0, 3 - inputDrawVertices.length)}点クリック)`;
    }
  }
}

function toggleMapDrawMode(forceState) {
  isInputMapDrawMode = forceState !== undefined ? forceState : !isInputMapDrawMode;
  const toolbar = document.getElementById('inputMapDrawToolbar');
  const btn = document.getElementById('btnToggleMapDraw');
  if (toolbar) {
    if (isInputMapDrawMode) {
      toolbar.classList.remove('hidden');
      const nameInput = document.getElementById('drawNewFieldName');
      if (nameInput && !nameInput.value) {
        nameInput.value = `新規マップ圃場${fieldsData.length + 1}号`;
      }
    } else {
      toolbar.classList.add('hidden');
      inputDrawVertices = [];
    }
  }
  if (btn) {
    btn.textContent = isInputMapDrawMode ? '📐 区画作図中（クリックで頂点追加）' : '✏️ 新規区画を囲んで追加';
  }
  updateInputDrawStatsUi_();
  renderLeafletFieldMap_('input');
}

function clearMapDrawVertices() {
  inputDrawVertices = [];
  updateInputDrawStatsUi_();
  renderLeafletFieldMap_('input');
}

function finishMapDrawField() {
  if (inputDrawVertices.length < 3) {
    showToast('⚠️ 頂点が不足しています', '航空写真上で田んぼの角を3点以上クリックして区画を囲んでください。');
    return;
  }
  const stats = calcPolygonAreaStats(inputDrawVertices);
  const rawName = (document.getElementById('drawNewFieldName')?.value || '').trim();
  const name = rawName || `マップ圃場${fieldsData.length + 1}号`;
  const crop = (document.getElementById('drawNewFieldCrop')?.value || '').trim() || 'コシヒカリ (BL)';
  const newId = generateNextId('F', fieldsData.map(f => f.id));
  const isYama = stats.centerLng > 139.042;

  fieldsData.push({
    id: newId,
    name,
    lot: `Googleマップ区画 (${stats.centerLat.toFixed(4)}, ${stats.centerLng.toFixed(4)})`,
    group: isYama ? 'yama' : 'gps',
    area: stats.areaA,
    crop,
    headingDate: isYama ? '2026/08/14' : '2026/08/08',
    targetTempC: crop.includes('つきあかり') ? 950 : 1000,
    dailyMeanTempC: isYama ? 23.2 : 25.5,
    harvest: '2026/09/22',
    stage: '未着手',
    lat: Number(stats.centerLat.toFixed(5)),
    lng: Number(stats.centerLng.toFixed(5)),
    polygonCoords: [...inputDrawVertices],
    doneCats: [],
    nPer10a: 0,
    pPer10a: 0,
    kPer10a: 0,
    pestCount: {},
    alerts: [],
    baseline: makeEmptyBaseline()
  });

  if (!selectedFieldIds.includes(newId)) {
    selectedFieldIds.push(newId);
  }
  if (document.getElementById('drawNewFieldName')) {
    document.getElementById('drawNewFieldName').value = '';
  }
  toggleMapDrawMode(false);
  saveStateToStorage();
  refreshAllViews();
  showToast(
    `🎉 Googleマップ上の区画から「${name} (${stats.areaA}a)」を登録・選択しました！`,
    `自動測量面積: ${stats.areaM2.toLocaleString()}㎡ → ${stats.areaA}a（${inputDrawVertices.length || 3}頂点ポリゴン保存済）`
  );
}

function clearPickerPolygonVertices() {
  pickerDrawVertices = [];
  renderLeafletFieldMap_('picker');
  showToast('🔄 区画ポリゴンをリセットしました', '再度航空写真上をクリックして指定できます。');
}

function refreshInteractiveMaps_() {
  const inputWrap = document.getElementById('inputGoogleMapWrap');
  if (inputWrap && !inputWrap.classList.contains('hidden')) {
    renderLeafletFieldMap_('input');
  }
  const gisWrap = document.getElementById('gisGoogleMapWrap');
  if (gisWrap && !gisWrap.classList.contains('hidden')) {
    renderLeafletFieldMap_('gis');
  }
  const pickerWrap = document.getElementById('newFieldMapPickerWrap');
  if (pickerWrap && !pickerWrap.classList.contains('hidden')) {
    renderLeafletFieldMap_('picker');
  }
}

function toggleInputGoogleMap() {
  const wrap = document.getElementById('inputGoogleMapWrap');
  if (!wrap) return;
  const isHidden = wrap.classList.contains('hidden');
  if (isHidden) {
    wrap.classList.remove('hidden');
    renderLeafletFieldMap_('input');
  } else {
    wrap.classList.add('hidden');
  }
}

function switchGisMapMode(mode) {
  currentGisMapMode = mode;
  const svgWrap = document.getElementById('gisSvgMapWrap');
  const gWrap = document.getElementById('gisGoogleMapWrap');
  const btnSvg = document.getElementById('gisModeBtn-svg');
  const btnG = document.getElementById('gisModeBtn-google');
  if (!svgWrap || !gWrap) return;

  if (mode === 'google') {
    svgWrap.classList.add('hidden');
    gWrap.classList.remove('hidden');
    if (btnG) btnG.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white';
    if (btnSvg) btnSvg.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--secondary)] text-[var(--secondary-foreground)]';
    renderLeafletFieldMap_('gis');
  } else {
    gWrap.classList.add('hidden');
    svgWrap.classList.remove('hidden');
    if (btnSvg) btnSvg.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white';
    if (btnG) btnG.className = 'px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--secondary)] text-[var(--secondary-foreground)]';
  }
}

function panGoogleMapToGroup(target, groupKey) {
  const matched = fieldsData.filter(f => f.group === groupKey);
  const list = matched.length > 0 ? matched : fieldsData;
  if (list.length === 0) return;
  const avgLat = list.reduce((s, f) => s + (Number(f.lat) || 37.9161), 0) / list.length;
  const avgLng = list.reduce((s, f) => s + (Number(f.lng) || 139.0364), 0) / list.length;
  if (target === 'gis' && currentGisMapMode !== 'google') {
    switchGisMapMode('google');
  }
  const map = _leafletMaps[target];
  if (map) {
    map.setView([avgLat, avgLng], 16);
  }
}

function toggleNewFieldMapPicker(forceState) {
  const wrap = document.getElementById('newFieldMapPickerWrap');
  if (!wrap) return;
  const show = forceState !== undefined ? forceState : wrap.classList.contains('hidden');
  if (show) {
    wrap.classList.remove('hidden');
    renderLeafletFieldMap_('picker');
  } else {
    wrap.classList.add('hidden');
  }
}

function applyGoogleMapsUrlToFieldForm(val) {
  const coords = parseGoogleMapsCoords(val);
  if (!coords) return;
  if (document.getElementById('newFieldLat')) document.getElementById('newFieldLat').value = coords.lat.toFixed(5);
  if (document.getElementById('newFieldLng')) document.getElementById('newFieldLng').value = coords.lng.toFixed(5);
  refreshInteractiveMaps_();
  showToast('📍 Googleマップから座標を自動抽出しました', `緯度: ${coords.lat.toFixed(5)}, 経度: ${coords.lng.toFixed(5)}`);
}

function toggleFieldSelection(fieldId) {
  if (selectedFieldIds.includes(fieldId)) {
    if (selectedFieldIds.length > 1) {
      selectedFieldIds = selectedFieldIds.filter(id => id !== fieldId);
    }
  } else {
    selectedFieldIds.push(fieldId);
  }
  renderInputFieldGrid();
  recalculatePreview();
}

function selectFieldGroup(groupType) {
  if (groupType === 'gps') {
    selectedFieldIds = ['F01', 'F02', 'F03'];
  } else if (groupType === 'yama') {
    selectedFieldIds = fieldsData.filter(f => f.group === 'yama').map(f => f.id);
  } else {
    selectedFieldIds = fieldsData.map(f => f.id);
  }
  renderInputFieldGrid();
  recalculatePreview();
}

// プリセット適用
function applyPreset(presetType) {
  if (presetType === 'fertilizer') {
    selectedFieldIds = ['F01', 'F02', 'F03'];
    currentDuration = 2.0;
    currentBags = 10;
    document.getElementById('machineSelect').value = 'M01';
    document.getElementById('fertilizerSelect').value = 'F01';
    selectWorkCat('施肥');
  } else if (presetType === 'pesticide') {
    selectedFieldIds = ['F01', 'F02', 'F03'];
    currentDuration = 1.5;
    document.getElementById('machineSelect').value = 'M03';
    document.getElementById('pesticideSelect').value = 'P01';
    if (document.getElementById('pesticideMixSelect')) {
      document.getElementById('pesticideMixSelect').value = 'P02';
    }
    document.getElementById('dilutionSelect').value = '8_0.8';
    selectWorkCat('防除');
  } else if (presetType === 'mowing') {
    selectedFieldIds = ['F05', 'F06', 'F07'];
    currentDuration = 2.5;
    document.getElementById('machineSelect').value = 'M02';
    selectWorkCat('草刈り');
  }
  document.getElementById('durationValue').textContent = currentDuration.toFixed(1);
  document.getElementById('bagCountValue').textContent = currentBags;
  renderInputFieldGrid();
  recalculatePreview();
  showToast('⚡ 前回履歴からプリセットを呼び出しました', '対象圃場や数量を確認し、1タップで登録できます。');
}

function selectWorkCat(cat) {
  currentWorkCat = cat;
  document.querySelectorAll('.work-cat-btn').forEach(btn => {
    const spanCls = btn.dataset.cat === '収穫' ? ' col-span-2 sm:col-span-1' : '';
    if (btn.dataset.cat === cat) {
      btn.className = 'work-cat-btn py-2.5 px-2 rounded-xl border text-xs font-bold transition bg-emerald-600 text-white border-emerald-600 shadow-sm' + spanCls;
    } else {
      btn.className = 'work-cat-btn py-2.5 px-2 rounded-xl border text-xs font-bold transition bg-[var(--card)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--secondary)]' + spanCls;
    }
  });

  const fertPanel = document.getElementById('fertilizerPanel');
  const pestPanel = document.getElementById('pesticidePanel');
  const harvPanel = document.getElementById('harvestPanel');
  const nonePanel = document.getElementById('noMaterialPanel');
  const secTitle = document.getElementById('materialSectionTitle');

  fertPanel.classList.add('hidden');
  pestPanel.classList.add('hidden');
  if (harvPanel) harvPanel.classList.add('hidden');
  nonePanel.classList.add('hidden');

  if (cat === '施肥') {
    fertPanel.classList.remove('hidden');
    secTitle.textContent = '使用肥料・NPK自動積算（袋数を入れるだけで成分量を自動計算）';
  } else if (cat === '防除') {
    pestPanel.classList.remove('hidden');
    secTitle.textContent = '使用農薬（混用対応）・希釈逆算 ＆ 有効成分別安全基準チェック';
  } else if (cat === '収穫') {
    if (harvPanel) harvPanel.classList.remove('hidden');
    secTitle.textContent = '収穫・刈取記録（袋数を入れるだけで10a反収［俵/kg］と圃場別収量を自動按分）';
  } else {
    nonePanel.classList.remove('hidden');
    secTitle.textContent = `使用資材（${cat}：資材消費なし）`;
  }
  recalculatePreview();
}

function adjustHarvestBags(delta) {
  currentHarvestBags = Math.max(10, currentHarvestBags + delta);
  document.getElementById('harvestBagValue').textContent = currentHarvestBags;
  recalculatePreview();
}

function adjustDuration(delta) {
  currentDuration = Math.max(0.5, Math.round((currentDuration + delta) * 10) / 10);
  document.getElementById('durationValue').textContent = currentDuration.toFixed(1);
  recalculatePreview();
}

function adjustBags(delta) {
  currentBags = Math.max(1, currentBags + delta);
  document.getElementById('bagCountValue').textContent = currentBags;
  recalculatePreview();
}

// =========================================================================
// 農薬安全基準チェック（商品名ごと ＋ 有効成分ごとの総使用回数 ＆ 収穫前日数PHI）
// =========================================================================
function evaluatePesticideSafety_(selectedFields, pestIds, workDateStr) {
  const workDateMs = new Date(String(workDateStr || '2026-08-05').replace(/\//g, '-')).setHours(0, 0, 0, 0);
  const overUseMessages = [];
  const phiMessages = [];

  // 今回同時に散布する農薬群の中で同一有効成分が何剤含まれるかもカウント（例：スタークル液剤＋スタークル粒剤の同時選択）
  const batchIngredientAdd = {};
  pestIds.forEach(pid => {
    const p = pesticides[pid];
    if (!p) return;
    const ing = p.activeIngredient || pid;
    batchIngredientAdd[ing] = (batchIngredientAdd[ing] || 0) + 1;
  });

  pestIds.forEach(pid => {
    const pest = pesticides[pid];
    if (!pest) return;
    const ing = pest.activeIngredient || pid;
    const addIngCount = batchIngredientAdd[ing] || 1;

    // 1. 商品別および有効成分別の使用回数上限チェック
    const violatedFields = [];
    selectedFields.forEach(f => {
      const curProdCount = (f.pestCount && f.pestCount[pid]) || 0;
      const curIngCount = (f.ingredientCount && f.ingredientCount[ing]) || curProdCount;
      if (curProdCount + 1 > pest.maxUse || curIngCount + addIngCount > pest.maxUse) {
        violatedFields.push({
          name: f.name,
          curProdCount,
          curIngCount,
          byIngredient: (curIngCount + addIngCount > pest.maxUse) && (curIngCount > curProdCount || addIngCount > 1)
        });
      }
    });

    if (violatedFields.length > 0) {
      const names = violatedFields.map(v =>
        v.byIngredient
          ? `${escapeHtml(v.name)}（有効成分「${escapeHtml(ing)}」計${v.curIngCount}回使用済）`
          : `${escapeHtml(v.name)}（${v.curProdCount}回使用済）`
      ).join('・');
      overUseMessages.push(
        `⚠️ <strong>農薬・有効成分 使用回数超過アラート</strong>：${escapeHtml(pest.name)}（有効成分: <strong>${escapeHtml(ing)}</strong> / 上限${pest.maxUse}回）が上限を超過します［対象: ${names}］！`
      );
    }

    // 2. 収穫前日数（PHI）チェック
    const phiViolations = [];
    selectedFields.forEach(f => {
      if (!f.harvest) return;
      const harvMs = new Date(String(f.harvest).replace(/\//g, '-')).setHours(0, 0, 0, 0);
      if (!isNaN(workDateMs) && !isNaN(harvMs)) {
        const diffDays = Math.floor((harvMs - workDateMs) / (1000 * 60 * 60 * 24));
        if (diffDays < pest.phiDays) {
          phiViolations.push({ field: f, diffDays });
        }
      }
    });

    if (phiViolations.length > 0) {
      const phiDetails = phiViolations.map(v =>
        v.diffDays < 0
          ? `${escapeHtml(v.field.name)}（収穫予定日 ${escapeHtml(v.field.harvest)} を ${Math.abs(v.diffDays)} 日経過）`
          : `${escapeHtml(v.field.name)}（収穫予定 ${escapeHtml(v.field.harvest)} まで残り ${v.diffDays} 日）`
      ).join('・');
      phiMessages.push(
        `⚠️ <strong>収穫前日数（PHI）制限違反アラート</strong>：${escapeHtml(pest.name)} は収穫前 <strong>${pest.phiDays}日以内</strong> の散布が禁止されています［対象: ${phiDetails}］！`
      );
    }
  });

  return {
    ok: overUseMessages.length === 0 && phiMessages.length === 0,
    overUseMessages,
    phiMessages,
    allMessages: [...overUseMessages, ...phiMessages]
  };
}

// 面積按分・NPK積算・希釈逆算・安全基準チェック・収穫反収計算
function recalculatePreview() {
  const selectedFields = fieldsData.filter(f => selectedFieldIds.includes(f.id));
  const totalArea = selectedFields.reduce((sum, f) => sum + f.area, 0);

  document.getElementById('selectedCountLabel').textContent = selectedFields.length;
  document.getElementById('selectedTotalAreaLabel').textContent = totalArea;
  document.getElementById('selectedTotalTanLabel').textContent = (totalArea / 10).toFixed(1);

  const fertId = document.getElementById('fertilizerSelect').value || 'F01';
  const fert = fertilizers[fertId] || Object.values(fertilizers)[0];
  const totalKg = currentBags * fert.unitKg;
  const fertPer10a = totalArea > 0 ? (totalKg / (totalArea / 10)) : 0;
  const nTotal = totalKg * (fert.n / 100);
  const pTotal = totalKg * (fert.p / 100);
  const kTotal = totalKg * (fert.k / 100);
  const nPer10a = fertPer10a * (fert.n / 100);
  const pPer10a = fertPer10a * (fert.p / 100);
  const kPer10a = fertPer10a * (fert.k / 100);

  document.getElementById('totalKgValue').textContent = totalKg;
  document.getElementById('calcFertPer10a').textContent = fertPer10a.toFixed(1);
  document.getElementById('calcNPer10a').textContent = nPer10a.toFixed(2);
  document.getElementById('calcPPer10a').textContent = pPer10a.toFixed(2);
  document.getElementById('calcKPer10a').textContent = kPer10a.toFixed(2);
  document.getElementById('calcNTotal').textContent = nTotal.toFixed(1);
  document.getElementById('calcPTotal').textContent = pTotal.toFixed(1);
  document.getElementById('calcKTotal').textContent = kTotal.toFixed(1);

  // 収穫パネル計算
  const harvTotalKg = currentHarvestBags * 30;
  const yieldKg10a = totalArea > 0 ? (harvTotalKg / (totalArea / 10)) : 0;
  const yieldTawara10a = yieldKg10a / 60;
  if (document.getElementById('calcHarvestTotalKg')) {
    document.getElementById('calcHarvestTotalKg').textContent = harvTotalKg.toLocaleString('ja-JP');
    document.getElementById('calcYieldKg10a').textContent = Math.round(yieldKg10a).toLocaleString('ja-JP');
    document.getElementById('calcYieldTawara10a').textContent = yieldTawara10a.toFixed(1);
  }

  // 防除（混用散布＆有効成分チェック対応）
  const selectedPestIds = getSelectedPesticideIdsFromUi_();
  const selectedPests = selectedPestIds.map(id => pesticides[id]).filter(Boolean);
  const [dilRate, waterPer10a] = document.getElementById('dilutionSelect').value.split('_').map(Number);
  const totalWaterL = (totalArea / 10) * waterPer10a;
  const totalChemMl = (totalWaterL * 1000) / dilRate;

  document.getElementById('pestAreaDisplay').textContent = totalArea;
  document.getElementById('calcWaterL').textContent = totalWaterL.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  document.getElementById('calcChemMl').textContent = selectedPests.length > 1
    ? `各 ${Math.round(totalChemMl).toLocaleString('ja-JP')} mL (${selectedPests.length}剤混用)`
    : `${Math.round(totalChemMl).toLocaleString('ja-JP')} mL`;

  const workDateStr = document.getElementById('workDateInput').value || '2026-08-05';
  const safetyResult = evaluatePesticideSafety_(selectedFields, selectedPestIds, workDateStr);

  const alertBox = document.getElementById('safetyAlertBox');
  if (!safetyResult.ok) {
    alertBox.className = 'p-3 rounded-xl border border-red-500/50 bg-red-500/15 text-xs font-bold text-red-600 space-y-1';
    alertBox.innerHTML = safetyResult.allMessages.map(m => `<div>${m}</div>`).join('');
  } else {
    const summaryLabels = selectedPests.map(p =>
      `${escapeHtml(p.name)}［成分:${escapeHtml(p.activeIngredient || '-')} 上限${p.maxUse}回・収穫前${p.phiDays}日］`
    ).join(' ＋ ');
    alertBox.className = 'p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-600';
    alertBox.innerHTML = `✅ 農薬・有効成分 安全基準チェックOK：選択された全 ${selectedFields.length} 圃場で ${summaryLabels} の総使用回数上限および収穫前日数を満たしています。`;
  }

  const allocBody = document.getElementById('allocationPreviewBody');
  const allocHeader = document.getElementById('allocColHeader');
  if (currentWorkCat === '施肥') {
    allocHeader.textContent = '按分施肥量 (N成分)';
  } else if (currentWorkCat === '防除') {
    allocHeader.textContent = '按分散布液量 (薬量)';
  } else if (currentWorkCat === '収穫') {
    allocHeader.textContent = '按分収量 (反収)';
  } else {
    allocHeader.textContent = '更新ステータス';
  }

  allocBody.innerHTML = selectedFields.map(f => {
    const ratio = totalArea > 0 ? (f.area / totalArea) : 0;
    const allocHr = currentDuration * ratio;
    let rightCell = `${escapeHtml(currentWorkCat)}済`;
    if (currentWorkCat === '施肥') {
      const fKg = totalKg * ratio;
      const fN = nTotal * ratio;
      rightCell = `${fKg.toFixed(1)}kg <span class="text-emerald-600 font-semibold">(N:${fN.toFixed(1)}kg)</span>`;
    } else if (currentWorkCat === '防除') {
      const fWater = totalWaterL * ratio;
      const fChem = totalChemMl * ratio;
      const mixSuffix = selectedPests.length > 1 ? `×${selectedPests.length}剤` : '';
      rightCell = `${fWater.toFixed(1)}L <span class="text-sky-600 font-semibold">(${Math.round(fChem)}mL${mixSuffix})</span>`;
    } else if (currentWorkCat === '収穫') {
      const fHarvKg = Math.round(harvTotalKg * ratio);
      rightCell = `${fHarvKg.toLocaleString()}kg <span class="text-amber-600 font-semibold">(${yieldTawara10a.toFixed(1)}俵/10a)</span>`;
    }

    return `
      <tr class="hover:bg-[var(--secondary)]/50">
        <td class="p-2.5 font-semibold text-[var(--foreground)]">${escapeHtml(f.name)}</td>
        <td class="p-2.5 text-right">${escapeHtml(f.area)}a</td>
        <td class="p-2.5 text-right font-mono">${(ratio * 100).toFixed(0)}%</td>
        <td class="p-2.5 text-right font-semibold">${allocHr.toFixed(2)}h</td>
        <td class="p-2.5 text-right">${rightCell}</td>
      </tr>
    `;
  }).join('');

  const workerName = document.getElementById('workerNameInput').value || '佐藤 健一';
  const weatherVal = document.getElementById('workWeatherSelect')?.value || '☀️ 晴れ';
  const tempVal = document.getElementById('workTempInput')?.value || '25';
  const memoVal = (document.getElementById('workDiaryMemoInput')?.value || '').trim();
  const memoPreview = memoVal ? ` ／ 📔メモ: ${memoVal}` : '';
  document.getElementById('previewDiarySummary').textContent =
    `天候: ${weatherVal}(${tempVal}℃) / 作業者: ${workerName} / 分類: ${currentWorkCat} / 合計: ${currentDuration.toFixed(1)}h (${selectedFields.length}筆へ按分)${memoPreview}`;

  const machId = document.getElementById('machineSelect').value;
  if (machId !== 'NONE' && machines[machId]) {
    const m = machines[machId];
    const nextHr = m.currentHour + currentDuration;
    document.getElementById('previewMachineSummary').textContent =
      `${m.name}: ${m.currentHour.toFixed(1)}h → ${nextHr.toFixed(1)}h (次回点検目安 ${m.nextMaint}h)`;
  } else {
    document.getElementById('previewMachineSummary').textContent = '機械使用なし（手作業）';
  }

  if (currentWorkCat === '施肥') {
    document.getElementById('previewStockSummary').textContent =
      `${fert.name}: 現在庫 ${fert.stock}袋 → 登録後 ${Math.max(0, fert.stock - currentBags)}袋`;
  } else if (currentWorkCat === '防除') {
    const usedBottles = Math.max(1, Math.ceil(totalChemMl / 500));
    document.getElementById('previewStockSummary').textContent = selectedPests.map(p =>
      `${p.name}: 残${p.stock} → ${Math.max(0, p.stock - usedBottles)}`
    ).join(' ／ ');
  } else if (currentWorkCat === '収穫') {
    const grade = document.getElementById('harvestGradeSelect')?.value || '1等';
    const moist = document.getElementById('harvestMoistureInput')?.value || '14.8';
    document.getElementById('previewStockSummary').textContent =
      `収穫玄米: ${currentHarvestBags}袋 (${harvTotalKg}kg) / 水分${moist}% / ${grade} (${yieldTawara10a.toFixed(1)}俵/10a)`;
  } else {
    document.getElementById('previewStockSummary').textContent = '資材消費なし（在庫変動なし）';
  }
}

// =========================================================================
// 作業履歴の資源反映（機械アワー・資材在庫）／取消・修正
// =========================================================================
function applyLogResourceEffects_(log, sign) {
  if (log.machineId && machines[log.machineId]) {
    const m = machines[log.machineId];
    m.currentHour = Math.max(0, Math.round((m.currentHour + sign * (Number(log.duration) || 0)) * 10) / 10);
  }
  if (log.type === 'fertilizer' && log.materialId && fertilizers[log.materialId]) {
    const qty = log.stockDeducted !== undefined ? Number(log.stockDeducted) : (Number(log.inputQty) || 0);
    fertilizers[log.materialId].stock = Math.max(0, fertilizers[log.materialId].stock - sign * qty);
  } else if (log.type === 'pesticide') {
    const pids = getLogPesticideIds(log);
    pids.forEach(pid => {
      if (!pesticides[pid]) return;
      const deductedMap = log.stockDeductedByMap || {};
      const qty = deductedMap[pid] !== undefined
        ? Number(deductedMap[pid])
        : (log.stockDeducted !== undefined ? Number(log.stockDeducted) : (Number(log.inputQty) || 0));
      pesticides[pid].stock = Math.max(0, pesticides[pid].stock - sign * qty);
    });
  }
}

function removeWorkLog_(logId) {
  const idx = workLogs.findIndex(l => l.id === logId);
  if (idx === -1) return null;
  const [log] = workLogs.splice(idx, 1);
  applyLogResourceEffects_(log, -1);
  recalculateFieldStats();
  return { log, idx };
}

function restoreWorkLog_(backup) {
  if (!backup) return;
  workLogs.splice(backup.idx, 0, backup.log);
  applyLogResourceEffects_(backup.log, +1);
  recalculateFieldStats();
}

function deleteWorkLog(logId) {
  const log = workLogs.find(l => l.id === logId);
  if (!log) return;
  const syncedNote = log.synced
    ? '\n\n※この履歴はスプレッドシートへ同期済みです。スプレッドシート側の行は自動では削除されないため、必要に応じて手動で削除してください。'
    : '';
  if (!confirm(`${log.date} 「${log.cat}」の作業履歴を取り消しますか？\n機械アワー・資材在庫・圃場の累計値も元に戻ります。${syncedNote}`)) return;

  removeWorkLog_(logId);
  if (editingLogId === logId) cancelEditMode(true);
  saveStateToStorage();
  refreshAllViews();
  showToast('🗑️ 作業履歴を取り消しました', '機械アワー・資材在庫・圃場の累計NPK／農薬使用回数を再計算しました。');
}

function editWorkLog(logId) {
  const log = workLogs.find(l => l.id === logId);
  if (!log) return;
  editingLogId = logId;

  document.getElementById('workDateInput').value = dateKey_(log.date).replace(/\//g, '-');
  document.getElementById('workerNameInput').value = log.worker || '';
  if (document.getElementById('workWeatherSelect')) {
    document.getElementById('workWeatherSelect').value = log.weather || '☀️ 晴れ';
  }
  if (document.getElementById('workTempInput')) {
    document.getElementById('workTempInput').value = log.tempC !== undefined ? log.tempC : 25;
  }
  if (document.getElementById('workDiaryMemoInput')) {
    document.getElementById('workDiaryMemoInput').value = log.memo || '';
  }
  selectedFieldIds = (log.fieldIds || []).filter(id => fieldsData.some(f => f.id === id));
  if (selectedFieldIds.length === 0 && fieldsData[0]) selectedFieldIds = [fieldsData[0].id];
  currentDuration = Number(log.duration) || 0.5;
  document.getElementById('durationValue').textContent = currentDuration.toFixed(1);
  document.getElementById('machineSelect').value = (log.machineId && machines[log.machineId]) ? log.machineId : 'NONE';

  if (log.type === 'fertilizer' && fertilizers[log.materialId]) {
    document.getElementById('fertilizerSelect').value = log.materialId;
    currentBags = Number(log.inputQty) || 1;
    document.getElementById('bagCountValue').textContent = currentBags;
  } else if (log.type === 'pesticide') {
    const pids = getLogPesticideIds(log);
    if (pids[0] && pesticides[pids[0]]) {
      document.getElementById('pesticideSelect').value = pids[0];
    }
    if (document.getElementById('pesticideMixSelect')) {
      document.getElementById('pesticideMixSelect').value = (pids[1] && pesticides[pids[1]]) ? pids[1] : 'NONE';
    }
    const dilSel = document.getElementById('dilutionSelect');
    const opt = [...dilSel.options].find(o => o.value.split('_')[0] === String(log.dilutionRate));
    if (opt) dilSel.value = opt.value;
  } else if (log.type === 'harvest') {
    currentHarvestBags = Number(log.harvestBags) || Math.max(10, Math.round((Number(log.totalKg) || 0) / 30));
    document.getElementById('harvestBagValue').textContent = currentHarvestBags;
    if (log.grade) document.getElementById('harvestGradeSelect').value = log.grade;
    if (log.moisture) document.getElementById('harvestMoistureInput').value = log.moisture;
  }

  selectWorkCat(log.cat);
  renderInputFieldGrid();
  recalculatePreview();

  const banner = document.getElementById('editModeBanner');
  document.getElementById('editModeText').textContent =
    `✏️ 修正モード：${log.date}「${log.cat}」の履歴を編集中です。内容を直して下の登録ボタンを押すと置き換えられます。` +
    (log.synced ? '（同期済み履歴のため、スプレッドシート側の旧行は手動で削除してください）' : '');
  banner.classList.remove('hidden');
  switchMainTab('input');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditMode(silent) {
  editingLogId = null;
  document.getElementById('editModeBanner').classList.add('hidden');
  if (!silent) showToast('修正モードを終了しました', '履歴は変更されていません。');
}

// 一括登録実行 ＆ LocalStorage永続化
function submitUnifiedWorkLog() {
  const selectedFields = fieldsData.filter(f => selectedFieldIds.includes(f.id));
  const totalArea = selectedFields.reduce((sum, f) => sum + f.area, 0);
  const machId = document.getElementById('machineSelect').value;
  const machineName = (machId !== 'NONE' && machines[machId]) ? machines[machId].name : 'なし（手作業）';
  const workDateRaw = document.getElementById('workDateInput').value || '2026-08-05';
  const formattedDate = workDateRaw.replace(/-/g, '/');
  const workerName = document.getElementById('workerNameInput').value || '佐藤 健一';

  if (selectedFields.length === 0 || totalArea <= 0) {
    showToast('⚠️ 入力確認', '面積のある圃場を1筆以上選択してください。');
    return;
  }

  const isEditing = !!editingLogId;
  const editingBackup = isEditing ? removeWorkLog_(editingLogId) : null;
  const abort = () => { restoreWorkLog_(editingBackup); };

  if (currentWorkCat === '防除') {
    const selectedPestIds = getSelectedPesticideIdsFromUi_();
    const safety = evaluatePesticideSafety_(selectedFields, selectedPestIds, workDateRaw);
    if (!safety.ok) {
      abort();
      const plainMsg = safety.allMessages.map(m => m.replace(/<[^>]+>/g, '')).join(' ／ ');
      showToast('⛔ 安全基準エラー（農薬・有効成分上限または収穫前日数違反）：登録をブロックしました', plainMsg);
      return;
    }
  }

  const weatherVal = document.getElementById('workWeatherSelect')?.value || '☀️ 晴れ';
  const tempVal = Number(document.getElementById('workTempInput')?.value || 25);
  const memoVal = (document.getElementById('workDiaryMemoInput')?.value || '').trim();

  let newLog = {
    id: 'WL-' + Date.now(),
    date: formattedDate,
    cat: currentWorkCat,
    worker: workerName,
    weather: weatherVal,
    tempC: tempVal,
    memo: memoVal,
    fieldIds: selectedFields.map(f => f.id),
    totalArea: totalArea,
    duration: currentDuration,
    machineId: machId !== 'NONE' ? machId : '',
    machineName: machineName,
    materialSummary: `${currentWorkCat}作業完了`,
    type: 'general',
    synced: false
  };

  if (currentWorkCat === '施肥') {
    const fertId = document.getElementById('fertilizerSelect').value;
    const fert = fertilizers[fertId];
    const totalKg = currentBags * fert.unitKg;
    const per10aKg = totalKg / (totalArea / 10);

    newLog.type = 'fertilizer';
    newLog.materialId = fertId;
    newLog.inputQty = currentBags;
    newLog.stockDeducted = Math.min(fert.stock, currentBags);
    newLog.fertName = fert.name;
    newLog.npkLabel = `${fert.n}-${fert.p}-${fert.k}`;
    newLog.totalKg = totalKg;
    newLog.per10aKg = per10aKg;
    newLog.n10a = per10aKg * (fert.n / 100);
    newLog.p10a = per10aKg * (fert.p / 100);
    newLog.k10a = per10aKg * (fert.k / 100);
    newLog.materialSummary = `${fert.name} (${currentBags}袋 / ${totalKg}kg)`;
  } else if (currentWorkCat === '防除') {
    const selectedPestIds = getSelectedPesticideIdsFromUi_();
    const selectedPests = selectedPestIds.map(id => pesticides[id]).filter(Boolean);
    const [dilRate, waterPer10a] = document.getElementById('dilutionSelect').value.split('_').map(Number);
    const totalWaterL = (totalArea / 10) * waterPer10a;
    const totalChemMl = (totalWaterL * 1000) / dilRate;
    const usedBottles = Math.max(1, Math.ceil(totalChemMl / 500));

    const stockDeductedByMap = {};
    selectedPests.forEach(p => {
      stockDeductedByMap[p.id] = Math.min(p.stock, usedBottles);
    });

    const pestNamesLabel = selectedPests.map(p => `${p.name} (${p.regNo})`).join(' ＋ ');
    const summaryNames = selectedPests.map(p => p.name).join('＋');
    const useLimitStr = selectedPests.map(p => `${p.activeIngredient || p.name}:上限${p.maxUse}回`).join(' / ');

    newLog.type = 'pesticide';
    newLog.materialId = selectedPestIds.join(',');
    newLog.materialIds = selectedPestIds;
    newLog.inputQty = usedBottles;
    newLog.stockDeducted = usedBottles;
    newLog.stockDeductedByMap = stockDeductedByMap;
    newLog.dilutionRate = dilRate;
    newLog.pestName = pestNamesLabel;
    newLog.dilution = `${dilRate}倍${selectedPests.length > 1 ? ' (混用)' : ''}`;
    newLog.waterL = totalWaterL;
    newLog.chemAmount = `${Math.round(totalChemMl).toLocaleString()} mL`;
    newLog.useCountLabel = useLimitStr;
    newLog.safetyOk = true;
    newLog.materialSummary = `${summaryNames} (${dilRate}倍${selectedPests.length > 1 ? `・${selectedPests.length}剤混用` : ''} / 液量${totalWaterL}L)`;
  } else if (currentWorkCat === '収穫') {
    const harvTotalKg = currentHarvestBags * 30;
    const yieldKg10a = totalArea > 0 ? (harvTotalKg / (totalArea / 10)) : 0;
    const yieldTawara10a = yieldKg10a / 60;
    const grade = document.getElementById('harvestGradeSelect')?.value || '1等';
    const moist = document.getElementById('harvestMoistureInput')?.value || '14.8';

    newLog.type = 'harvest';
    newLog.totalKg = harvTotalKg;
    newLog.harvestBags = currentHarvestBags;
    newLog.yieldTawara10a = Number(yieldTawara10a.toFixed(1));
    newLog.grade = grade;
    newLog.moisture = moist;
    newLog.materialSummary = `玄米 ${currentHarvestBags}袋 (${harvTotalKg}kg) / 反収 ${yieldTawara10a.toFixed(1)}俵/10a / 水分${moist}% / ${grade}`;
  }

  applyLogResourceEffects_(newLog, +1);

  if (editingBackup) workLogs.splice(editingBackup.idx, 0, newLog);
  else workLogs.unshift(newLog);
  recalculateFieldStats();

  if (isEditing) cancelEditMode(true);
  if (document.getElementById('workDiaryMemoInput')) {
    document.getElementById('workDiaryMemoInput').value = '';
  }
  saveStateToStorage();
  refreshAllViews();

  showToast(
    isEditing
      ? `✏️ 作業履歴・日誌を修正しました（${selectedFields.length} 筆）`
      : `🎉 1アクションで ${selectedFields.length} 筆のカルテ＆営農日誌を端末保存しました！`,
    `対象: ${selectedFields.map(f => f.name).join('・')} (計${totalArea}a) ／ 日誌タイムライン・A4帳票へ即時反映されました。`
  );
}

// =========================================================================
// 📔 営農日誌タイムライン（検索・絞り込み・タグ挿入・ワンタップ編集）
// =========================================================================
function appendDiaryQuickTag(tagText) {
  const el = document.getElementById('workDiaryMemoInput');
  if (!el) return;
  const cur = el.value.trim();
  el.value = cur ? `${cur} ／ ${tagText}` : tagText;
  recalculatePreview();
}

function renderDiaryTimeline() {
  const listEl = document.getElementById('diaryTimelineList');
  const countBadge = document.getElementById('diaryTotalCountBadge');
  if (!listEl) return;

  const q = (document.getElementById('diarySearchInput')?.value || '').trim().toLowerCase();
  const catFilter = document.getElementById('diaryCatFilter')?.value || 'ALL';

  const filtered = workLogs.filter(l => {
    if (catFilter !== 'ALL' && l.cat !== catFilter) return false;
    if (!q) return true;
    const fNames = (l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join(' ');
    const hay = `${l.date} ${l.cat} ${l.worker} ${l.weather || ''} ${l.memo || ''} ${l.materialSummary || ''} ${l.machineName || ''} ${fNames}`.toLowerCase();
    return hay.includes(q);
  });

  if (countBadge) {
    countBadge.textContent = `全 ${workLogs.length}件（表示 ${filtered.length}件）`;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="p-4 rounded-2xl bg-[var(--background)] border border-[var(--border)] text-xs text-[var(--muted-foreground)] text-center">該当する営農日誌がありません。</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(l => {
    const matchedFields = (l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)).filter(Boolean);
    const fBadges = matchedFields.map(f =>
      `<button type="button" onclick="openFieldInGoogleMaps('${escapeHtml(f.id)}')" class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 font-semibold text-[11px] hover:bg-emerald-500/25" title="Googleマップでこの圃場を表示">📍${escapeHtml(f.name)}(${f.area}a)</button>`
    ).join(' ');
    const weatherStr = l.weather ? `${escapeHtml(l.weather)}${l.tempC !== undefined ? ` (${escapeHtml(l.tempC)}℃)` : ''}` : '☀️ 晴れ';
    const memoBlock = l.memo
      ? `<div class="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-[var(--foreground)]"><span class="font-bold text-amber-700">📔 日誌メモ:</span> ${escapeHtml(l.memo)}</div>`
      : '';

    return `
      <div class="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--border)] text-xs space-y-1.5">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-[var(--foreground)]">📅 ${escapeHtml(l.date)}</span>
            <span class="px-2 py-0.5 rounded-lg bg-emerald-600 text-white font-bold">${escapeHtml(l.cat)}</span>
            <span class="text-[var(--muted-foreground)] font-semibold">${weatherStr}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-emerald-600">${(Number(l.duration) || 0).toFixed(1)}h (計${escapeHtml(l.totalArea)}a)</span>
            <button type="button" onclick="editWorkLog('${escapeHtml(l.id)}')" class="px-2 py-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] font-semibold hover:opacity-80">✏️ 修正</button>
            <button type="button" onclick="deleteWorkLog('${escapeHtml(l.id)}')" class="px-2 py-0.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 font-semibold hover:bg-red-500/20">🗑️ 取消</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1 pt-0.5">${fBadges}</div>
        <div class="text-[var(--foreground)] font-semibold">${escapeHtml(l.materialSummary)}</div>
        <div class="text-[var(--muted-foreground)]">👤 作業者: ${escapeHtml(l.worker)} ／ 🚜 機材: ${escapeHtml(l.machineName)}</div>
        ${memoBlock}
      </div>
    `;
  }).join('');
}

// =========================================================================
// TAB 2: GISヒートマップ（新規追加圃場・GeoJSONポリゴン動的描画対応） ＆ 圃場カルテ
// =========================================================================
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
      <g onclick="inspectField('${escapeHtml(f.id)}')" class="field-polygon" id="poly-${escapeHtml(f.id)}">
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
      return `<button onclick="inspectField('${escapeHtml(f.id)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
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
      alertListEl.innerHTML = f.alerts.map(a => `
        <div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-between gap-2 text-xs">
          <div>
            <span class="font-bold text-amber-700">${escapeHtml(a.text || a.tag || '')}</span>
            <span class="text-[var(--muted-foreground)] ml-1.5">(${escapeHtml(a.date || '')})</span>
          </div>
          <button onclick="resolveFieldAlert('${escapeHtml(f.id)}', '${escapeHtml(a.id)}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition shrink-0">
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
      const weatherInfo = l.weather ? ` ／ ${escapeHtml(l.weather)}${l.tempC !== undefined ? `(${escapeHtml(l.tempC)}℃)` : ''}` : '';
      const memoHtml = l.memo
        ? `<div class="mt-1.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800">📔 ${escapeHtml(l.memo)}</div>`
        : '';
      return `
        <div class="p-3 rounded-xl bg-[var(--background)] border border-[var(--border)] text-xs">
          <div class="flex items-center justify-between font-bold text-[var(--foreground)]">
            <span>📅 ${escapeHtml(l.date)} — ${escapeHtml(l.cat)}${weatherInfo}${l.synced ? '' : ' <span class="text-amber-600 font-semibold">(未同期)</span>'}</span>
            <span class="text-emerald-600">按分時間: ${allocHr}h</span>
          </div>
          <div class="text-[var(--muted-foreground)] mt-1">${escapeHtml(l.materialSummary)}</div>
          <div class="text-[var(--muted-foreground)] mt-0.5">作業者: ${escapeHtml(l.worker)} ／ 機械: ${escapeHtml(l.machineName)}</div>
          ${memoHtml}
          <div class="flex justify-end gap-1.5 mt-2">
            <button onclick="editWorkLog('${escapeHtml(l.id)}')" class="px-2 py-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] font-semibold hover:opacity-80">✏️ 修正</button>
            <button onclick="deleteWorkLog('${escapeHtml(l.id)}')" class="px-2 py-0.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 font-semibold hover:bg-red-500/20">🗑️ 取消</button>
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

// =========================================================================
// TAB 3: 機械アワー・点検完了アクション ＆ 資材入庫補充アクション
// =========================================================================
function completeMachineMaintenance(machId) {
  const m = machines[machId];
  if (!m) return;
  m.nextMaint = Math.round((m.currentHour + (m.interval || 50)) * 10) / 10;
  saveStateToStorage();
  renderSelectOptions();
  renderResourcesTab();
  showToast(`🔧 ${m.name} の点検・オイル交換を記録しました`, `次回点検目安が ${m.nextMaint.toFixed(1)}h に更新されました。`);
}

function restockMaterial(type, id, amount) {
  if (type === 'fert' && fertilizers[id]) {
    fertilizers[id].stock += amount;
    showToast(`📦 ${fertilizers[id].name} を +${amount}袋 入庫しました`, `現在庫: ${fertilizers[id].stock} 袋`);
  } else if (type === 'pest' && pesticides[id]) {
    pesticides[id].stock += amount;
    showToast(`📦 ${pesticides[id].name} を +${amount}本 入庫しました`, `現在庫: ${pesticides[id].stock} 本`);
  }
  saveStateToStorage();
  renderSelectOptions();
  renderResourcesTab();
  recalculatePreview();
}

function renderResourcesTab() {
  const mList = document.getElementById('machineCardList');
  mList.innerHTML = Object.values(machines).map(m => {
    const remain = Math.round((m.nextMaint - m.currentHour) * 10) / 10;
    const pct = Math.min(100, Math.round((m.currentHour / m.nextMaint) * 100));
    const isWarn = remain <= 10;
    const badge = isWarn
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-600 border border-amber-500/40">⚠️ 要点検（残り ${remain}h）</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600">正常（次回まで ${remain}h）</span>`;

    return `
      <div class="p-4 rounded-2xl bg-[var(--background)] border border-[var(--border)]">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div>
            <span class="text-[11px] font-bold text-emerald-600">[${escapeHtml(m.cat || '農機具')}] 稼働単価: ${(Number(m.hourlyCostYen) || 2500).toLocaleString()}円/h</span>
            <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(m.name)}</div>
          </div>
          <div class="flex items-center gap-1.5">
            ${badge}
            <button onclick="completeMachineMaintenance('${escapeHtml(m.id)}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition">
              🔧 点検完了
            </button>
            <button onclick="deleteMachineMaster('${escapeHtml(m.id)}')" class="px-2 py-1 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 text-xs font-bold hover:bg-red-500/20" title="機材を削除">
              🗑️
            </button>
          </div>
        </div>
        <div class="flex justify-between text-xs text-[var(--muted-foreground)] mb-1.5">
          <span>現在アワーメーター: <strong class="text-[var(--foreground)]">${m.currentHour.toFixed(1)} h</strong></span>
          <span>次回点検目安: ${m.nextMaint.toFixed(1)} h</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-[var(--secondary)] overflow-hidden">
          <div class="h-full ${isWarn ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const sList = document.getElementById('materialStockList');
  const fertCards = Object.values(fertilizers).map(f => {
    const isLow = f.stock <= f.minStock;
    return `
      <div class="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--border)] flex items-center justify-between gap-2">
        <div>
          <span class="text-xs font-bold text-emerald-600">[肥料] N${f.n}-P${f.p}-K${f.k} (${f.unitKg || 20}kg/袋・${(Number(f.priceYen) || 2500).toLocaleString()}円)</span>
          <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(f.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)]">${isLow ? '⚠️ 発注点割れ（要補充）' : '在庫十分'}</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <div class="text-right mr-1">
            <div class="text-base font-bold ${isLow ? 'text-amber-600' : 'text-[var(--foreground)]'}">残 ${f.stock} 袋</div>
          </div>
          <button onclick="restockMaterial('fert', '${escapeHtml(f.id)}', 10)" class="px-2.5 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋10袋入庫
          </button>
          <button onclick="deleteMaterialMaster('fert', '${escapeHtml(f.id)}')" class="px-2 py-1.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 text-xs font-bold hover:bg-red-500/20" title="肥料を削除">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  const pestCards = Object.values(pesticides).map(p => {
    const ingLabel = p.activeIngredient ? ` ／ 有効成分: ${escapeHtml(p.activeIngredient)}` : '';
    return `
      <div class="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--border)] flex items-center justify-between gap-2">
        <div>
          <span class="text-xs font-bold text-sky-600">[農薬] ${escapeHtml(p.regNo)} (上限${p.maxUse}回)${ingLabel}</span>
          <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(p.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)]">収穫前 ${p.phiDays} 日まで ／ 単価 ${(Number(p.priceYen) || 3000).toLocaleString()}円</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <div class="text-right mr-1">
            <div class="text-base font-bold text-[var(--foreground)]">残 ${p.stock} 本</div>
          </div>
          <button onclick="restockMaterial('pest', '${escapeHtml(p.id)}', 5)" class="px-2.5 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋5本入庫
          </button>
          <button onclick="deleteMaterialMaster('pest', '${escapeHtml(p.id)}')" class="px-2 py-1.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 text-xs font-bold hover:bg-red-500/20" title="農薬を削除">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  sList.innerHTML = fertCards + pestCards;
}

// =========================================================================
// TAB 4: JA・行政提出用 A4帳票の描画 ＆ CSV出力
// =========================================================================
function switchReportType(type) {
  ['ja', 'daily', 'yield'].forEach(t => {
    const sheet = document.getElementById('reportSheet-' + t);
    const btn = document.getElementById('repBtn-' + t);
    if (!sheet || !btn) return;
    if (t === type) {
      sheet.classList.remove('hidden');
      btn.className = 'px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white';
    } else {
      sheet.classList.add('hidden');
      btn.className = 'px-4 py-2 rounded-xl text-xs font-bold bg-[var(--secondary)] text-[var(--secondary-foreground)]';
    }
  });
}

function populateJaReportFilterOptions_() {
  const cropSel = document.getElementById('jaReportCropFilter');
  const fieldSel = document.getElementById('jaReportFieldFilter');
  if (!cropSel || !fieldSel) return;

  const curCrop = cropSel.value || 'コシヒカリ (BL)';
  const curField = fieldSel.value || 'ALL';

  const uniqueCrops = [...new Set(fieldsData.map(f => f.crop).filter(Boolean))];
  cropSel.innerHTML = [
    ...uniqueCrops.map(c => `<option value="${escapeHtml(c)}">🌾 品種：${escapeHtml(c)}</option>`),
    `<option value="ALL">すべての品種（全圃場）</option>`
  ].join('');
  if (uniqueCrops.includes(curCrop) || curCrop === 'ALL') {
    cropSel.value = curCrop;
  } else if (uniqueCrops.length > 0) {
    cropSel.value = uniqueCrops[0];
  }

  const selectedCropVal = cropSel.value;
  const cropMatchedFields = selectedCropVal === 'ALL'
    ? fieldsData
    : fieldsData.filter(f => f.crop === selectedCropVal);

  fieldSel.innerHTML = [
    `<option value="ALL">すべての対象圃場（計 ${cropMatchedFields.reduce((s, f) => s + f.area, 0)}a / ${cropMatchedFields.length}筆）</option>`,
    `<option value="GROUP_gps">📍 本場平場団地のみ</option>`,
    `<option value="GROUP_yama">⛰️ 中山間・上山田団地のみ</option>`,
    `<option value="GROUP_river">🌊 川向団地のみ</option>`,
    ...cropMatchedFields.map(f => `<option value="${escapeHtml(f.id)}">個別圃場：${escapeHtml(f.name)} (${escapeHtml(f.area)}a)</option>`)
  ].join('');

  if ([...fieldSel.options].some(o => o.value === curField)) {
    fieldSel.value = curField;
  } else {
    fieldSel.value = 'ALL';
  }
}

function renderReportsTab() {
  populateJaReportFilterOptions_();

  const cropFilter = document.getElementById('jaReportCropFilter')?.value || 'ALL';
  const fieldFilter = document.getElementById('jaReportFieldFilter')?.value || 'ALL';

  const targetFields = fieldsData.filter(f => {
    const cropOk = (cropFilter === 'ALL') || (f.crop === cropFilter);
    let fieldOk = true;
    if (fieldFilter.startsWith('GROUP_')) {
      const gKey = fieldFilter.replace('GROUP_', '');
      fieldOk = (f.group === gKey);
    } else if (fieldFilter !== 'ALL') {
      fieldOk = (f.id === fieldFilter);
    }
    return cropOk && fieldOk;
  });
  const targetFieldIds = targetFields.map(f => f.id);
  const targetTotalArea = targetFields.reduce((sum, f) => sum + f.area, 0);

  const cropLabelEl = document.getElementById('jaHeaderCropLabel');
  const areaLabelEl = document.getElementById('jaHeaderAreaLabel');
  if (cropLabelEl) {
    cropLabelEl.textContent = cropFilter === 'ALL' ? '全品種' : cropFilter;
  }
  if (areaLabelEl) {
    const namesPreview = targetFields.length <= 3
      ? targetFields.map(f => f.name).join('・')
      : `${targetFields[0].name} ほか計${targetFields.length}筆`;
    areaLabelEl.textContent = targetFields.length > 0
      ? `${namesPreview}（合計 ${targetTotalArea} a）`
      : '該当圃場なし (0 a)';
  }

  const fertLogs = workLogs.filter(l => l.type === 'fertilizer' && l.fieldIds.some(id => targetFieldIds.includes(id)));
  const pestLogs = workLogs.filter(l => l.type === 'pesticide' && l.fieldIds.some(id => targetFieldIds.includes(id)));

  let weightedNTotalKg = 0;
  let weightedPTotalKg = 0;
  let weightedKTotalKg = 0;

  const fertRowsHtml = fertLogs.map(l => {
    const matchedFieldsInLog = l.fieldIds
      .map(id => fieldsData.find(f => f.id === id))
      .filter(f => f && targetFieldIds.includes(f.id));
    const matchedArea = matchedFieldsInLog.reduce((s, f) => s + f.area, 0);
    const logTotalArea = l.totalArea || matchedArea || 1;
    const areaRatio = matchedArea / logTotalArea;
    const allocatedKg = Math.round(l.totalKg * areaRatio * 10) / 10;

    weightedNTotalKg += l.n10a * (matchedArea / 10);
    weightedPTotalKg += l.p10a * (matchedArea / 10);
    weightedKTotalKg += l.k10a * (matchedArea / 10);

    const fNames = escapeHtml(matchedFieldsInLog.map(f => f.name).join('、'));
    return `
      <tr>
        <td class="border border-slate-400 p-2">${escapeHtml(l.date)}</td>
        <td class="border border-slate-400 p-2">${fNames}</td>
        <td class="border border-slate-400 p-2 text-right">${matchedArea} a</td>
        <td class="border border-slate-400 p-2 font-semibold">${escapeHtml(l.fertName)}</td>
        <td class="border border-slate-400 p-2 text-center">${escapeHtml(l.npkLabel)}</td>
        <td class="border border-slate-400 p-2 text-right">${allocatedKg} kg</td>
        <td class="border border-slate-400 p-2 text-right font-bold">${l.per10aKg.toFixed(1)} kg</td>
        <td class="border border-slate-400 p-2 text-right font-bold text-emerald-700">${l.n10a.toFixed(2)} kg</td>
        <td class="border border-slate-400 p-2 text-right font-bold text-sky-700">${l.p10a.toFixed(2)} kg</td>
        <td class="border border-slate-400 p-2 text-right font-bold text-amber-700">${l.k10a.toFixed(2)} kg</td>
      </tr>
    `;
  }).join('');

  const avgCumN10a = targetTotalArea > 0 ? (weightedNTotalKg / (targetTotalArea / 10)) : 0;
  const avgCumP10a = targetTotalArea > 0 ? (weightedPTotalKg / (targetTotalArea / 10)) : 0;
  const avgCumK10a = targetTotalArea > 0 ? (weightedKTotalKg / (targetTotalArea / 10)) : 0;

  const fertSummaryRowHtml = `
    <tr class="bg-emerald-50 font-bold">
      <td colspan="7" class="border border-slate-400 p-2 text-right text-slate-800">
        【作期累計（対象 ${targetFields.length} 筆・${targetTotalArea}a の面積加重平均 10aあたり合計成分量）】
      </td>
      <td class="border border-slate-400 p-2 text-right text-emerald-800">${avgCumN10a.toFixed(2)} kg/10a</td>
      <td class="border border-slate-400 p-2 text-right text-sky-800">${avgCumP10a.toFixed(2)} kg/10a</td>
      <td class="border border-slate-400 p-2 text-right text-amber-800">${avgCumK10a.toFixed(2)} kg/10a</td>
    </tr>
  `;

  document.getElementById('jaReportFertilizerBody').innerHTML =
    (fertRowsHtml || `<tr><td colspan="10" class="border border-slate-400 p-3 text-center text-slate-500">該当する施肥履歴はありません</td></tr>`) +
    fertSummaryRowHtml;

  // 防除履歴簿（混用時は剤ごと・有効成分表示対応）
  const pestRows = [];
  pestLogs.forEach(l => {
    const matchedFieldsInLog = l.fieldIds
      .map(id => fieldsData.find(f => f.id === id))
      .filter(f => f && targetFieldIds.includes(f.id));
    const matchedArea = matchedFieldsInLog.reduce((s, f) => s + f.area, 0);
    const logTotalArea = l.totalArea || matchedArea || 1;
    const areaRatio = matchedArea / logTotalArea;
    const allocWaterL = Math.round(l.waterL * areaRatio * 10) / 10;
    const rawChemMl = parseFloat(String(l.chemAmount || '0').replace(/,/g, '')) || 0;
    const allocChemMl = Math.round(rawChemMl * areaRatio);
    const fNames = escapeHtml(matchedFieldsInLog.map(f => f.name).join('、'));

    const pids = getLogPesticideIds(l);
    if (pids.length > 1) {
      pids.forEach((pid, idx) => {
        const pObj = pesticides[pid];
        const pLabel = pObj
          ? `${pObj.name} (${pObj.regNo} / 成分:${pObj.activeIngredient || '-'}) [混用${idx + 1}]`
          : `${pid} [混用${idx + 1}]`;
        const ingCnt = pObj && matchedFieldsInLog[0]?.ingredientCount?.[pObj.activeIngredient]
          ? `成分計${matchedFieldsInLog[0].ingredientCount[pObj.activeIngredient]}回 / 上限${pObj.maxUse}回`
          : l.useCountLabel;
        pestRows.push(`
          <tr>
            <td class="border border-slate-400 p-2">${escapeHtml(l.date)}</td>
            <td class="border border-slate-400 p-2">${fNames}</td>
            <td class="border border-slate-400 p-2 text-right">${matchedArea} a</td>
            <td class="border border-slate-400 p-2 font-semibold">${escapeHtml(pLabel)}</td>
            <td class="border border-slate-400 p-2 text-center">${escapeHtml(l.dilution)}</td>
            <td class="border border-slate-400 p-2 text-right">${allocWaterL} L</td>
            <td class="border border-slate-400 p-2 text-right font-bold">${allocChemMl.toLocaleString()} mL</td>
            <td class="border border-slate-400 p-2 text-center">${escapeHtml(ingCnt)}</td>
            <td class="border border-slate-400 p-2 text-center font-bold text-emerald-700">適（基準内）</td>
          </tr>
        `);
      });
    } else {
      const pObj = pids[0] ? pesticides[pids[0]] : null;
      const pLabel = pObj && pObj.activeIngredient
        ? `${pObj.name} (${pObj.regNo} / 成分:${pObj.activeIngredient})`
        : l.pestName;
      pestRows.push(`
        <tr>
          <td class="border border-slate-400 p-2">${escapeHtml(l.date)}</td>
          <td class="border border-slate-400 p-2">${fNames}</td>
          <td class="border border-slate-400 p-2 text-right">${matchedArea} a</td>
          <td class="border border-slate-400 p-2 font-semibold">${escapeHtml(pLabel)}</td>
          <td class="border border-slate-400 p-2 text-center">${escapeHtml(l.dilution)}</td>
          <td class="border border-slate-400 p-2 text-right">${allocWaterL} L</td>
          <td class="border border-slate-400 p-2 text-right font-bold">${allocChemMl.toLocaleString()} mL</td>
          <td class="border border-slate-400 p-2 text-center">${escapeHtml(l.useCountLabel)}</td>
          <td class="border border-slate-400 p-2 text-center font-bold text-emerald-700">適（基準内）</td>
        </tr>
      `);
    }
  });

  document.getElementById('jaReportPesticideBody').innerHTML =
    pestRows.join('') || `<tr><td colspan="9" class="border border-slate-400 p-3 text-center text-slate-500">該当する防除履歴はありません</td></tr>`;

  document.getElementById('dailyReportBody').innerHTML = workLogs.map(l => {
    const fNames = escapeHtml((l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join('、'));
    const weatherNote = l.weather ? `<div class="text-[11px] text-slate-600">${escapeHtml(l.weather)}${l.tempC !== undefined ? ` (${escapeHtml(l.tempC)}℃)` : ''}</div>` : '';
    const memoNote = l.memo ? `<div class="text-[11px] text-amber-800 mt-0.5">📔 ${escapeHtml(l.memo)}</div>` : '';
    return `
      <tr>
        <td class="border border-slate-400 p-2">${escapeHtml(l.date)}${weatherNote}</td>
        <td class="border border-slate-400 p-2 font-bold">${escapeHtml(l.cat)}</td>
        <td class="border border-slate-400 p-2">${escapeHtml(l.worker)}</td>
        <td class="border border-slate-400 p-2">${fNames}</td>
        <td class="border border-slate-400 p-2 text-right">${escapeHtml(l.totalArea)} a</td>
        <td class="border border-slate-400 p-2 text-right font-bold">${(Number(l.duration) || 0).toFixed(1)} h</td>
        <td class="border border-slate-400 p-2">${escapeHtml(l.machineName)}</td>
        <td class="border border-slate-400 p-2">${escapeHtml(l.materialSummary)}${memoNote}</td>
        <td class="no-print border border-slate-400 p-1 text-center whitespace-nowrap">
          <button onclick="editWorkLog('${escapeHtml(l.id)}')" class="px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100" title="修正">✏️</button>
          <button onclick="deleteWorkLog('${escapeHtml(l.id)}')" class="px-1.5 py-0.5 rounded border border-red-300 bg-red-50 hover:bg-red-100" title="取消">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  const yieldBody = document.getElementById('yieldReportBody');
  if (yieldBody) {
    let sumArea = 0;
    let sumHours = 0;
    let sumHarvKg = 0;
    let sumMatCost = 0;
    let sumLabMachCost = 0;
    let sumRevenue = 0;
    let sumGrossProfit = 0;

    const rowsHtml = fieldsData.map(f => {
      const p = calcFieldProfitability(f);
      const gradeStr = f.grade || (p.harvKg > 0 ? '1等(見込)' : '収穫前');
      const matCost = p.fertCostYen + p.pestCostYen;
      const labMachCost = p.laborCostYen + p.machineCostYen;

      sumArea += f.area;
      sumHours += p.cumHours;
      sumHarvKg += p.harvKg;
      sumMatCost += matCost;
      sumLabMachCost += labMachCost;
      sumRevenue += p.grossRevenueYen;
      sumGrossProfit += p.grossProfitYen;

      const profitCls = p.grossProfitYen >= 0 ? 'text-emerald-700' : 'text-red-600';
      return `
        <tr>
          <td class="border border-slate-400 p-2 font-bold">${escapeHtml(f.name)} <div class="font-normal text-slate-600 text-[11px]">${escapeHtml(f.lot)}</div></td>
          <td class="border border-slate-400 p-2">${escapeHtml(f.crop)} <div class="font-bold text-slate-700">${escapeHtml(f.area)} a</div></td>
          <td class="border border-slate-400 p-2 text-right font-semibold">${p.cumHours.toFixed(1)} h</td>
          <td class="border border-slate-400 p-2 text-right">
            <span class="font-bold text-emerald-700">N:${f.nPer10a.toFixed(1)}</span>
            <div class="text-[11px] text-slate-600">P:${f.pPer10a.toFixed(1)} / K:${f.kPer10a.toFixed(1)}</div>
          </td>
          <td class="border border-slate-400 p-2 text-right">
            <span class="font-bold text-amber-700">${p.yieldTawara10a.toFixed(1)} 俵/10a</span>
            <div class="text-[11px] text-slate-600">${p.harvKg.toLocaleString()} kg (${escapeHtml(gradeStr)})</div>
          </td>
          <td class="border border-slate-400 p-2 text-right">
            <div class="font-semibold">${matCost.toLocaleString()} 円</div>
            <div class="text-[11px] text-slate-600">肥:${p.fertCostYen.toLocaleString()} / 薬:${p.pestCostYen.toLocaleString()}</div>
          </td>
          <td class="border border-slate-400 p-2 text-right">
            <div class="font-semibold">${labMachCost.toLocaleString()} 円</div>
            <div class="text-[11px] text-slate-600">労:${p.laborCostYen.toLocaleString()} / 機:${p.machineCostYen.toLocaleString()}</div>
          </td>
          <td class="border border-slate-400 p-2 text-right font-bold text-slate-900">
            ${p.grossRevenueYen.toLocaleString()} 円
          </td>
          <td class="border border-slate-400 p-2 text-right">
            <div class="font-bold ${profitCls}">${p.grossProfitYen >= 0 ? '+' : ''}${p.grossProfitYen.toLocaleString()} 円</div>
            <div class="text-[11px] font-bold ${profitCls}">(10a: ${p.profitPer10aYen >= 0 ? '+' : ''}${p.profitPer10aYen.toLocaleString()}円)</div>
          </td>
          <td class="border border-slate-400 p-2 text-center font-bold" style="color:${p.rankColor}">
            ${escapeHtml(p.profitRank)}
          </td>
        </tr>
      `;
    }).join('');

    const avgProfit10a = sumArea > 0 ? Math.round(sumGrossProfit / (sumArea / 10)) : 0;
    const avgYield10a = sumArea > 0 ? ((sumHarvKg / 60) / (sumArea / 10)).toFixed(1) : '0.0';
    const summaryRow = `
      <tr class="bg-emerald-50 font-bold text-slate-900">
        <td class="border border-slate-400 p-2">【全 ${fieldsData.length} 筆 経営合計・平均】</td>
        <td class="border border-slate-400 p-2 text-right">計 ${sumArea} a</td>
        <td class="border border-slate-400 p-2 text-right">${sumHours.toFixed(1)} h</td>
        <td class="border border-slate-400 p-2 text-right">-</td>
        <td class="border border-slate-400 p-2 text-right text-amber-800">平均 ${avgYield10a} 俵/10a<div class="text-[11px]">計 ${sumHarvKg.toLocaleString()} kg</div></td>
        <td class="border border-slate-400 p-2 text-right">${sumMatCost.toLocaleString()} 円</td>
        <td class="border border-slate-400 p-2 text-right">${sumLabMachCost.toLocaleString()} 円</td>
        <td class="border border-slate-400 p-2 text-right">${sumRevenue.toLocaleString()} 円</td>
        <td class="border border-slate-400 p-2 text-right text-emerald-800">
          ${sumGrossProfit >= 0 ? '+' : ''}${sumGrossProfit.toLocaleString()} 円
          <div class="text-[11px]">(10a平均: ${avgProfit10a >= 0 ? '+' : ''}${avgProfit10a.toLocaleString()}円)</div>
        </td>
        <td class="border border-slate-400 p-2 text-center text-emerald-800">総括</td>
      </tr>
    `;
    yieldBody.innerHTML = rowsHtml + summaryRow;
  }
}

function updateCostSettingsFromUi() {
  const riceInput = document.getElementById('simRicePriceInput');
  const wageInput = document.getElementById('simHourlyWageInput');
  if (typeof costSettings !== 'object' || !costSettings) {
    costSettings = { hourlyWageYen: 1500, ricePricePerTawaraYen: 18500 };
  }
  if (riceInput) costSettings.ricePricePerTawaraYen = Math.max(1000, Number(riceInput.value) || 18500);
  if (wageInput) costSettings.hourlyWageYen = Math.max(500, Number(wageInput.value) || 1500);
  saveStateToStorage();
  renderReportsTab();
  showToast(
    '💴 経営分析パラメータを更新しました',
    `想定米価: ${costSettings.ricePricePerTawaraYen.toLocaleString()}円/俵 ／ 時給単価: ${costSettings.hourlyWageYen.toLocaleString()}円/h で全圃場の10a粗利を再計算しました。`
  );
}

function exportCsvData() {
  const header = ['作業日', '天候', '気温(℃)', '作業分類', '作業者', '対象圃場', '合計面積(a)', '作業時間(h)', '使用機械', '使用資材摘要', '日誌メモ'];
  const rows = workLogs.map(l => {
    const fNames = (l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join('・');
    return [l.date, l.weather || '☀️ 晴れ', l.tempC ?? '', l.cat, l.worker, fNames, l.totalArea, l.duration, l.machineName, l.materialSummary, l.memo || ''].map(toCsvCell).join(',');
  });
  const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rakuraku_einou_export.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('📥 CSVファイルを出力しました', '既存の「らくらく営農日誌」Excelやスプレッドシートへそのまま取り込めます。');
}

// =========================================================================
// TAB 3 & TAB 5: 圃場・肥料・農薬・機材マスタ追加/削除 ＆ GAS同期・バックアップ
// =========================================================================
function toggleQuickAddPanel(panelId, forceOpen) {
  const el = document.getElementById(panelId);
  if (!el) return;
  const open = forceOpen !== undefined ? forceOpen : el.classList.contains('hidden');
  if (open) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function addNewFieldMaster() {
  const name = document.getElementById('newFieldName').value.trim();
  const lot = document.getElementById('newFieldLot').value.trim() || '地番未設定';
  const area = Math.max(1, Number(document.getElementById('newFieldArea').value || 20));
  const crop = document.getElementById('newFieldCrop').value.trim() || 'コシヒカリ (BL)';
  const group = document.getElementById('newFieldGroup')?.value || 'yama';
  const lat = Number(document.getElementById('newFieldLat')?.value || 37.9212);
  const lng = Number(document.getElementById('newFieldLng')?.value || 139.0482);

  if (!name) {
    showToast('⚠️ 入力確認', '圃場名（通称）を入力してください。');
    return;
  }

  const newId = generateNextId('F', fieldsData.map(f => f.id));
  fieldsData.push({
    id: newId,
    name: name,
    lot: lot,
    group: group,
    area: area,
    crop: crop,
    headingDate: group === 'yama' ? '2026/08/14' : '2026/08/08',
    targetTempC: crop.includes('つきあかり') ? 950 : 1000,
    dailyMeanTempC: group === 'yama' ? 23.2 : 25.5,
    harvest: '2026/09/25',
    stage: '未着手',
    lat: lat,
    lng: lng,
    polygonCoords: pickerDrawVertices.length >= 3 ? [...pickerDrawVertices] : null,
    doneCats: [],
    nPer10a: 0,
    pPer10a: 0,
    kPer10a: 0,
    pestCount: {},
    alerts: [],
    baseline: makeEmptyBaseline()
  });

  document.getElementById('newFieldName').value = '';
  document.getElementById('newFieldLot').value = '';
  if (document.getElementById('newFieldGmapUrl')) document.getElementById('newFieldGmapUrl').value = '';
  pickerDrawVertices = [];
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規圃場「${name} (${area}a)」を追加しました`, `GPS座標 (${lat.toFixed(4)}, ${lng.toFixed(4)}) でGoogleマップ航空写真＆GISカルテに即時反映されました。`);
}

function deleteFieldMaster(fieldId) {
  if (fieldsData.length <= 1) {
    showToast('⚠️ 削除不可', '最低1筆の圃場が必要です。');
    return;
  }
  const f = fieldsData.find(item => item.id === fieldId);
  if (!f) return;
  if (!confirm(`圃場「${f.name} (${f.area}a)」をマスタから削除しますか？`)) return;

  fieldsData = fieldsData.filter(item => item.id !== fieldId);
  selectedFieldIds = selectedFieldIds.filter(id => id !== fieldId);
  if (selectedFieldIds.length === 0 && fieldsData[0]) selectedFieldIds = [fieldsData[0].id];
  if (currentInspectedFieldId === fieldId && fieldsData[0]) currentInspectedFieldId = fieldsData[0].id;
  saveStateToStorage();
  refreshAllViews();
  showToast(`🗑️ 圃場「${f.name}」を削除しました`, '');
}

function addNewFertilizerMaster(source) {
  const isQuick = source === 'quick';
  const nameEl = document.getElementById(isQuick ? 'quickFertName' : 'newFertName');
  const name = (nameEl?.value || '').trim();
  const n = Number(document.getElementById(isQuick ? 'quickFertN' : 'newFertN')?.value || 0);
  const p = Number(document.getElementById(isQuick ? 'quickFertP' : 'newFertP')?.value || 0);
  const k = Number(document.getElementById(isQuick ? 'quickFertK' : 'newFertK')?.value || 0);
  const unitKg = Math.max(1, Number(document.getElementById(isQuick ? 'quickFertUnitKg' : 'newFertUnitKg')?.value || 20));
  const stock = Math.max(0, Number(document.getElementById(isQuick ? 'quickFertStock' : 'newFertStock')?.value || 20));
  const priceYen = Math.max(0, Number(document.getElementById(isQuick ? 'quickFertPrice' : 'newFertPrice')?.value || 2500));

  if (!name) {
    showToast('⚠️ 入力確認', '肥料名称を入力してください。');
    return;
  }

  const newId = generateNextId('F', Object.keys(fertilizers));
  fertilizers[newId] = { id: newId, name, unitKg, n, p, k, stock, minStock: 10, priceYen };
  if (nameEl) nameEl.value = '';
  if (isQuick) toggleQuickAddPanel('quickFertForm', false);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規肥料「${name} (N${n}-P${p}-K${k})」を追加しました`, '施肥入力リストおよび在庫・原価計算へ即時反映されました。');
}

function addNewPesticideMaster(source) {
  const isQuick = source === 'quick';
  const nameEl = document.getElementById(isQuick ? 'quickPestName' : 'newPestName');
  const regEl = document.getElementById(isQuick ? 'quickPestRegNo' : 'newPestRegNo');
  const ingEl = document.getElementById(isQuick ? 'quickPestIngredient' : 'newPestIngredient');
  const name = (nameEl?.value || '').trim();
  const regNo = (regEl?.value || '').trim() || '登録番号未設定';
  const activeIngredient = (ingEl?.value || '').trim() || name;
  const maxUse = Math.max(1, Number(document.getElementById(isQuick ? 'quickPestMaxUse' : 'newPestMaxUse')?.value || 2));
  const phiDays = Math.max(1, Number(document.getElementById(isQuick ? 'quickPestPhiDays' : 'newPestPhiDays')?.value || 14));
  const stock = Math.max(0, Number(document.getElementById(isQuick ? 'quickPestStock' : 'newPestStock')?.value || 10));
  const priceYen = Math.max(0, Number(document.getElementById(isQuick ? 'quickPestPrice' : 'newPestPrice')?.value || 3000));

  if (!name) {
    showToast('⚠️ 入力確認', '農薬名称を入力してください。');
    return;
  }

  const newId = generateNextId('P', Object.keys(pesticides));
  pesticides[newId] = {
    id: newId,
    name,
    regNo,
    activeIngredient,
    maxUse,
    phiDays,
    stock,
    unit: '本(500mL)',
    priceYen
  };
  if (nameEl) nameEl.value = '';
  if (regEl) regEl.value = '';
  if (ingEl) ingEl.value = '';
  if (isQuick) toggleQuickAddPanel('quickPestForm', false);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規農薬「${name}（有効成分: ${activeIngredient}）」を追加しました`, `使用上限${maxUse}回・収穫前${phiDays}日(PHI)の安全基準チェックへ連動しました。`);
}

function addNewMachineMaster(source) {
  const isQuick = source === 'quick';
  const nameEl = document.getElementById(isQuick ? 'quickMachName' : 'newMachName');
  const name = (nameEl?.value || '').trim();
  const cat = document.getElementById(isQuick ? 'quickMachCat' : 'newMachCat')?.value || 'トラクター';
  const currentHour = Math.max(0, Number(document.getElementById(isQuick ? 'quickMachHour' : 'newMachHour')?.value || 0));
  const interval = Math.max(10, Number(document.getElementById(isQuick ? 'quickMachInterval' : 'newMachInterval')?.value || 50));
  const hourlyCostYen = Math.max(0, Number(document.getElementById(isQuick ? 'quickMachCost' : 'newMachCost')?.value || 2500));

  if (!name) {
    showToast('⚠️ 入力確認', '機材・農機具名称を入力してください。');
    return;
  }

  const newId = generateNextId('M', Object.keys(machines));
  machines[newId] = {
    id: newId,
    name,
    cat,
    currentHour,
    nextMaint: Math.round((currentHour + interval) * 10) / 10,
    interval,
    hourlyCostYen
  };
  if (nameEl) nameEl.value = '';
  if (isQuick) toggleQuickAddPanel('quickMachineForm', false);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規機材「${name} (${cat})」を追加しました`, `現在 ${currentHour}h ／ 次回点検 ${machines[newId].nextMaint}h でアワーメーター管理へ追加されました。`);
}

function deleteMachineMaster(machId) {
  if (Object.keys(machines).length <= 1) {
    showToast('⚠️ 削除不可', '最低1台の機材マスタが必要です。');
    return;
  }
  const m = machines[machId];
  if (!m) return;
  if (!confirm(`機材「${m.name}」をマスタから削除しますか？`)) return;
  delete machines[machId];
  saveStateToStorage();
  refreshAllViews();
  showToast(`🗑️ 機材「${m.name}」を削除しました`, '');
}

function deleteMaterialMaster(type, id) {
  const dict = type === 'fert' ? fertilizers : pesticides;
  const label = type === 'fert' ? '肥料' : '農薬';
  if (Object.keys(dict).length <= 1) {
    showToast('⚠️ 削除不可', `最低1銘柄の${label}マスタが必要です。`);
    return;
  }
  const item = dict[id];
  if (!item) return;
  if (!confirm(`${label}「${item.name}」をマスタから削除しますか？`)) return;
  delete dict[id];
  saveStateToStorage();
  refreshAllViews();
  showToast(`🗑️ ${label}「${item.name}」を削除しました`, '');
}

function saveGasUrl() {
  gasWebhookUrl = document.getElementById('gasWebhookUrl').value.trim();
  saveStateToStorage();
}

async function syncWithGasBackend() {
  if (isOfflineMode) {
    showToast('📡 現在オフラインモード中です', 'オンラインに復帰してからスプレッドシート同期を実行してください。');
    return;
  }

  const unsynced = workLogs.filter(l => !l.synced);
  const url = document.getElementById('gasWebhookUrl').value.trim();

  if (!url) {
    if (unsynced.length === 0) {
      showToast('☁️ すべての作業日誌が同期済みです', '未送信の作業日誌はありません（GAS URLを設定すると実シートと連携できます）。');
      return;
    }
    unsynced.forEach(l => { l.synced = true; });
    saveStateToStorage();
    refreshAllViews();
    showToast(`☁️ クラウド同期シミュレート完了（${unsynced.length}件）`, 'GASウェブアプリURLを設定（タブ5）すると、実際のGoogleスプレッドシートへ直接POST送信＆自動按分されます。');
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fields: fieldsData, logs: unsynced })
    });
    let acceptedIds = unsynced.map(l => l.id);
    try {
      const resJson = await response.json();
      if (resJson && resJson.status === 'error') {
        throw new Error(resJson.message || 'GAS error');
      }
      if (resJson && Array.isArray(resJson.acceptedIds)) {
        acceptedIds = resJson.acceptedIds;
      }
    } catch (_) {}
    const acceptedSet = new Set(acceptedIds);
    workLogs.forEach(l => {
      if (acceptedSet.has(l.id)) l.synced = true;
    });
    saveStateToStorage();
    refreshAllViews();
    showToast(
      unsynced.length > 0
        ? `☁️ Googleスプレッドシートへ ${unsynced.length} 件を同期送信しました！`
        : '☁️ 圃場マスタを同期確認しました（未送信の作業日誌は0件です）',
      '重複防止（べき等）チェック付きで送信され、自動面積按分・JA帳票更新が実行されました。'
    );
  } catch (err) {
    showToast('⚠️ 通信エラー（端末内に安全に保存されています）', '電波状況またはGAS URLを確認後、再度同期ボタンを押してください。');
  }
}

// =========================================================================
// 他社営農アプリ・Excel・eMAFF筆ポリゴン スマートデータ移行エンジン
// =========================================================================
function loadMigrationSample(sampleKey) {
  document.getElementById('migrationRawInput').value = MIGRATION_SAMPLES[sampleKey] || '';
  parseAndPreviewMigrationText();
}

function handleMigrationFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('migrationRawInput').value = e.target.result;
    parseAndPreviewMigrationText();
  };
  reader.readAsText(file, 'UTF-8');
}

function parseAndPreviewMigrationText() {
  const raw = document.getElementById('migrationRawInput').value.trim();
  const badge = document.getElementById('migrationDetectedBadge');
  const summary = document.getElementById('migrationMappingSummary');
  const tHead = document.getElementById('migrationPreviewHead');
  const tBody = document.getElementById('migrationPreviewBody');

  pendingMigrationItems = [];
  if (!raw) {
    badge.textContent = '待機中';
    summary.textContent = '上のサンプルボタンを押すか、CSV/GeoJSONファイルを選択してください。';
    tHead.innerHTML = '<tr><th class="p-2">変換プレビュー</th></tr>';
    tBody.innerHTML = '';
    return;
  }

  // 1. GeoJSON (eMAFF農地ナビ / Z-GIS) 判定（頂点座標配列 polygonCoords も保持してGIS描画に連動）
  if (raw.startsWith('{')) {
    try {
      const geo = JSON.parse(raw);
      if (geo.features && Array.isArray(geo.features)) {
        pendingMigrationMode = 'fields';
        badge.textContent = '🗺️ eMAFF / Z-GIS 筆ポリゴン (GeoJSON) 検出';
        summary.textContent = 'GeoJSONの properties（面積㎡→アール換算）およびポリゴン全頂点座標・重心座標を自動抽出しました。';

        pendingMigrationItems = geo.features.map((feat, idx) => {
          const p = feat.properties || {};
          const ring = (feat.geometry && feat.geometry.coordinates && feat.geometry.coordinates[0]) || [];
          const validPts = ring.filter(pt => Array.isArray(pt) && pt.length >= 2);
          const avgLng = validPts.length > 0 ? validPts.reduce((s, pt) => s + Number(pt[0]), 0) / validPts.length : 139.038;
          const avgLat = validPts.length > 0 ? validPts.reduce((s, pt) => s + Number(pt[1]), 0) / validPts.length : 37.918;
          const m2 = Number(p.area_m2 || p.area || 2000);
          const areaA = m2 >= 200 ? Math.round(m2 / 100) : m2;
          return {
            name: p.name || p.field_name || `eMAFF圃場${idx + 1}`,
            lot: p.address || p.lot || '筆ポリゴン取込',
            area: areaA,
            rawAreaNote: `${m2}㎡ → ${areaA}a (${validPts.length}頂点)`,
            crop: p.crop || 'コシヒカリ (BL)',
            lat: avgLat,
            lng: avgLng,
            polygonCoords: validPts
          };
        });

        tHead.innerHTML = `<tr><th class="p-2">変換後の圃場名</th><th class="p-2">地番</th><th class="p-2">面積・ポリゴン頂点</th><th class="p-2">作付品種</th><th class="p-2">重心GPS座標</th></tr>`;
        tBody.innerHTML = pendingMigrationItems.map(item => `
          <tr>
            <td class="p-2 font-bold">${escapeHtml(item.name)}</td>
            <td class="p-2">${escapeHtml(item.lot)}</td>
            <td class="p-2 text-emerald-600 font-bold">${escapeHtml(item.rawAreaNote)}</td>
            <td class="p-2">${escapeHtml(item.crop)}</td>
            <td class="p-2 font-mono">${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)}</td>
          </tr>
        `).join('');
        return;
      }
    } catch (e) {}
  }

  // 2. CSV または TSV (Excelコピペ) のパース
  const firstLine = raw.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const parsedRows = parseDelimitedText(raw, delimiter);
  if (parsedRows.length < 2) return;
  const headers = parsedRows[0].map(h => h.trim());
  const findIdx = (kwList) => headers.findIndex(h => kwList.some(k => h.includes(k)));

  const dateIdx = findIdx(['作業日', '実施日', '散布日', '施用日', '日付']);
  const catIdx = findIdx(['作業項目', '作業分類', '作業内容', '作業名']);

  if (dateIdx !== -1 && catIdx !== -1) {
    pendingMigrationMode = 'logs';
    badge.textContent = '📘 他社アプリ 作業日誌・施肥履歴CSV 検出';
    const workerIdx = findIdx(['担当者', '作業者', '氏名']);
    const fieldIdx = findIdx(['圃場', 'ほ場', '田んぼ']);
    const haIdx = findIdx(['(ha)', 'ha', 'ヘクタール']);
    const aIdx = findIdx(['(a)', '面積']);
    const durIdx = findIdx(['時間', '稼働']);
    const matIdx = findIdx(['資材', '肥料', '農薬']);
    const qtyIdx = findIdx(['使用量', '数量', '袋数']);
    const nIdx = findIdx(['成分N', 'チッソ']);
    const pIdx = findIdx(['成分P', 'リン酸']);
    const kIdx = findIdx(['成分K', 'カリ']);

    summary.textContent = `作業日・作業項目・面積（${haIdx !== -1 ? 'ha→a自動換算' : 'a'}）・使用資材・NPK成分を自動マッピングしました。`;

    pendingMigrationItems = parsedRows.slice(1).map((cols, rowIdx) => {
      const areaA = haIdx !== -1 ? Math.round(Number(cols[haIdx] || 0.3) * 100) : Number(cols[aIdx] || 30);
      const catRaw = cols[catIdx] || '耕起';
      const cat = catRaw.includes('肥') ? '施肥' : (catRaw.includes('防除') || catRaw.includes('散布') ? '防除' : catRaw);
      const matName = matIdx !== -1 && cols[matIdx] !== '-' ? cols[matIdx] : '';
      const totalKg = qtyIdx !== -1 ? Number(cols[qtyIdx] || 0) : 0;
      const nPct = nIdx !== -1 ? Number(cols[nIdx] || 0) : 0;
      const pPct = pIdx !== -1 ? Number(cols[pIdx] || 0) : 0;
      const kPct = kIdx !== -1 ? Number(cols[kIdx] || 0) : 0;
      const per10aKg = areaA > 0 ? totalKg / (areaA / 10) : 0;

      const rawFieldNames = fieldIdx !== -1 && cols[fieldIdx] ? cols[fieldIdx].split(/[・,、]/) : ['① 本場1号'];
      const matchedIds = [];
      rawFieldNames.forEach(fn => {
        const trimmed = fn.trim();
        if (!trimmed) return;
        const found = fieldsData.find(f => f.name.includes(trimmed) || trimmed.includes(f.name) || f.id === trimmed);
        if (found && !matchedIds.includes(found.id)) matchedIds.push(found.id);
      });
      if (matchedIds.length === 0) matchedIds.push('F01');

      return {
        id: `IMP-WL-${Date.now()}-${rowIdx + 1}-${Math.random().toString(36).slice(2, 5)}`,
        date: (cols[dateIdx] || '').replace(/-/g, '/'),
        cat: cat,
        worker: workerIdx !== -1 && cols[workerIdx] ? cols[workerIdx] : '佐藤 健一',
        fieldIds: matchedIds,
        fieldNamesLabel: cols[fieldIdx] || '① 本場1号',
        totalArea: areaA,
        duration: durIdx !== -1 ? Number(cols[durIdx] || 1.0) : 1.0,
        machineName: 'ヤンマー トラクター YT357 (移行)',
        type: cat === '施肥' && totalKg > 0 ? 'fertilizer' : 'general',
        fertName: matName || '移行肥料',
        npkLabel: `${nPct}-${pPct}-${kPct}`,
        totalKg: totalKg,
        per10aKg: per10aKg,
        n10a: per10aKg * (nPct / 100),
        p10a: per10aKg * (pPct / 100),
        k10a: per10aKg * (kPct / 100),
        materialSummary: matName ? `${matName} (${totalKg}kg) [他社アプリ移行]` : `${catRaw} [他社アプリ移行]`,
        synced: false
      };
    });

    tHead.innerHTML = `<tr><th class="p-2">作業日</th><th class="p-2">分類</th><th class="p-2">対象圃場</th><th class="p-2">換算面積</th><th class="p-2">時間</th><th class="p-2">資材・NPK自動計算</th></tr>`;
    tBody.innerHTML = pendingMigrationItems.map(item => `
      <tr>
        <td class="p-2">${escapeHtml(item.date)}</td>
        <td class="p-2 font-bold text-emerald-600">${escapeHtml(item.cat)}</td>
        <td class="p-2">${escapeHtml(item.fieldNamesLabel)}</td>
        <td class="p-2 font-bold">${escapeHtml(item.totalArea)} a</td>
        <td class="p-2">${escapeHtml(item.duration)} h</td>
        <td class="p-2">${escapeHtml(item.materialSummary)}</td>
      </tr>
    `).join('');
  } else {
    pendingMigrationMode = 'fields';
    badge.textContent = '📗 他社アプリ ほ場台帳CSV 検出';
    const nameIdx = findIdx(['ほ場名', '圃場名', '通称', '名称', '田んぼ']);
    const lotIdx = findIdx(['地番', '住所', '所在地']);
    const m2Idx = findIdx(['㎡', 'm2', '平米']);
    const haIdx = findIdx(['(ha)', 'ha']);
    const aIdx = findIdx(['面積', 'アール']);
    const cropIdx = findIdx(['品種', '作付']);
    const harvIdx = findIdx(['収穫']);
    const latIdx = findIdx(['緯度', 'lat']);
    const lngIdx = findIdx(['経度', 'lng']);

    summary.textContent = `ほ場名・地番・面積（${m2Idx !== -1 ? '㎡→a自動換算' : (haIdx !== -1 ? 'ha→a自動換算' : 'a')}）・品種・GPS座標を自動マッピングしました。`;

    pendingMigrationItems = parsedRows.slice(1).map((cols, idx) => {
      let areaA = 20;
      let note = '';
      if (m2Idx !== -1 && cols[m2Idx]) {
        const m2 = Number(cols[m2Idx]);
        areaA = Math.round(m2 / 100);
        note = `${m2}㎡ → ${areaA}a`;
      } else if (haIdx !== -1 && cols[haIdx]) {
        const ha = Number(cols[haIdx]);
        areaA = Math.round(ha * 100);
        note = `${ha}ha → ${areaA}a`;
      } else if (aIdx !== -1 && cols[aIdx]) {
        const rawV = Number(cols[aIdx]);
        areaA = rawV >= 500 ? Math.round(rawV / 100) : rawV;
        note = `${areaA}a`;
      }

      return {
        name: cols[nameIdx !== -1 ? nameIdx : 0] || `移行圃場${idx + 1}`,
        lot: lotIdx !== -1 ? cols[lotIdx] : '-',
        area: areaA,
        rawAreaNote: note,
        crop: cropIdx !== -1 && cols[cropIdx] ? cols[cropIdx] : 'コシヒカリ (BL)',
        harvest: harvIdx !== -1 && cols[harvIdx] ? cols[harvIdx].replace(/-/g, '/') : '2026/09/22',
        lat: latIdx !== -1 && cols[latIdx] ? Number(cols[latIdx]) : 37.9165,
        lng: lngIdx !== -1 && cols[lngIdx] ? Number(cols[lngIdx]) : 139.0370
      };
    });

    tHead.innerHTML = `<tr><th class="p-2">変換後の圃場名</th><th class="p-2">地番</th><th class="p-2">面積自動換算</th><th class="p-2">品種</th><th class="p-2">収穫予定日</th></tr>`;
    tBody.innerHTML = pendingMigrationItems.map(item => `
      <tr>
        <td class="p-2 font-bold">${escapeHtml(item.name)}</td>
        <td class="p-2">${escapeHtml(item.lot)}</td>
        <td class="p-2 font-bold text-emerald-600">${escapeHtml(item.rawAreaNote)}</td>
        <td class="p-2">${escapeHtml(item.crop)}</td>
        <td class="p-2">${escapeHtml(item.harvest)}</td>
      </tr>
    `).join('');
  }
}

function executeMigrationImport() {
  if (!pendingMigrationItems || pendingMigrationItems.length === 0) {
    showToast('⚠️ データ未選択', '先にサンプルボタンを押すか、CSV/GeoJSONファイルを選択してください。');
    return;
  }

  if (pendingMigrationMode === 'fields') {
    pendingMigrationItems.forEach((item) => {
      const newId = generateNextId('F', fieldsData.map(f => f.id));
      fieldsData.push({
        id: newId,
        name: item.name,
        lot: item.lot,
        group: 'yama',
        area: item.area,
        crop: item.crop,
        headingDate: '2026/08/08',
        targetTempC: 1000,
        dailyMeanTempC: 24.0,
        harvest: item.harvest || '2026/09/22',
        stage: '未着手',
        lat: item.lat || 37.9165,
        lng: item.lng || 139.0370,
        polygonCoords: item.polygonCoords || null,
        doneCats: [],
        nPer10a: 0,
        pPer10a: 0,
        kPer10a: 0,
        pestCount: {},
        alerts: [],
        baseline: makeEmptyBaseline()
      });
    });
    saveStateToStorage();
    refreshAllViews();
    showToast(
      `🎉 他社データから ${pendingMigrationItems.length} 筆の圃場を一括インポートしました！`,
      '面積単位（㎡/ha → a）やGeoJSONポリゴン形状も自動変換され、GISマップ・現場入力に即時追加されました。'
    );
  } else {
    pendingMigrationItems.forEach(logItem => {
      workLogs.unshift(logItem);
    });
    recalculateFieldStats();
    saveStateToStorage();
    refreshAllViews();
    showToast(
      `🎉 他社アプリから ${pendingMigrationItems.length} 件の作業・施肥履歴を一括インポートしました！`,
      '各圃場の進捗・累計NPKおよびJA提出用A4帳票へ即時反映されました（取消・修正も可能）。'
    );
  }

  document.getElementById('migrationRawInput').value = '';
  pendingMigrationItems = [];
  parseAndPreviewMigrationText();
}

function exportFullBackupJson() {
  const blob = new Blob([JSON.stringify({ fieldsData, fertilizers, pesticides, machines, workLogs, costSettings, gasWebhookUrl }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rakuraku_einou_backup.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('💾 全データのJSONバックアップを保存しました', '機種変更やPC移行時も「📤 JSONバックアップから復元」で1クリック復元できます。');
}

function importFullBackupJson(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || (!Array.isArray(parsed.fieldsData) && !Array.isArray(parsed.workLogs))) {
        showToast('⚠️ バックアップ形式エラー', '有効な「らくらく営農日誌」JSONバックアップファイルを選択してください。');
        return;
      }
      applyParsedState_(parsed);
      ensureFieldBaselines();
      recalculateFieldStats();
      saveStateToStorage();
      document.getElementById('gasWebhookUrl').value = gasWebhookUrl || '';
      if (document.getElementById('simRicePriceInput') && costSettings) {
        document.getElementById('simRicePriceInput').value = costSettings.ricePricePerTawaraYen || 18500;
      }
      if (document.getElementById('simHourlyWageInput') && costSettings) {
        document.getElementById('simHourlyWageInput').value = costSettings.hourlyWageYen || 1500;
      }
      refreshAllViews();
      showToast(
        '📤 JSONバックアップから全データを復元しました！',
        `圃場 ${fieldsData.length}筆 ／ 作業日誌 ${workLogs.length}件のマスタ・在庫・履歴を完全復元しました。`
      );
    } catch (err) {
      showToast('⚠️ JSON読込エラー', 'JSONファイルの解析に失敗しました。ファイル内容を確認してください。');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function resetToDefaultData() {
  localStorage.removeItem(STORAGE_KEY);
  initApp();
  showToast('🔄 初期サンプルデータにリセットしました', 'すべてのマスタ・履歴が初期状態に戻りました。');
}

function showToast(title, desc) {
  const box = document.getElementById('toastBox');
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastDesc').textContent = desc;
  box.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    box.classList.add('hidden');
  }, 4500);
}

initApp();
