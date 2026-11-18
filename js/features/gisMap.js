// Feature: GPS, Leaflet Satellite Map, GIS Heatmap, Field Karte & Alerts
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
        <div class="font-bold text-amber-300">📡 現在オフラインのため航空写真タイル（国土地理院）を読み込めません</div>
        <div class="text-stone-300">下のボタンから各圃場を直接選択するか、オンライン復帰後に航空写真を表示できます。</div>
        <div class="flex flex-wrap justify-center gap-1.5 mt-2">
          ${fieldsData.map(f => {
            const active = target === 'input' ? selectedFieldIds.includes(f.id) : (f.id === currentInspectedFieldId);
            const actionName = target === 'input' ? 'toggleFieldSelection' : 'inspectField';
            return `<button type="button" data-action="${actionName}" data-arg="${escapeHtml(f.id)}" class="px-2.5 py-1 rounded-lg font-bold ${active ? 'bg-emerald-600 text-white' : 'bg-stone-700 text-stone-200'}">${escapeHtml(f.name)} (${f.area}a)</button>`;
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
    // 国土地理院「全国最新写真（シームレス）」タイル（出典表記で商用利用可）
    // ※ Googleのタイルサーバー直接参照は Google Maps Platform 利用規約に抵触するため使用しない
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', {
      maxZoom: 20,
      maxNativeZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>'
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

  // アップロード済みGPS写真ピンの描画（Tab 2 GISマップ / Tab 1 マップ共通）
  if ((target === 'gis' || target === 'input') && Array.isArray(window._uploadedGeoPhotos) && window._uploadedGeoPhotos.length > 0) {
    const geoPhotos = window._uploadedGeoPhotos.filter(p => p.hasGps && p.lat !== null && p.lng !== null);
    geoPhotos.forEach(p => {
      const thumbImg = p.thumbUrl
        ? `<img src="${escapeHtml(p.thumbUrl)}" alt="" style="width:120px;height:80px;object-fit:cover;border-radius:6px;margin-bottom:4px;">`
        : '';
      const matchTxt = p.matchedFieldName
        ? `判別: <b>${escapeHtml(p.matchedFieldName)}</b> (${p.inPolygon ? '圃場内確定' : `${p.distM}m`})`
        : '未登録エリア';
      const popupHtml = `
        <div style="font-size:11px;line-height:1.4;min-width:130px;">
          ${thumbImg}
          <div><b>📷 ${escapeHtml(p.filename)}</b></div>
          <div>${matchTxt}</div>
          ${p.takenAt ? `<div style="color:#64748b;">${escapeHtml(p.takenAt)}</div>` : ''}
        </div>
      `;
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#4f46e5',
        fillOpacity: 0.95
      }).bindTooltip(`📷 ${escapeHtml(p.filename)}`, { direction: 'top' })
        .bindPopup(popupHtml)
        .addTo(layerGroup);
    });
    if (target === 'gis' && geoPhotos.length > 0 && fieldsData.length === 0) {
      map.setView([geoPhotos[0].lat, geoPhotos[0].lng], 16);
    }
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
    const gpsIds = fieldsData.filter(f => f.group === 'gps').map(f => f.id);
    selectedFieldIds = gpsIds.length > 0 ? gpsIds : fieldsData.slice(0, 3).map(f => f.id);
  } else if (groupType === 'yama') {
    const yamaIds = fieldsData.filter(f => f.group === 'yama').map(f => f.id);
    selectedFieldIds = yamaIds.length > 0 ? yamaIds : fieldsData.map(f => f.id);
  } else {
    selectedFieldIds = fieldsData.map(f => f.id);
  }
  renderInputFieldGrid();
  recalculatePreview();
}

// プリセット適用（実際の直近作業履歴を参照し、存在しない場合は登録済マスタへフォールバック）

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

