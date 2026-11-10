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
  renderGisHeatmap();
  inspectField(currentInspectedFieldId);
  renderResourcesTab();
  renderReportsTab();
  updateSyncBadge();
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
    const distBadge = f._distM !== undefined ? `<span class="text-xs text-sky-600 font-semibold ml-1">(${f._distM}m)</span>` : '';
    return `
      <button onclick="toggleFieldSelection('${escapeHtml(f.id)}')" class="p-2.5 rounded-xl text-left transition ${activeCls}">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-[var(--foreground)] truncate">${checkIcon} ${escapeHtml(f.name)}</span>
          <span class="text-xs font-bold text-emerald-600 shrink-0">${escapeHtml(f.area)}a</span>
        </div>
        <div class="text-xs text-[var(--muted-foreground)] mt-0.5 truncate">${escapeHtml(f.lot)} ${distBadge}</div>
      </button>
    `;
  }).join('');
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
  document.getElementById('previewDiarySummary').textContent =
    `作業者: ${workerName} / 分類: ${currentWorkCat} / 合計: ${currentDuration.toFixed(1)}h (${selectedFields.length}筆へ自動按分)`;

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

  let newLog = {
    id: 'WL-' + Date.now(),
    date: formattedDate,
    cat: currentWorkCat,
    worker: workerName,
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
  saveStateToStorage();
  refreshAllViews();

  showToast(
    isEditing
      ? `✏️ 作業履歴を修正しました（${selectedFields.length} 筆）`
      : `🎉 1アクションで ${selectedFields.length} 筆のカルテ＆作業日報を端末保存しました！`,
    `対象: ${selectedFields.map(f => f.name).join('・')} (計${totalArea}a) ／ 画面をリロードしてもデータは保持されます。`
  );
}

// =========================================================================
// TAB 2: GISヒートマップ（新規追加圃場・GeoJSONポリゴン動的描画対応） ＆ 圃場カルテ
// =========================================================================
function setHeatmapLayer(layer) {
  currentHeatmapLayer = layer;
  ['all', '耕起', '草刈り', '施肥', '防除'].forEach(l => {
    const btn = document.getElementById('heatBtn-' + l);
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

  if (currentHeatmapLayer === 'all') {
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
      return `<button onclick="inspectField('${escapeHtml(f.id)}')" class="px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
        isCur ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--border)]'
      }">${escapeHtml(f.name)} (${escapeHtml(f.area)}a)</button>`;
    }).join('');
  }
}

function inspectField(fieldId) {
  currentInspectedFieldId = fieldId;
  renderGisHeatmap();

  const f = fieldsData.find(item => item.id === fieldId) || fieldsData[0];
  document.getElementById('karteTitle').textContent = `${f.name} (${f.lot})`;
  document.getElementById('karteArea').textContent = `${f.area} a (${(f.area / 10).toFixed(1)} 反)`;
  document.getElementById('karteCrop').textContent = f.crop;
  document.getElementById('karteHarvest').textContent = f.harvest;

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
      return `
        <div class="p-3 rounded-xl bg-[var(--background)] border border-[var(--border)] text-xs">
          <div class="flex items-center justify-between font-bold text-[var(--foreground)]">
            <span>📅 ${escapeHtml(l.date)} — ${escapeHtml(l.cat)}${l.synced ? '' : ' <span class="text-amber-600 font-semibold">(未同期)</span>'}</span>
            <span class="text-emerald-600">按分時間: ${allocHr}h</span>
          </div>
          <div class="text-[var(--muted-foreground)] mt-1">${escapeHtml(l.materialSummary)}</div>
          <div class="text-[var(--muted-foreground)] mt-0.5">作業者: ${escapeHtml(l.worker)} ／ 機械: ${escapeHtml(l.machineName)}</div>
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
          <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(m.name)}</div>
          <div class="flex items-center gap-2">
            ${badge}
            <button onclick="completeMachineMaintenance('${escapeHtml(m.id)}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition">
              🔧 点検・オイル交換完了
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
          <span class="text-xs font-bold text-emerald-600">[肥料] N${f.n}-P${f.p}-K${f.k}</span>
          <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(f.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)]">${isLow ? '⚠️ 発注点割れ（要補充）' : '在庫十分'}</div>
        </div>
        <div class="flex items-center gap-2.5 shrink-0">
          <div class="text-right">
            <div class="text-base font-bold ${isLow ? 'text-amber-600' : 'text-[var(--foreground)]'}">残 ${f.stock} 袋</div>
          </div>
          <button onclick="restockMaterial('fert', '${escapeHtml(f.id)}', 10)" class="px-2.5 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋10袋入庫
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
          <div class="text-xs text-[var(--muted-foreground)]">収穫前 ${p.phiDays} 日まで</div>
        </div>
        <div class="flex items-center gap-2.5 shrink-0">
          <div class="text-right">
            <div class="text-base font-bold text-[var(--foreground)]">残 ${p.stock} 本</div>
          </div>
          <button onclick="restockMaterial('pest', '${escapeHtml(p.id)}', 5)" class="px-2.5 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋5本入庫
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
    return `
      <tr>
        <td class="border border-slate-400 p-2">${escapeHtml(l.date)}</td>
        <td class="border border-slate-400 p-2 font-bold">${escapeHtml(l.cat)}</td>
        <td class="border border-slate-400 p-2">${escapeHtml(l.worker)}</td>
        <td class="border border-slate-400 p-2">${fNames}</td>
        <td class="border border-slate-400 p-2 text-right">${escapeHtml(l.totalArea)} a</td>
        <td class="border border-slate-400 p-2 text-right font-bold">${(Number(l.duration) || 0).toFixed(1)} h</td>
        <td class="border border-slate-400 p-2">${escapeHtml(l.machineName)}</td>
        <td class="border border-slate-400 p-2">${escapeHtml(l.materialSummary)}</td>
        <td class="no-print border border-slate-400 p-1 text-center whitespace-nowrap">
          <button onclick="editWorkLog('${escapeHtml(l.id)}')" class="px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100" title="修正">✏️</button>
          <button onclick="deleteWorkLog('${escapeHtml(l.id)}')" class="px-1.5 py-0.5 rounded border border-red-300 bg-red-50 hover:bg-red-100" title="取消">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  const yieldBody = document.getElementById('yieldReportBody');
  if (yieldBody) {
    yieldBody.innerHTML = fieldsData.map(f => {
      const fLogs = workLogs.filter(l => l.fieldIds.includes(f.id));
      const cumHr = fLogs.reduce((acc, l) => acc + (l.duration * (f.area / (l.totalArea || f.area))), 0);
      const defaultYieldTawara = f.yieldTawara10a || (f.nPer10a > 0 ? 9.0 : 0);
      const defaultHarvKg = f.harvestKg || Math.round(defaultYieldTawara * 60 * (f.area / 10));
      const gradeStr = f.grade || (defaultHarvKg > 0 ? '1等(見込)' : '収穫前');
      return `
        <tr>
          <td class="border border-slate-400 p-2 font-bold">${escapeHtml(f.name)} <span class="font-normal text-slate-600">(${escapeHtml(f.lot)})</span></td>
          <td class="border border-slate-400 p-2">${escapeHtml(f.crop)}</td>
          <td class="border border-slate-400 p-2 text-right">${escapeHtml(f.area)} a</td>
          <td class="border border-slate-400 p-2 text-right font-semibold">${cumHr.toFixed(2)} h</td>
          <td class="border border-slate-400 p-2 text-right font-bold text-emerald-700">${f.nPer10a.toFixed(2)} kg</td>
          <td class="border border-slate-400 p-2 text-right text-sky-700">${f.pPer10a.toFixed(2)} kg</td>
          <td class="border border-slate-400 p-2 text-right text-amber-700">${f.kPer10a.toFixed(2)} kg</td>
          <td class="border border-slate-400 p-2 text-right font-bold">${defaultHarvKg > 0 ? defaultHarvKg.toLocaleString() + ' kg' : '-'}</td>
          <td class="border border-slate-400 p-2 text-right font-bold text-amber-700">${defaultYieldTawara > 0 ? defaultYieldTawara.toFixed(1) + ' 俵' : '-'}</td>
          <td class="border border-slate-400 p-2 text-center font-semibold">${escapeHtml(gradeStr)}</td>
        </tr>
      `;
    }).join('');
  }
}

function exportCsvData() {
  const header = ['作業日', '作業分類', '作業者', '対象圃場', '合計面積(a)', '作業時間(h)', '使用機械', '使用資材摘要'];
  const rows = workLogs.map(l => {
    const fNames = (l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join('・');
    return [l.date, l.cat, l.worker, fNames, l.totalArea, l.duration, l.machineName, l.materialSummary].map(toCsvCell).join(',');
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
// TAB 5: マスタ追加 ＆ Googleスプレッドシート（GAS）同期・バックアップ
// =========================================================================
function addNewFieldMaster() {
  const name = document.getElementById('newFieldName').value.trim();
  const lot = document.getElementById('newFieldLot').value.trim() || '地番未設定';
  const area = Number(document.getElementById('newFieldArea').value || 20);
  const crop = document.getElementById('newFieldCrop').value.trim() || 'コシヒカリ (BL)';

  if (!name) {
    showToast('⚠️ 入力確認', '圃場名（通称）を入力してください。');
    return;
  }

  const newId = generateNextId('F', fieldsData.map(f => f.id));
  fieldsData.push({
    id: newId,
    name: name,
    lot: lot,
    group: 'yama',
    area: area,
    crop: crop,
    harvest: '2026/09/25',
    stage: '未着手',
    lat: 37.9212,
    lng: 139.0482,
    doneCats: [],
    nPer10a: 0,
    pPer10a: 0,
    kPer10a: 0,
    pestCount: {},
    baseline: makeEmptyBaseline()
  });

  document.getElementById('newFieldName').value = '';
  document.getElementById('newFieldLot').value = '';
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規圃場「${name} (${area}a)」を追加しました`, '現場一括入力およびGISマップ・カルテに即時反映されました。');
}

function addNewFertilizerMaster() {
  const name = document.getElementById('newFertName').value.trim();
  const n = Number(document.getElementById('newFertN').value || 0);
  const p = Number(document.getElementById('newFertP').value || 0);
  const k = Number(document.getElementById('newFertK').value || 0);
  const stock = Number(document.getElementById('newFertStock').value || 20);

  if (!name) {
    showToast('⚠️ 入力確認', '肥料名称を入力してください。');
    return;
  }

  const newId = generateNextId('F', Object.keys(fertilizers));
  fertilizers[newId] = { id: newId, name, unitKg: 20, n, p, k, stock, minStock: 10 };
  document.getElementById('newFertName').value = '';
  saveStateToStorage();
  renderSelectOptions();
  renderResourcesTab();
  showToast(`✅ 新規肥料「${name} (N${n}-P${p}-K${k})」を追加しました`, '施肥入力時の自動NPK計算リストに追加されました。');
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
  const blob = new Blob([JSON.stringify({ fieldsData, fertilizers, pesticides, machines, workLogs }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rakuraku_einou_backup.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('💾 全データのJSONバックアップを保存しました', '機種変更やPC移行時もデータを完全保護できます。');
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
