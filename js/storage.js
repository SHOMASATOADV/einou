// Single State Store (AppState / UiState) & LocalStorage Persistence (js/storage.js)
const AppState = {
  fieldsData: [],
  fertilizers: {},
  pesticides: {},
  machines: {},
  costSettings: { hourlyWageYen: 1500, ricePricePerTawaraYen: 18500, wasteRicePricePerKgYen: 50 },
  workLogs: [],
  gasWebhookUrl: '',
  gasSyncToken: ''
};

const UiState = {
  selectedFieldIds: [],
  currentWorkCat: '\u65bd\u80a5',
  currentDuration: 2.0,
  currentBags: 10,
  currentHarvestBags: 180,
  isOfflineMode: false,
  currentHeatmapLayer: 'all',
  currentInspectedFieldId: '',
  editingLogId: null,
  pendingMigrationItems: [],
  pendingMigrationMode: 'fields'
};

Object.keys(AppState).forEach((k) => {
  Object.defineProperty(window, k, {
    configurable: true,
    enumerable: true,
    get: () => AppState[k],
    set: (v) => { AppState[k] = v; }
  });
});
Object.keys(UiState).forEach((k) => {
  Object.defineProperty(window, k, {
    configurable: true,
    enumerable: true,
    get: () => UiState[k],
    set: (v) => { UiState[k] = v; }
  });
});

// =========================================================================
// LocalStorage 永続化エンジン
// =========================================================================
function applyParsedState_(parsed) {
  const def = JSON.parse(JSON.stringify(DEFAULT_STATE));
  fieldsData = Array.isArray(parsed.fieldsData) ? parsed.fieldsData : def.fieldsData;
  // 既存データに headingDate / alerts 等がない場合はデフォルト値から補完
  fieldsData.forEach(f => {
    const defField = def.fieldsData.find(df => df.id === f.id);
    if (!f.headingDate) f.headingDate = defField?.headingDate || (f.group === 'yama' ? '2026/08/14' : '2026/08/08');
    if (!f.targetTempC) f.targetTempC = defField?.targetTempC || (String(f.crop || '').includes('つきあかり') ? 950 : 1000);
    if (!f.dailyMeanTempC) f.dailyMeanTempC = defField?.dailyMeanTempC || (f.group === 'yama' ? 23.2 : 25.5);
    if (!Array.isArray(f.alerts)) f.alerts = defField?.alerts ? JSON.parse(JSON.stringify(defField.alerts)) : [];
  });

  fertilizers = (parsed.fertilizers && Object.keys(parsed.fertilizers).length > 0)
    ? parsed.fertilizers
    : def.fertilizers;
  Object.keys(fertilizers).forEach(fid => {
    if (!fertilizers[fid].priceYen) fertilizers[fid].priceYen = def.fertilizers[fid]?.priceYen || 2500;
    if (!fertilizers[fid].unitKg) fertilizers[fid].unitKg = def.fertilizers[fid]?.unitKg || 20;
  });

  pesticides = (parsed.pesticides && Object.keys(parsed.pesticides).length > 0)
    ? parsed.pesticides
    : def.pesticides;
  // P04が未追加の旧キャッシュにはP04を補完
  if (!pesticides.P04 && def.pesticides.P04 && !parsed._p04Removed) {
    pesticides.P04 = def.pesticides.P04;
  }
  Object.keys(pesticides).forEach(pid => {
    if (!pesticides[pid].activeIngredient && def.pesticides[pid]) {
      pesticides[pid].activeIngredient = def.pesticides[pid].activeIngredient;
    }
    if (!pesticides[pid].priceYen) pesticides[pid].priceYen = def.pesticides[pid]?.priceYen || 3000;
    ensurePesticideInventoryFields_(pesticides[pid]);
  });

  machines = (parsed.machines && Object.keys(parsed.machines).length > 0)
    ? parsed.machines
    : def.machines;
  Object.keys(machines).forEach(mid => {
    if (!machines[mid].hourlyCostYen) machines[mid].hourlyCostYen = def.machines[mid]?.hourlyCostYen || 2500;
  });

  costSettings = { ...def.costSettings, ...(parsed.costSettings || {}) };
  workLogs = Array.isArray(parsed.workLogs) ? parsed.workLogs : def.workLogs;
  workLogs.forEach(l => {
    const defLog = def.workLogs.find(dl => dl.id === l.id);
    if (!l.weather) l.weather = defLog?.weather || '☀️ 晴れ';
    if (l.tempC === undefined) l.tempC = defLog?.tempC ?? 24;
    if (l.memo === undefined) l.memo = defLog?.memo || '';
  });
  gasWebhookUrl = parsed.gasWebhookUrl || '';
  // トークンは localStorage からの読込時のみ復元（JSONバックアップには含まれないため既存値を維持）
  if (typeof parsed.gasSyncToken === 'string') gasSyncToken = parsed.gasSyncToken;
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      applyParsedState_(JSON.parse(raw));
      return;
    }
  } catch (e) {}
  applyParsedState_(JSON.parse(JSON.stringify(DEFAULT_STATE)));
}

function saveStateToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fieldsData,
      fertilizers,
      pesticides,
      machines,
      costSettings,
      workLogs,
      gasWebhookUrl,
      gasSyncToken
    }));
  } catch (e) {
    if (typeof showToast === 'function') {
      showToast(
        '⚠️ 端末内ストレージ（localStorage）の保存上限に達しました',
        'データが失われないよう、タブ5「他社データ移行・設定」から「JSONバックアップを保存」してください。'
      );
    }
  }
  if (typeof updateSyncBadge === 'function') updateSyncBadge();
}

