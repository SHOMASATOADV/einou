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

function initApp() {
  loadStateFromStorage();
  ensureFieldBaselines();
  recalculateFieldStats();
  document.getElementById('gasWebhookUrl').value = gasWebhookUrl;
  if (document.getElementById('gasSyncToken')) document.getElementById('gasSyncToken').value = gasSyncToken;
  if (typeof loadTasteOcrSettings === 'function') loadTasteOcrSettings();
  if (document.getElementById('simRicePriceInput') && typeof costSettings === 'object') {
    document.getElementById('simRicePriceInput').value = costSettings.ricePricePerTawaraYen || 18500;
  }
  if (document.getElementById('simWastePriceInput') && typeof costSettings === 'object') {
    document.getElementById('simWastePriceInput').value = costSettings.wasteRicePricePerKgYen ?? 50;
  }
  if (document.getElementById('simHourlyWageInput') && typeof costSettings === 'object') {
    document.getElementById('simHourlyWageInput').value = costSettings.hourlyWageYen || 1500;
  }

  // 帳票出力日および作業日入力欄を本日の日付で動的初期化
  const now = new Date();
  const dateLabel = document.getElementById('jaHeaderDateLabel');
  if (dateLabel) {
    dateLabel.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  }
  const todayIso = getTodayIsoDate();
  if (document.getElementById('workDateInput')) {
    document.getElementById('workDateInput').value = todayIso;
  }

  selectedFieldIds = fieldsData.length > 0 ? fieldsData.slice(0, 3).map(f => f.id) : [];
  renderSelectOptions();
  renderInputFieldGrid();
  selectWorkCat('施肥');
  recalculatePreview();
  renderDiaryTimeline();
  renderGisHeatmap();
  inspectField(fieldsData[0]?.id || '');
  renderResourcesTab();
  renderReportsTab();
  updateSyncBadge();
  setupDelegatedEvents_();
}

let _delegatedEventsBound = false;
function parseOptionalBool_(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

const ACTION_HANDLERS = {
  switchMainTab: (el) => switchMainTab(el.dataset.arg),
  switchMainTabAndPanel: (el) => { switchMainTab(el.dataset.arg); toggleQuickAddPanel(el.dataset.arg2, true); },
  toggleUserManualModal: (el) => toggleUserManualModal(parseOptionalBool_(el.dataset.arg)),
  toggleOfflineMode: () => toggleOfflineMode(),
  syncWithGasBackend: () => syncWithGasBackend(),
  setTodayWorkDate: () => setTodayWorkDate(),
  applyPreset: (el) => applyPreset(el.dataset.arg),
  selectFieldGroup: (el) => selectFieldGroup(el.dataset.arg),
  detectGpsNearestFields: () => detectGpsNearestFields(),
  toggleInputGoogleMap: () => toggleInputGoogleMap(),
  openSelectedFieldsInGoogleMaps: () => openSelectedFieldsInGoogleMaps(),
  openFieldInGoogleMaps: (el) => openFieldInGoogleMaps(el.dataset.arg === 'current' ? currentInspectedFieldId : el.dataset.arg),
  toggleFieldSelection: (el) => toggleFieldSelection(el.dataset.arg),
  panGoogleMapToGroup: (el) => panGoogleMapToGroup(el.dataset.arg, el.dataset.arg2),
  toggleMapDrawMode: (el) => toggleMapDrawMode(parseOptionalBool_(el.dataset.arg)),
  clearMapDrawVertices: () => clearMapDrawVertices(),
  finishMapDrawField: () => finishMapDrawField(),
  selectWorkCat: (el) => selectWorkCat(el.dataset.arg),
  toggleWeatherDetailPanel: () => toggleWeatherDetailPanel(),
  adjustDuration: (el) => adjustDuration(Number(el.dataset.arg)),
  adjustBags: (el) => adjustBags(Number(el.dataset.arg)),
  adjustHarvestBags: (el) => adjustHarvestBags(Number(el.dataset.arg)),
  adjustWasteRiceKg: (el) => adjustWasteRiceKg(Number(el.dataset.arg)),
  toggleQuickAddPanel: (el) => toggleQuickAddPanel(el.dataset.arg, parseOptionalBool_(el.dataset.arg2)),
  addNewFertilizerMaster: (el) => addNewFertilizerMaster(el.dataset.arg),
  addNewPesticideMaster: (el) => addNewPesticideMaster(el.dataset.arg),
  addNewMachineMaster: (el) => addNewMachineMaster(el.dataset.arg),
  addNewFieldMaster: () => addNewFieldMaster(),
  deleteFieldMaster: (el) => deleteFieldMaster(el.dataset.arg === 'current' ? currentInspectedFieldId : el.dataset.arg),
  deleteMachineMaster: (el) => deleteMachineMaster(el.dataset.arg),
  deleteMaterialMaster: (el) => deleteMaterialMaster(el.dataset.arg, el.dataset.arg2),
  completeMachineMaintenance: (el) => completeMachineMaintenance(el.dataset.arg),
  restockMaterial: (el) => restockMaterial(el.dataset.arg, el.dataset.arg2, Number(el.dataset.arg3)),
  appendDiaryQuickTag: (el) => appendDiaryQuickTag(el.dataset.arg),
  submitUnifiedWorkLog: () => submitUnifiedWorkLog(),
  cancelEditMode: () => cancelEditMode(),
  editWorkLog: (el) => editWorkLog(el.dataset.arg),
  deleteWorkLog: (el) => deleteWorkLog(el.dataset.arg),
  renderDiaryTimeline: () => renderDiaryTimeline(),
  recalculatePreview: () => recalculatePreview(),
  setHeatmapLayer: (el) => setHeatmapLayer(el.dataset.arg),
  switchGisMapMode: (el) => switchGisMapMode(el.dataset.arg),
  inspectField: (el) => inspectField(el.dataset.arg),
  jumpToInputWithField: () => jumpToInputWithField(),
  updateFieldHeadingDate: (el) => updateFieldHeadingDate(el.value),
  addFieldAlert: () => addFieldAlert(),
  resolveFieldAlert: (el) => resolveFieldAlert(el.dataset.arg, el.dataset.arg2),
  switchReportType: (el) => switchReportType(el.dataset.arg),
  renderReportsTab: () => renderReportsTab(),
  updateCostSettingsFromUi: () => updateCostSettingsFromUi(),
  exportCsvData: () => exportCsvData(),
  printPage: () => window.print(),
  loadMigrationSample: (el) => loadMigrationSample(el.dataset.arg),
  parseAndPreviewMigrationText: () => parseAndPreviewMigrationText(),
  executeMigrationImport: () => executeMigrationImport(),
  handleMigrationFileSelect: (el, ev) => handleMigrationFileSelect(ev),
  syncPestUnitPlaceholder: (el) => syncPestUnitPlaceholder(el.dataset.arg),
  toggleNewFieldMapPicker: (el) => toggleNewFieldMapPicker(parseOptionalBool_(el.dataset.arg)),
  clearPickerPolygonVertices: () => clearPickerPolygonVertices(),
  applyGoogleMapsUrlToFieldForm: (el) => applyGoogleMapsUrlToFieldForm(el.value),
  saveGasUrl: () => saveGasUrl(),
  saveTasteOcrSettings: () => saveTasteOcrSettings(),
  exportFullBackupJson: () => exportFullBackupJson(),
  importFullBackupJson: (el, ev) => importFullBackupJson(ev),
  resetToDefaultData: () => resetToDefaultData(),
  clickElement: (el) => document.getElementById(el.dataset.arg)?.click(),
  openTasteOcrModal: () => openTasteOcrModal(),
  closeTasteOcrModal: () => closeTasteOcrModal(),
  loadTasteOcrSample: (el) => loadTasteOcrSample(el.dataset.arg),
  runTasteOcrAnalysis: () => runTasteOcrAnalysis(),
  reparseTasteRawText: () => reparseTasteRawText(),
  applyTasteOcrToHarvestForm: () => applyTasteOcrToHarvestForm(),
  handleTasteImageSelect: (el, ev) => handleTasteImageSelect(ev),
  closeModalOnBackdrop: (el, ev) => {
    if (ev.target === el) ModalManager.close(el.id);
  }
};

function setupDelegatedEvents_() {
  if (_delegatedEventsBound) return;
  _delegatedEventsBound = true;

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.stop === 'true') ev.stopPropagation();
    const fn = ACTION_HANDLERS[el.dataset.action];
    if (fn) fn(el, ev);
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = ACTION_HANDLERS[el.dataset.change];
    if (fn) fn(el, ev);
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (!el) return;
    const fn = ACTION_HANDLERS[el.dataset.input];
    if (fn) fn(el, ev);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') ModalManager.closeAll();
  });
}

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


const MODAL_IDS = ['tasteOcrModal', 'userManualModal'];
const ModalManager = {
  open(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('hidden');
  },
  close(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('hidden');
  },
  toggle(id, forceOpen) {
    const modal = document.getElementById(id);
    if (!modal) return;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : modal.classList.contains('hidden');
    modal.classList.toggle('hidden', !shouldOpen);
  },
  closeAll() {
    MODAL_IDS.forEach(id => this.close(id));
  }
};

function toggleUserManualModal(forceOpen) {
  ModalManager.toggle('userManualModal', forceOpen);
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
