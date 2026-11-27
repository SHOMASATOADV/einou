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
  if ((target === 'gis' || target === 'input') && Array.isArray(UiState.uploadedGeoPhotos) && UiState.uploadedGeoPhotos.length > 0) {
    const geoPhotos = UiState.uploadedGeoPhotos.filter(p => p.hasGps && p.lat !== null && p.lng !== null);
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

