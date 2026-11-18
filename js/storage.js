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
// IndexedDB + LocalStorage ハイブリッド永続化エンジン (TSK-020)
// =========================================================================
const IDB_NAME = 'rakuraku_einou_db';
const IDB_VERSION = 1;
const IDB_STORE_NAME = 'app_state';
const IDB_STATE_KEY = 'main_state';

let _idbAvailable = null;
let _idbWriteQueue = Promise.resolve();
let _lastStorageBackend = 'localStorage';

function openEinouDb_() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      _idbAvailable = false;
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = (ev) => {
        _idbAvailable = true;
        resolve(ev.target.result);
      };
      req.onerror = () => {
        _idbAvailable = false;
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch (e) {
      _idbAvailable = false;
      resolve(null);
    }
  });
}

async function idbGetState_(key = IDB_STATE_KEY) {
  const db = await openEinouDb_();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch (e) {
      try { db.close(); } catch (_) {}
      resolve(null);
    }
  });
}

async function idbSetState_(val, key = IDB_STATE_KEY) {
  const db = await openEinouDb_();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(val, key);
      tx.oncomplete = () => {
        db.close();
        _lastStorageBackend = 'IndexedDB';
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch (e) {
      try { db.close(); } catch (_) {}
      resolve(false);
    }
  });
}

async function idbDeleteState_(key = IDB_STATE_KEY) {
  const db = await openEinouDb_();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch (e) {
      try { db.close(); } catch (_) {}
      resolve(false);
    }
  });
}

function getPersistPayload_() {
  return {
    fieldsData,
    fertilizers,
    pesticides,
    machines,
    costSettings,
    workLogs,
    gasWebhookUrl,
    gasSyncToken,
    _savedAt: new Date().toISOString()
  };
}

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
      _lastStorageBackend = 'localStorage';
      return;
    }
  } catch (e) {}
  applyParsedState_(JSON.parse(JSON.stringify(DEFAULT_STATE)));
}

/**
 * IndexedDB から大容量データを非同期ロード（未移行時は localStorage から自動マイグレーション）
 * @return {Promise<boolean>} IndexedDB からの復元が行われた場合 true
 */
async function loadStateFromStorageAsync() {
  const idbData = await idbGetState_(IDB_STATE_KEY);
  if (idbData && (Array.isArray(idbData.fieldsData) || Array.isArray(idbData.workLogs))) {
    applyParsedState_(idbData);
    _lastStorageBackend = 'IndexedDB';
    return true;
  }

  // IndexedDB が空の場合、既存の localStorage データを IndexedDB へ自動移行
  let migratedSource = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) migratedSource = JSON.parse(raw);
  } catch (e) {}

  if (migratedSource) {
    applyParsedState_(migratedSource);
    await idbSetState_(getPersistPayload_(), IDB_STATE_KEY);
    return true;
  }

  // 新規状態も IndexedDB に保存しておく
  if (_idbAvailable !== false) {
    await idbSetState_(getPersistPayload_(), IDB_STATE_KEY);
  }
  return false;
}

function enqueueIdbSave_(payload) {
  _idbWriteQueue = _idbWriteQueue
    .then(() => idbSetState_(payload, IDB_STATE_KEY))
    .then((ok) => {
      if (ok && typeof updateStorageInfoBadge === 'function') {
        updateStorageInfoBadge();
      }
      return ok;
    })
    .catch(() => false);
  return _idbWriteQueue;
}

function saveStateToStorage() {
  const payload = getPersistPayload_();
  let lsSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    lsSaved = true;
  } catch (e) {
    lsSaved = false;
  }

  // IndexedDB へ非同期永続化（5MB上限を超える大容量データでも確実に保持）
  enqueueIdbSave_(payload).then((idbOk) => {
    if (!lsSaved && !idbOk && typeof showToast === 'function') {
      showToast(
        '⚠️ 端末内ストレージの保存上限に達しました',
        'データが失われないよう、タブ5「他社データ移行・設定」から「JSONバックアップを保存」してください。'
      );
    }
  });

  if (typeof updateSyncBadge === 'function') updateSyncBadge();
  if (typeof updateStorageInfoBadge === 'function') updateStorageInfoBadge();
}

async function clearStorageAsync() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  await _idbWriteQueue.catch(() => {});
  await idbDeleteState_(IDB_STATE_KEY);
}

async function getStorageStatsAsync() {
  const payload = getPersistPayload_();
  const jsonStr = JSON.stringify(payload);
  const bytes = new Blob([jsonStr]).size;
  const polygonPts = (fieldsData || []).reduce((sum, f) => {
    return sum + (Array.isArray(f.polygonCoords) ? f.polygonCoords.length : 0);
  }, 0);
  if (_idbAvailable === null) {
    const db = await openEinouDb_();
    if (db) db.close();
  }
  return {
    backend: _idbAvailable ? 'IndexedDB + localStorage (自動切替対応)' : 'localStorage',
    idbEnabled: Boolean(_idbAvailable),
    bytes,
    kb: Math.round((bytes / 1024) * 10) / 10,
    fieldCount: (fieldsData || []).length,
    workLogCount: (workLogs || []).length,
    polygonPts
  };
}

