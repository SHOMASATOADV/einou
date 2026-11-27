// Feature: External App Migration, GAS Sync & JSON Backup/Restore
function saveGasUrl() {
  gasWebhookUrl = document.getElementById('gasWebhookUrl').value.trim();
  const tokenEl = document.getElementById('gasSyncToken');
  if (tokenEl) gasSyncToken = tokenEl.value.trim();
  saveStateToStorage();
}

async function syncWithGasBackend() {
  if (isOfflineMode) {
    showToast('📡 現在オフラインモード中です', 'オンラインに復帰してからスプレッドシート同期を実行してください。');
    return;
  }

  saveGasUrl();
  const unsynced = workLogs.filter(l => !l.synced);
  const url = gasWebhookUrl;

  // URL未設定時は送信したことにしない（以前は全件を同期済にしていたため、後から送信されなくなっていた）
  if (!url) {
    showToast(
      '⚙️ GASウェブアプリURLが未設定です',
      `未送信の作業日誌 ${unsynced.length} 件は端末内に保存されたままです。タブ5「他社データ移行・設定」でURLとトークンを設定してから同期してください。`
    );
    return;
  }

  // TSK-019: 未同期0件かつ新規圃場変更なしの時は重複POST送信をスキップ
  const currentFieldSig = fieldsData.map(f => f.id).sort().join(',');
  if (unsynced.length === 0 && UiState.lastSyncedFieldSig === currentFieldSig) {
    showToast(
      '✅ 未送信の作業日誌は0件です（重複送信をスキップしました）',
      'クラウド側の最新マスタを取り込む場合は、設定タブの「☁️ スプレッドシートから最新マスタを取得」をご利用ください。'
    );
    return;
  }

  let resJson = null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: gasSyncToken, fields: fieldsData, logs: unsynced })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    try {
      resJson = await response.json();
    } catch (parseErr) {
      // GASのログイン画面HTMLなどが返った場合（デプロイ設定ミス）
      throw new Error('GASからの応答がJSONではありません（デプロイのアクセス権限設定を確認してください）');
    }
  } catch (err) {
    showToast(
      '⚠️ 同期できませんでした（データは端末内に安全に保存されています）',
      `${err.message || err} ／ 電波状況・GAS URLを確認後、再度同期ボタンを押してください。`
    );
    return;
  }

  if (!resJson || resJson.status !== 'ok') {
    showToast(
      '⚠️ スプレッドシート側でエラーが発生しました（未送信のまま保持しています）',
      (resJson && resJson.message) ? String(resJson.message) : '不明なエラー応答です。'
    );
    return;
  }

  UiState.lastSyncedFieldSig = currentFieldSig;

  // GASが受理を明示したIDだけを同期済にする（acceptedIds が無い応答では何も同期済にしない）
  const acceptedSet = new Set(Array.isArray(resJson.acceptedIds) ? resJson.acceptedIds : []);
  let markedCount = 0;
  workLogs.forEach(l => {
    if (!l.synced && acceptedSet.has(l.id)) {
      l.synced = true;
      markedCount++;
    }
  });
  saveStateToStorage();
  refreshAllViews();

  const remain = unsynced.length - markedCount;
  showToast(
    unsynced.length > 0
      ? `☁️ Googleスプレッドシートへ ${markedCount} 件を同期しました${remain > 0 ? `（未受理 ${remain} 件は端末に保持）` : ''}`
      : `☁️ 圃場マスタを同期確認しました（新規圃場 ${Number(resJson.insertedFieldsCount) || 0} 筆）`,
    `新規 ${Number(resJson.syncedCount) || 0} 件 ／ 登録済みのため重複スキップ ${Number(resJson.skippedCount) || 0} 件。自動面積按分・JA帳票更新が実行されました。`
  );
}

/**
 * TSK-019: GAS doGet エンドポイントから最新マスタ（圃場・肥料・農薬・機械）を取得・統合
 */
async function syncFromGasBackend() {
  if (isOfflineMode) {
    showToast('📡 現在オフラインモード中です', 'オンラインに復帰してからマスタ取得を実行してください。');
    return;
  }

  saveGasUrl();
  const url = gasWebhookUrl;
  if (!url) {
    showToast(
      '⚙️ GASウェブアプリURLが未設定です',
      'タブ5「他社データ移行・設定」でGASウェブアプリURLと同期用トークンを入力してください。'
    );
    return;
  }

  const sep = url.includes('?') ? '&' : '?';
  const reqUrl = `${url}${sep}action=masters&token=${encodeURIComponent(gasSyncToken || '')}`;

  let resJson = null;
  try {
    const response = await fetch(reqUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      resJson = await response.json();
    } catch (parseErr) {
      throw new Error('GASからの応答がJSONではありません（doGet デプロイ設定・アクセス権限を確認してください）');
    }
  } catch (err) {
    showToast(
      '⚠️ クラウドからマスタを取得できませんでした',
      `${err.message || err} ／ 電波状況・GAS URLを確認してください。`
    );
    return;
  }

  if (!resJson || resJson.status !== 'ok') {
    showToast(
      '⚠️ スプレッドシート側で取得エラーが発生しました',
      (resJson && resJson.message) ? String(resJson.message) : '不明なエラー応答です。'
    );
    return;
  }

  // 1. 圃場マスタのマージ（既存の polygonCoords や alerts 等は保持）
  let fieldAdded = 0, fieldUpdated = 0;
  if (Array.isArray(resJson.fields)) {
    resJson.fields.forEach(rf => {
      if (!rf || !rf.id) return;
      const existing = fieldsData.find(f => f.id === rf.id);
      if (existing) {
        existing.name = rf.name || existing.name;
        existing.lot = rf.lot || existing.lot;
        existing.area = Number(rf.area) || existing.area;
        existing.crop = rf.crop || existing.crop;
        existing.harvest = rf.harvest || existing.harvest;
        if (rf.lat) existing.lat = Number(rf.lat);
        if (rf.lng) existing.lng = Number(rf.lng);
        fieldUpdated++;
      } else {
        fieldsData.push({
          id: rf.id,
          name: rf.name || rf.id,
          lot: rf.lot || '-',
          group: rf.group || 'honba',
          area: Number(rf.area) || 20,
          crop: rf.crop || 'コシヒカリ (BL)',
          headingDate: '2026/08/08',
          targetTempC: String(rf.crop || '').includes('つきあかり') ? 950 : 1000,
          dailyMeanTempC: rf.group === 'yama' ? 23.2 : 25.5,
          harvest: rf.harvest || '2026/09/20',
          stage: rf.stage || '未着手',
          lat: Number(rf.lat) || 37.9165,
          lng: Number(rf.lng) || 139.0370,
          doneCats: [],
          nPer10a: Number(rf.nPer10a) || 0,
          pPer10a: Number(rf.pPer10a) || 0,
          kPer10a: Number(rf.kPer10a) || 0,
          pestCount: {},
          alerts: [],
          baseline: makeEmptyBaseline()
        });
        fieldAdded++;
      }
    });
  }

  // 2. 肥料・農薬・機械マスタのマージ
  if (resJson.fertilizers && typeof resJson.fertilizers === 'object') {
    Object.keys(resJson.fertilizers).forEach(fid => {
      const rf = resJson.fertilizers[fid];
      const existing = fertilizers[fid] || {};
      fertilizers[fid] = {
        priceYen: existing.priceYen || 2500,
        ...existing,
        ...rf
      };
    });
  }
  if (resJson.pesticides && typeof resJson.pesticides === 'object') {
    Object.keys(resJson.pesticides).forEach(pid => {
      const rp = resJson.pesticides[pid];
      const existing = pesticides[pid] || {};
      pesticides[pid] = {
        priceYen: existing.priceYen || 3000,
        ...existing,
        ...rp
      };
      ensurePesticideInventoryFields_(pesticides[pid]);
    });
  }
  if (resJson.machines && typeof resJson.machines === 'object') {
    Object.keys(resJson.machines).forEach(mid => {
      const rm = resJson.machines[mid];
      const existing = machines[mid] || {};
      machines[mid] = {
        hourlyCostYen: existing.hourlyCostYen || 2500,
        ...existing,
        ...rm
      };
    });
  }

  // 3. チーム作業指示（TSK-031）のマージ
  if (Array.isArray(resJson.workOrders) && typeof mergeWorkOrders_ === 'function') {
    workOrders = mergeWorkOrders_(workOrders || [], resJson.workOrders);
  }

  ensureFieldBaselines();
  recalculateFieldStats();
  saveStateToStorage();
  refreshAllViews();

  const fCnt = (resJson.fields || []).length;
  showToast(
    `☁️ スプレッドシートから最新マスタを取得しました`,
    `圃場 ${fCnt}筆（新規+${fieldAdded} / 更新${fieldUpdated}）・肥料/農薬/機械マスタを最新化しました。`
  );
}


function exportFullBackupJson() {
  const blob = new Blob([JSON.stringify({ fieldsData, fertilizers, pesticides, machines, workLogs, workOrders, costSettings, gasWebhookUrl }, null, 2)], { type: 'application/json' });
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
      if (document.getElementById('simWastePriceInput') && costSettings) {
        document.getElementById('simWastePriceInput').value = costSettings.wasteRicePricePerKgYen ?? 50;
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

async function resetToDefaultData() {
  if (typeof clearStorageAsync === 'function') {
    await clearStorageAsync();
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  UiState.lastSyncedFieldSig = null;
  initApp();
  showToast('🔄 初期サンプルデータにリセットしました', 'すべてのマスタ・履歴が初期状態に戻りました（IndexedDBも初期化済）。');
}
