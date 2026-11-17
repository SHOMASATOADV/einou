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
      : '☁️ 圃場マスタを同期確認しました（未送信の作業日誌は0件です）',
    `新規 ${Number(resJson.syncedCount) || 0} 件 ／ 登録済みのため重複スキップ ${Number(resJson.skippedCount) || 0} 件。自動面積按分・JA帳票更新が実行されました。`
  );
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
      const unmatchedFieldNames = [];
      rawFieldNames.forEach(fn => {
        const trimmed = fn.trim();
        if (!trimmed) return;
        const found = fieldsData.find(f => f.name.includes(trimmed) || trimmed.includes(f.name) || f.id === trimmed);
        if (found) {
          if (!matchedIds.includes(found.id)) matchedIds.push(found.id);
        } else {
          unmatchedFieldNames.push(trimmed);
        }
      });

      return {
        id: `IMP-WL-${Date.now()}-${rowIdx + 1}-${Math.random().toString(36).slice(2, 5)}`,
        date: dateKey_(cols[dateIdx] || ''),
        cat: cat,
        worker: workerIdx !== -1 && cols[workerIdx] ? cols[workerIdx] : '佐藤 健一',
        fieldIds: matchedIds,
        unmatchedFieldNames: unmatchedFieldNames,
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

    tHead.innerHTML = `<tr><th class="p-2">作業日</th><th class="p-2">分類</th><th class="p-2">対象圃場（マッチング結果）</th><th class="p-2">換算面積</th><th class="p-2">時間</th><th class="p-2">資材・NPK自動計算</th></tr>`;
    tBody.innerHTML = pendingMigrationItems.map(item => {
      const unmatchedBadge = (item.unmatchedFieldNames && item.unmatchedFieldNames.length > 0)
        ? `<span class="ml-1 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">🆕 未登録圃場「${escapeHtml(item.unmatchedFieldNames.join('・'))}」を自動追加して紐付け</span>`
        : `<span class="ml-1 inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">✓ 既存圃場(${escapeHtml(item.fieldIds.join(','))})に一致</span>`;
      return `
      <tr>
        <td class="p-2">${escapeHtml(item.date)}</td>
        <td class="p-2 font-bold text-emerald-600">${escapeHtml(item.cat)}</td>
        <td class="p-2">${escapeHtml(item.fieldNamesLabel)} ${unmatchedBadge}</td>
        <td class="p-2 font-bold">${escapeHtml(item.totalArea)} a</td>
        <td class="p-2">${escapeHtml(item.duration)} h</td>
        <td class="p-2">${escapeHtml(item.materialSummary)}</td>
      </tr>
    `;
    }).join('');
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
        harvest: harvIdx !== -1 && cols[harvIdx] ? dateKey_(cols[harvIdx]) : '2026/09/22',
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
    let autoCreatedFields = 0;
    pendingMigrationItems.forEach(logItem => {
      const finalFieldIds = [...(logItem.fieldIds || [])];
      const unmatched = logItem.unmatchedFieldNames || [];
      if (unmatched.length > 0) {
        const perFieldArea = Math.max(5, Math.round((Number(logItem.totalArea) || 20) / Math.max(1, finalFieldIds.length + unmatched.length)));
        unmatched.forEach(rawName => {
          let existing = fieldsData.find(f => f.name === rawName || f.name.includes(rawName) || rawName.includes(f.name));
          if (!existing) {
            const newId = generateNextId('F', fieldsData.map(f => f.id));
            existing = {
              id: newId,
              name: rawName,
              lot: '作業履歴CSVから自動登録',
              group: 'yama',
              area: perFieldArea,
              crop: 'コシヒカリ (BL)',
              headingDate: '2026/08/08',
              targetTempC: 1000,
              dailyMeanTempC: 24.0,
              harvest: '2026/09/22',
              stage: '未着手',
              lat: 37.9165 + (fieldsData.length * 0.0004),
              lng: 139.0370 + (fieldsData.length * 0.0004),
              doneCats: [],
              nPer10a: 0,
              pPer10a: 0,
              kPer10a: 0,
              pestCount: {},
              alerts: [],
              baseline: makeEmptyBaseline()
            };
            fieldsData.push(existing);
            autoCreatedFields++;
          }
          if (!finalFieldIds.includes(existing.id)) finalFieldIds.push(existing.id);
        });
      }
      if (finalFieldIds.length === 0 && fieldsData[0]) {
        finalFieldIds.push(fieldsData[0].id);
      }
      const cleanLog = { ...logItem, fieldIds: finalFieldIds };
      delete cleanLog.unmatchedFieldNames;
      workLogs.unshift(cleanLog);
    });
    recalculateFieldStats();
    saveStateToStorage();
    refreshAllViews();
    showToast(
      `🎉 他社アプリから ${pendingMigrationItems.length} 件の作業・施肥履歴を一括インポートしました！`,
      autoCreatedFields > 0
        ? `未登録だった圃場 ${autoCreatedFields} 筆も自動追加して紐付けました（F01への誤混入を防止）。`
        : '各圃場の進捗・累計NPKおよびJA提出用A4帳票へ即時反映されました（取消・修正も可能）。'
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

function resetToDefaultData() {
  localStorage.removeItem(STORAGE_KEY);
  initApp();
  showToast('🔄 初期サンプルデータにリセットしました', 'すべてのマスタ・履歴が初期状態に戻りました。');
}
