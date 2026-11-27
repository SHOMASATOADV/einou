// Feature: Work Log Submit, Resource Rollback, Edit & Diary Timeline (RF-21A)
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
      const pObj = pesticides[pid];
      if (!pObj) return;
      ensurePesticideInventoryFields_(pObj);
      const usedMlMap = log.usedMlByMap || {};
      const usedKgMap = log.usedKgByMap || {};
      const deductedMap = log.stockDeductedByMap || {};

      if (pObj.formulation === 'granule') {
        const usedKg = usedKgMap[pid] !== undefined
          ? Number(usedKgMap[pid])
          : ((deductedMap[pid] !== undefined ? Number(deductedMap[pid]) : (Number(log.stockDeducted ?? log.inputQty) || 0)) * pObj.unitSizeKg);
        pObj.stockKg = Math.max(0, Math.round((pObj.stockKg - sign * usedKg) * 10) / 10);
      } else {
        const usedMl = usedMlMap[pid] !== undefined
          ? Number(usedMlMap[pid])
          : ((deductedMap[pid] !== undefined ? Number(deductedMap[pid]) : (Number(log.stockDeducted ?? log.inputQty) || 0)) * pObj.unitSizeMl);
        pObj.stockMl = Math.max(0, Math.round(pObj.stockMl - sign * usedMl));
      }
      ensurePesticideInventoryFields_(pObj);
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
  if (document.getElementById('workRainfallInput')) {
    document.getElementById('workRainfallInput').value = log.rainfallMm !== undefined ? log.rainfallMm : 0;
  }
  if (document.getElementById('workWindDirSelect')) {
    document.getElementById('workWindDirSelect').value = log.windDir || '静穏';
  }
  if (document.getElementById('workWindSpeedInput')) {
    document.getElementById('workWindSpeedInput').value = log.windSpeedMs !== undefined ? log.windSpeedMs : 1.5;
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
    if (document.getElementById('harvestWasteKgInput')) {
      document.getElementById('harvestWasteKgInput').value = Number(log.wasteRiceKg) || 0;
    }
    if (log.grade) document.getElementById('harvestGradeSelect').value = log.grade;
    if (log.moisture) document.getElementById('harvestMoistureInput').value = log.moisture;
    const setOpt = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v !== undefined && v !== null) ? v : ''; };
    setOpt('harvestTasteScoreInput', log.tasteScore);
    setOpt('harvestProteinInput', log.protein);
    setOpt('harvestWholeGrainInput', log.wholeGrainRate);
    setOpt('harvestAmyloseInput', log.amylose);
    setOpt('harvestFattyAcidInput', log.fattyAcid);
    setOpt('harvestTasteLotNoInput', log.tasteLotNo);
    setOpt('harvestTasteOcrSourceInput', log.tasteOcrSource || 'manual');
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

// 一括登録実行 ＆ LocalStorage永続化（RF-11: 入力収集・分類別ペイロード生成・保存を分割）
function collectBaseWorkLog_(selectedFields, totalArea, editingBackup) {
  const machId = document.getElementById('machineSelect').value;
  const machineName = (machId !== 'NONE' && machines[machId]) ? machines[machId].name : 'なし（手作業）';
  const workDateRaw = document.getElementById('workDateInput').value || '2026-08-05';
  const workerName = document.getElementById('workerNameInput').value || '佐藤 健一';

  return {
    id: (editingBackup && editingBackup.log && editingBackup.log.id) ? editingBackup.log.id : ('WL-' + Date.now()),
    date: dateKey_(workDateRaw.replace(/-/g, '/')),
    cat: currentWorkCat,
    worker: workerName,
    weather: document.getElementById('workWeatherSelect')?.value || '☀️ 晴れ',
    tempC: Number(document.getElementById('workTempInput')?.value || 25),
    rainfallMm: Math.max(0, Number(document.getElementById('workRainfallInput')?.value) || 0),
    windDir: document.getElementById('workWindDirSelect')?.value || '静穏',
    windSpeedMs: Math.max(0, Number(document.getElementById('workWindSpeedInput')?.value) || 0),
    memo: (document.getElementById('workDiaryMemoInput')?.value || '').trim(),
    fieldIds: selectedFields.map(f => f.id),
    totalArea,
    duration: currentDuration,
    machineId: machId !== 'NONE' ? machId : '',
    machineName,
    machineHourlyCostYen: (machId !== 'NONE' && machines[machId]) ? (Number(machines[machId].hourlyCostYen) || 0) : 0,
    materialSummary: `${currentWorkCat}作業完了`,
    type: 'general',
    synced: false
  };
}

function applyFertilizerPayload_(newLog, totalArea) {
  const fertId = document.getElementById('fertilizerSelect').value;
  const fert = fertilizers[fertId] || Object.values(fertilizers)[0];
  if (!fert) throw new Error('有効な肥料マスタが選択されていません。');
  const totalKg = currentBags * fert.unitKg;
  const per10aKg = totalKg / (totalArea / 10);

  Object.assign(newLog, {
    type: 'fertilizer',
    materialId: fert.id || fertId,
    inputQty: currentBags,
    stockDeducted: Math.min(fert.stock, currentBags),
    unitPriceYen: Number(fert.priceYen) || 0,
    fertName: fert.name,
    npkLabel: `${fert.n}-${fert.p}-${fert.k}`,
    totalKg,
    per10aKg,
    n10a: per10aKg * (fert.n / 100),
    p10a: per10aKg * (fert.p / 100),
    k10a: per10aKg * (fert.k / 100),
    materialSummary: `${fert.name} (${currentBags}袋 / ${totalKg}kg)`
  });
}

function applyPesticidePayload_(newLog, totalArea) {
  const selectedPestIds = getSelectedPesticideIdsFromUi_();
  const selectedPests = selectedPestIds.map(id => pesticides[id]).filter(Boolean);
  if (selectedPests.length === 0) throw new Error('有効な農薬マスタが選択されていません。');

  const [dilRate, waterPer10a] = document.getElementById('dilutionSelect').value.split('_').map(Number);
  const totalWaterL = (totalArea / 10) * waterPer10a;
  const totalChemMl = (totalWaterL * 1000) / dilRate;
  const primaryUnitInfo = calcPesticideUnitQty(selectedPests[0], totalArea, totalChemMl);

  const stockDeductedByMap = {};
  const usedMlByMap = {};
  const usedKgByMap = {};
  const unitPriceByMap = {};
  const activeIngredientByMap = {};
  selectedPests.forEach(p => {
    const uInfo = calcPesticideUnitQty(p, totalArea, totalChemMl);
    if (uInfo.isLiquid) {
      const actualUsedMl = Math.min(Math.round(Number(p.stockMl) || 0), uInfo.neededMl);
      usedMlByMap[p.id] = actualUsedMl;
      stockDeductedByMap[p.id] = Math.round((actualUsedMl / (uInfo.unitSizeMl || 500)) * 100) / 100;
    } else {
      const actualUsedKg = Math.min(Math.round((Number(p.stockKg) || 0) * 10) / 10, uInfo.neededKg);
      usedKgByMap[p.id] = actualUsedKg;
      stockDeductedByMap[p.id] = Math.round((actualUsedKg / (uInfo.unitSizeKg || 3)) * 100) / 100;
    }
    unitPriceByMap[p.id] = Number(p.priceYen) || 0;
    activeIngredientByMap[p.id] = p.activeIngredient || p.name;
  });

  const summaryNames = selectedPests.map(p => p.name).join('＋');
  Object.assign(newLog, {
    type: 'pesticide',
    materialId: selectedPestIds.join(','),
    materialIds: selectedPestIds,
    inputQty: primaryUnitInfo.qty,
    stockDeducted: primaryUnitInfo.qty,
    stockDeductedByMap,
    usedMlByMap,
    usedKgByMap,
    unitPriceByMap,
    activeIngredientByMap,
    dilutionRate: dilRate,
    pestName: selectedPests.map(p => `${p.name} (${p.regNo})`).join(' ＋ '),
    dilution: `${dilRate}倍${selectedPests.length > 1 ? ' (混用)' : ''}`,
    waterL: totalWaterL,
    chemAmount: `${Math.round(totalChemMl).toLocaleString()} mL`,
    useCountLabel: selectedPests.map(p => `${p.activeIngredient || p.name}:上限${p.maxUse}回`).join(' / '),
    safetyOk: true,
    materialSummary: `${summaryNames} (${dilRate}倍${selectedPests.length > 1 ? `・${selectedPests.length}剤混用` : ''} / 液量${totalWaterL}L)`
  });
}

function applyHarvestPayload_(newLog, totalArea) {
  const harvTotalKg = currentHarvestBags * 30;
  const wasteKg = Math.max(0, Number(document.getElementById('harvestWasteKgInput')?.value) || 0);
  const wasteRatePct = (harvTotalKg + wasteKg) > 0 ? Math.round((wasteKg / (harvTotalKg + wasteKg)) * 1000) / 10 : 0;
  const yieldTawara10a = totalArea > 0 ? (harvTotalKg / (totalArea / 10)) / 60 : 0;
  const grade = document.getElementById('harvestGradeSelect')?.value || '1等';
  const moist = document.getElementById('harvestMoistureInput')?.value || '14.8';
  const readOptNum = (id) => {
    const v = document.getElementById(id)?.value;
    return (v !== undefined && v !== null && String(v).trim() !== '') ? Number(v) : null;
  };
  const tasteScore = readOptNum('harvestTasteScoreInput');
  const protein = readOptNum('harvestProteinInput');
  const wholeGrainRate = readOptNum('harvestWholeGrainInput');
  const amylose = readOptNum('harvestAmyloseInput');
  const fattyAcid = readOptNum('harvestFattyAcidInput');
  const tasteLotNo = (document.getElementById('harvestTasteLotNoInput')?.value || '').trim();
  const tasteOcrSource = document.getElementById('harvestTasteOcrSourceInput')?.value || 'manual';
  const wasteNote = wasteKg > 0 ? ` / 屑米 ${wasteKg}kg (${wasteRatePct.toFixed(1)}%)` : '';

  Object.assign(newLog, {
    type: 'harvest',
    totalKg: harvTotalKg,
    wasteRiceKg: wasteKg,
    wasteRatePct,
    harvestBags: currentHarvestBags,
    yieldTawara10a: Number(yieldTawara10a.toFixed(1)),
    grade,
    moisture: moist
  });
  if (tasteScore !== null) newLog.tasteScore = tasteScore;
  if (protein !== null) newLog.protein = protein;
  if (wholeGrainRate !== null) newLog.wholeGrainRate = wholeGrainRate;
  if (amylose !== null) newLog.amylose = amylose;
  if (fattyAcid !== null) newLog.fattyAcid = fattyAcid;
  if (tasteLotNo) newLog.tasteLotNo = tasteLotNo;
  if (tasteScore !== null || protein !== null || wholeGrainRate !== null || amylose !== null) {
    newLog.tasteOcrSource = tasteOcrSource;
  }
  const tasteStr = typeof formatTasteSummary_ === 'function' ? formatTasteSummary_(newLog) : '';
  newLog.materialSummary = `玄米 ${currentHarvestBags}袋 (${harvTotalKg}kg)${wasteNote} / 反収 ${yieldTawara10a.toFixed(1)}俵/10a / 水分${moist}% / ${grade}${tasteStr ? ` / ${tasteStr}` : ''}`;

  ['harvestTasteScoreInput', 'harvestProteinInput', 'harvestWholeGrainInput', 'harvestAmyloseInput', 'harvestFattyAcidInput', 'harvestTasteLotNoInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (document.getElementById('harvestTasteOcrSourceInput')) document.getElementById('harvestTasteOcrSourceInput').value = 'manual';
}

const SUBMIT_PAYLOAD_BUILDERS = {
  '施肥': applyFertilizerPayload_,
  '防除': applyPesticidePayload_,
  '収穫': applyHarvestPayload_
};

function submitUnifiedWorkLog() {
  const selectedFields = fieldsData.filter(f => selectedFieldIds.includes(f.id));
  const totalArea = selectedFields.reduce((sum, f) => sum + f.area, 0);
  const workDateRaw = document.getElementById('workDateInput').value || '2026-08-05';

  if (selectedFields.length === 0 || totalArea <= 0) {
    showToast('⚠️ 入力確認', '面積のある圃場を1筆以上選択してください。');
    return;
  }

  const isEditing = !!editingLogId;
  const editingBackup = isEditing ? removeWorkLog_(editingLogId) : null;
  const abort = () => { restoreWorkLog_(editingBackup); };

  try {
    if (currentWorkCat === '防除') {
      const safety = evaluatePesticideSafety_(selectedFields, getSelectedPesticideIdsFromUi_(), workDateRaw);
      if (!safety.ok) {
        abort();
        const plainMsg = safety.allMessages.map(m => m.replace(/<[^>]+>/g, '')).join(' ／ ');
        showToast('⛔ 安全基準エラー（農薬・有効成分上限または収穫前日数違反）：登録をブロックしました', plainMsg);
        return;
      }
    }

    const newLog = collectBaseWorkLog_(selectedFields, totalArea, editingBackup);
    const builder = SUBMIT_PAYLOAD_BUILDERS[currentWorkCat];
    if (builder) builder(newLog, totalArea);

    applyLogResourceEffects_(newLog, +1);
    if (editingBackup) workLogs.splice(editingBackup.idx, 0, newLog);
    else workLogs.unshift(newLog);
    recalculateFieldStats();

    if (isEditing) cancelEditMode(true);
    if (document.getElementById('workDiaryMemoInput')) document.getElementById('workDiaryMemoInput').value = '';
    saveStateToStorage();
    refreshAllViews();

    showToast(
      isEditing
        ? `✏️ 作業履歴・日誌を修正しました（${selectedFields.length} 筆）`
        : `🎉 1アクションで ${selectedFields.length} 筆のカルテ＆営農日誌を端末保存しました！`,
      `対象: ${selectedFields.map(f => f.name).join('・')} (計${totalArea}a) ／ 日誌タイムライン・A4帳票へ即時反映されました。`
    );
  } catch (err) {
    abort();
    saveStateToStorage();
    refreshAllViews();
    showToast('⚠️ 登録処理中にエラーが発生したため、元の履歴を復元しました', String(err && err.message ? err.message : err));
  }
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
    const fBadges = rawHtml(matchedFields.map(f =>
      safeHtml`<button type="button" data-action="openFieldInGoogleMaps" data-arg="${f.id}" class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 font-semibold text-[11px] hover:bg-emerald-500/25" title="Googleマップでこの圃場を表示">📍${f.name}(${f.area}a)</button>`
    ).join(' '));
    const weatherStr = formatWeatherSummary_(l);
    const memoBlock = l.memo
      ? rawHtml(safeHtml`<div class="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-[var(--foreground)]"><span class="font-bold text-amber-700">📔 日誌メモ:</span> ${l.memo}</div>`)
      : '';

    return safeHtml`
      <div class="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--border)] text-xs space-y-1.5">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-[var(--foreground)]">📅 ${l.date}</span>
            <span class="px-2 py-0.5 rounded-lg bg-emerald-600 text-white font-bold">${l.cat}</span>
            <span class="text-[var(--muted-foreground)] font-semibold">${weatherStr}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-emerald-600">${(Number(l.duration) || 0).toFixed(1)}h (計${l.totalArea}a)</span>
            <button type="button" data-action="editWorkLog" data-arg="${l.id}" class="px-2 py-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] font-semibold hover:opacity-80">✏️ 修正</button>
            <button type="button" data-action="deleteWorkLog" data-arg="${l.id}" class="px-2 py-0.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 font-semibold hover:bg-red-500/20">🗑️ 取消</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1 pt-0.5">${fBadges}</div>
        <div class="text-[var(--foreground)] font-semibold">${l.materialSummary}</div>
        <div class="text-[var(--muted-foreground)]">👤 作業者: ${l.worker} ／ 🚜 機材: ${l.machineName}</div>
        ${memoBlock}
      </div>
    `;
  }).join('');
}

