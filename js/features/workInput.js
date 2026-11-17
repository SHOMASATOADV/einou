// Feature: Work Input, Preview, Submit/Edit/Rollback, Diary Timeline
function setTodayWorkDate() {
  const el = document.getElementById('workDateInput');
  if (el) {
    el.value = getTodayIsoDate();
    recalculatePreview();
  }
}

function renderSelectOptions() {
  const mSel = document.getElementById('machineSelect');
  const curM = mSel.value;
  mSel.innerHTML = Object.values(machines).map(m => {
    const warn = (m.nextMaint - m.currentHour) <= 10 ? ' ⚠️点検近し' : '';
    return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (現在 ${m.currentHour.toFixed(1)}h${warn})</option>`;
  }).join('') + `<option value="NONE">機械なし（手作業・見回り）</option>`;
  mSel.value = machines[curM] ? curM : (Object.keys(machines)[0] || 'NONE');

  const fSel = document.getElementById('fertilizerSelect');
  const curF = fSel.value;
  const fertVals = Object.values(fertilizers);
  fSel.innerHTML = fertVals.length > 0
    ? fertVals.map(f =>
      `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)} (${f.unitKg}kg/袋 | N${f.n}-P${f.p}-K${f.k} | 残${f.stock}袋)</option>`
    ).join('')
    : `<option value="">未登録（＋追加 または 資源タブから登録）</option>`;
  fSel.value = fertilizers[curF] ? curF : (Object.keys(fertilizers)[0] || '');

  const pSel = document.getElementById('pesticideSelect');
  const curP = pSel.value;
  const pestVals = Object.values(pesticides);
  pSel.innerHTML = pestVals.length > 0
    ? pestVals.map(p => {
      const ing = p.activeIngredient ? `成分:${p.activeIngredient} / ` : '';
      const st = formatPesticideStock_(p);
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.regNo)} | ${escapeHtml(ing)}上限${p.maxUse}回・PHI${p.phiDays}日 | 残${st.totalLabel})</option>`;
    }).join('')
    : `<option value="">未登録（＋追加 または 資源タブから登録）</option>`;
  pSel.value = pesticides[curP] ? curP : (Object.keys(pesticides)[0] || '');

  const pMixSel = document.getElementById('pesticideMixSelect');
  if (pMixSel) {
    const curMix = pMixSel.value || 'NONE';
    pMixSel.innerHTML = `<option value="NONE">混用なし（1剤単独散布）</option>` +
      pestVals.map(p => {
        const ing = p.activeIngredient ? `成分:${p.activeIngredient} / ` : '';
        return `<option value="${escapeHtml(p.id)}">＋混用: ${escapeHtml(p.name)} (${escapeHtml(ing)}上限${p.maxUse}回・収穫前${p.phiDays}日)</option>`;
      }).join('');
    pMixSel.value = pesticides[curMix] ? curMix : 'NONE';
  }
}

function getSelectedPesticideIdsFromUi_() {
  const p1 = document.getElementById('pesticideSelect')?.value || '';
  const p2 = document.getElementById('pesticideMixSelect')?.value || 'NONE';
  const ids = p1 ? [p1] : [];
  if (p2 && p2 !== 'NONE' && p2 !== p1) ids.push(p2);
  return ids;
}


function renderInputFieldGrid() {
  const container = document.getElementById('inputFieldGrid');
  container.innerHTML = fieldsData.map(f => {
    const isSel = selectedFieldIds.includes(f.id);
    const activeCls = isSel
      ? 'border-2 border-emerald-600 bg-emerald-500/15 text-[var(--foreground)] shadow-sm'
      : 'border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-emerald-500/50';
    const checkIcon = isSel ? '☑️' : '⬜';
    const alertCnt = Array.isArray(f.alerts) ? f.alerts.length : 0;
    const alertBadge = alertCnt > 0 ? rawHtml(safeHtml`<span class="text-xs text-amber-600 font-bold ml-1" title="見回りアラート ${alertCnt}件">⚠️${alertCnt}</span>`) : '';
    const distBadge = f._distM !== undefined ? rawHtml(safeHtml`<span class="text-xs text-sky-600 font-semibold ml-1">(${f._distM}m)</span>`) : '';
    return safeHtml`
      <div data-action="toggleFieldSelection" data-arg="${f.id}" role="button" tabindex="0" class="cursor-pointer p-2.5 rounded-xl text-left transition ${activeCls}">
        <div class="flex items-center justify-between gap-1">
          <span class="text-xs font-bold text-[var(--foreground)] truncate">${checkIcon} ${f.name}${alertBadge}</span>
          <span class="text-xs font-bold text-emerald-600 shrink-0">${f.area}a</span>
        </div>
        <div class="flex items-center justify-between gap-1 mt-1">
          <span class="text-xs text-[var(--muted-foreground)] truncate">${f.lot} ${distBadge}</span>
          <button type="button" data-action="openFieldInGoogleMaps" data-arg="${f.id}" data-stop="true" class="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 text-[10px] font-bold shrink-0" title="Googleマップでこの圃場を開く">📍Map</button>
        </div>
      </div>
    `;
  }).join('');
  refreshInteractiveMaps_();
}


function applyPreset(presetType) {
  const catMap = { fertilizer: '施肥', pesticide: '防除', mowing: '草刈り' };
  const targetCat = catMap[presetType] || '施肥';
  const sortedLogs = [...workLogs].sort((a, b) => dateKey_(b.date).localeCompare(dateKey_(a.date)));
  const latestLog = sortedLogs.find(l => l.cat === targetCat);

  const validFieldIds = (ids) => {
    const filtered = (ids || []).filter(id => fieldsData.some(f => f.id === id));
    return filtered.length > 0 ? filtered : fieldsData.slice(0, 3).map(f => f.id);
  };
  const validMachId = (id, fallback) => {
    if (id && machines[id]) return id;
    if (fallback && machines[fallback]) return fallback;
    return Object.keys(machines)[0] || 'NONE';
  };

  if (presetType === 'fertilizer') {
    selectedFieldIds = validFieldIds(latestLog?.fieldIds || ['F01', 'F02', 'F03']);
    currentDuration = Number(latestLog?.duration) || 2.0;
    currentBags = Number(latestLog?.inputQty) || 10;
    document.getElementById('machineSelect').value = validMachId(latestLog?.machineId, 'M01');
    const fertId = (latestLog?.materialId && fertilizers[latestLog.materialId])
      ? latestLog.materialId
      : (fertilizers['F01'] ? 'F01' : Object.keys(fertilizers)[0] || '');
    if (fertId) document.getElementById('fertilizerSelect').value = fertId;
    selectWorkCat('施肥');
  } else if (presetType === 'pesticide') {
    selectedFieldIds = validFieldIds(latestLog?.fieldIds || ['F01', 'F02', 'F03']);
    currentDuration = Number(latestLog?.duration) || 1.5;
    document.getElementById('machineSelect').value = validMachId(latestLog?.machineId, 'M03');
    const logPids = latestLog ? getLogPesticideIds(latestLog).filter(id => pesticides[id]) : [];
    const allPestKeys = Object.keys(pesticides);
    const p1 = logPids[0] || (pesticides['P01'] ? 'P01' : allPestKeys[0] || '');
    const p2 = logPids[1] || (!latestLog && pesticides['P02'] ? 'P02' : 'NONE');
    if (p1) document.getElementById('pesticideSelect').value = p1;
    if (document.getElementById('pesticideMixSelect')) {
      document.getElementById('pesticideMixSelect').value = (p2 && p2 !== p1 && pesticides[p2]) ? p2 : 'NONE';
    }
    const dilSel = document.getElementById('dilutionSelect');
    if (latestLog?.dilutionRate && dilSel) {
      const opt = [...dilSel.options].find(o => o.value.split('_')[0] === String(latestLog.dilutionRate));
      if (opt) dilSel.value = opt.value;
    } else if (dilSel) {
      dilSel.value = '8_0.8';
    }
    selectWorkCat('防除');
  } else if (presetType === 'mowing') {
    const yamaDefault = fieldsData.filter(f => f.group === 'yama').map(f => f.id);
    selectedFieldIds = validFieldIds(latestLog?.fieldIds || (yamaDefault.length > 0 ? yamaDefault : ['F05', 'F06', 'F07']));
    currentDuration = Number(latestLog?.duration) || 2.5;
    document.getElementById('machineSelect').value = validMachId(latestLog?.machineId, 'M02');
    selectWorkCat('草刈り');
  }
  document.getElementById('durationValue').textContent = currentDuration.toFixed(1);
  document.getElementById('bagCountValue').textContent = currentBags;
  renderInputFieldGrid();
  recalculatePreview();
  showToast(
    latestLog ? `⚡ 直近の「${targetCat}」履歴（${latestLog.date}）を呼び出しました` : `⚡ 「${targetCat}」の標準プリセットを呼び出しました`,
    '対象圃場や数量を確認し、1タップで登録できます。'
  );
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
    toggleWeatherDetailPanel(true);
  } else if (cat === '収穫') {
    if (harvPanel) harvPanel.classList.remove('hidden');
    secTitle.textContent = '収穫・刈取記録（袋数・屑米を入れるだけで10a反収［俵/kg］と圃場別収量を自動按分）';
  } else {
    nonePanel.classList.remove('hidden');
    secTitle.textContent = `使用資材（${cat}：資材消費なし）`;
  }
  recalculatePreview();
}

function toggleWeatherDetailPanel(forceOpen) {
  const panel = document.getElementById('weatherDetailPanel');
  const btn = document.getElementById('weatherDetailToggleBtn');
  if (!panel) return;
  const open = forceOpen !== undefined ? forceOpen : panel.classList.contains('hidden');
  if (open) {
    panel.classList.remove('hidden');
    if (btn) btn.textContent = '🌦️ 詳細気象（降水量・風向・風速）▲';
  } else {
    panel.classList.add('hidden');
    if (btn) btn.textContent = '🌦️ 詳細気象（降水量・風向・風速）▼';
  }
}

function adjustWasteRiceKg(delta) {
  const el = document.getElementById('harvestWasteKgInput');
  if (!el) return;
  const cur = Math.max(0, Number(el.value) || 0);
  el.value = Math.max(0, cur + delta);
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


function computeFertilizerPreview_(totalArea) {
  const fertId = document.getElementById('fertilizerSelect').value;
  const rawFert = fertilizers[fertId] || Object.values(fertilizers)[0];
  const fert = rawFert || { unitKg: 20, n: 0, p: 0, k: 0, name: '未登録', stock: 0 };
  const totalKg = currentBags * fert.unitKg;
  const fertPer10a = totalArea > 0 ? (totalKg / (totalArea / 10)) : 0;
  const nTotal = totalKg * (fert.n / 100);
  const pTotal = totalKg * (fert.p / 100);
  const kTotal = totalKg * (fert.k / 100);

  document.getElementById('totalKgValue').textContent = totalKg;
  document.getElementById('calcFertPer10a').textContent = fertPer10a.toFixed(1);
  document.getElementById('calcNPer10a').textContent = (fertPer10a * (fert.n / 100)).toFixed(2);
  document.getElementById('calcPPer10a').textContent = (fertPer10a * (fert.p / 100)).toFixed(2);
  document.getElementById('calcKPer10a').textContent = (fertPer10a * (fert.k / 100)).toFixed(2);
  document.getElementById('calcNTotal').textContent = nTotal.toFixed(1);
  document.getElementById('calcPTotal').textContent = pTotal.toFixed(1);
  document.getElementById('calcKTotal').textContent = kTotal.toFixed(1);
  return { rawFert, fert, totalKg, nTotal };
}

function computeHarvestPreview_(totalArea) {
  const harvTotalKg = currentHarvestBags * 30;
  const wasteKg = Math.max(0, Number(document.getElementById('harvestWasteKgInput')?.value) || 0);
  const wasteRatePct = (harvTotalKg + wasteKg) > 0 ? (wasteKg / (harvTotalKg + wasteKg)) * 100 : 0;
  const yieldKg10a = totalArea > 0 ? (harvTotalKg / (totalArea / 10)) : 0;
  const yieldTawara10a = yieldKg10a / 60;
  if (document.getElementById('calcHarvestTotalKg')) {
    document.getElementById('calcHarvestTotalKg').textContent = harvTotalKg.toLocaleString('ja-JP');
    document.getElementById('calcYieldKg10a').textContent = Math.round(yieldKg10a).toLocaleString('ja-JP');
    document.getElementById('calcYieldTawara10a').textContent = yieldTawara10a.toFixed(1);
    if (document.getElementById('calcHarvestWasteKg')) {
      document.getElementById('calcHarvestWasteKg').textContent = wasteKg.toLocaleString('ja-JP');
    }
    if (document.getElementById('calcHarvestWasteRate')) {
      document.getElementById('calcHarvestWasteRate').textContent = wasteRatePct.toFixed(1);
    }
  }
  return { harvTotalKg, wasteKg, wasteRatePct, yieldTawara10a };
}

function renderPesticideAlertBox_(selectedFields, selectedPests, safetyResult, weatherInfo) {
  const { weatherVal, rainfallVal, windDirVal, windSpeedVal } = weatherInfo;
  const weatherWarnings = [];
  if (windSpeedVal >= 5.0 || weatherVal.includes('強風')) {
    weatherWarnings.push(`🌬️ <strong>強風ドリフト警戒（風速 ${windSpeedVal}m/s・${escapeHtml(windDirVal)}）</strong>：農薬飛散リスクが高いため散布中止・時間帯変更を推奨します。`);
  } else if (windSpeedVal >= 3.0) {
    weatherWarnings.push(`⚠️ <strong>風速注意（${windSpeedVal}m/s・${escapeHtml(windDirVal)}）</strong>：隣接圃場へのドリフトに注意して散布してください。`);
  }
  if (rainfallVal > 0 || weatherVal.includes('雨')) {
    weatherWarnings.push(`🌧️ <strong>降雨・流亡注意（降水量 ${rainfallVal}mm）</strong>：薬液の流亡・効果低下のおそれがあります。`);
  }

  const alertBox = document.getElementById('safetyAlertBox');
  const summaryLabels = selectedPests.map(p =>
    `${escapeHtml(p.name)}［成分:${escapeHtml(p.activeIngredient || '-')} 上限${p.maxUse}回・収穫前${p.phiDays}日］`
  ).join(' ＋ ');

  if (!safetyResult.ok) {
    alertBox.className = 'p-3 rounded-xl border border-red-500/50 bg-red-500/15 text-xs font-bold text-red-600 space-y-1';
    alertBox.innerHTML = [...safetyResult.allMessages, ...weatherWarnings].map(m => `<div>${m}</div>`).join('');
  } else if (weatherWarnings.length > 0) {
    alertBox.className = 'p-3 rounded-xl border border-amber-500/50 bg-amber-500/15 text-xs font-semibold text-amber-800 space-y-1';
    alertBox.innerHTML = `<div>✅ 農薬・有効成分 安全基準OK（${summaryLabels}）</div>` + weatherWarnings.map(m => `<div>${m}</div>`).join('');
  } else {
    alertBox.className = 'p-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-600';
    alertBox.innerHTML = `✅ 農薬・有効成分・気象条件OK（風速 ${windSpeedVal}m/s / 降水 ${rainfallVal}mm）：選択された全 ${selectedFields.length} 圃場で ${summaryLabels} の基準を満たしています。`;
  }
}

function computePesticidePreview_(selectedFields, totalArea, weatherInfo) {
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
  renderPesticideAlertBox_(selectedFields, selectedPests, safetyResult, weatherInfo);
  return { selectedPests, totalWaterL, totalChemMl };
}

const PREVIEW_HANDLERS = {
  '施肥': {
    header: '按分施肥量 (N成分)',
    formatCell: (ratio, ctx) => {
      const fKg = ctx.fertPreview.totalKg * ratio;
      const fN = ctx.fertPreview.nTotal * ratio;
      return rawHtml(`${fKg.toFixed(1)}kg <span class="text-emerald-600 font-semibold">(N:${fN.toFixed(1)}kg)</span>`);
    },
    stockSummary: (ctx) => ctx.fertPreview.rawFert
      ? `${ctx.fertPreview.fert.name}: 現在庫 ${ctx.fertPreview.fert.stock}袋 → 登録後 ${Math.max(0, ctx.fertPreview.fert.stock - currentBags)}袋`
      : '肥料マスタ未登録（＋追加 または 資源タブから登録してください）'
  },
  '防除': {
    header: '按分散布液量 (薬量)',
    formatCell: (ratio, ctx) => {
      const fWater = ctx.pestPreview.totalWaterL * ratio;
      const fChem = ctx.pestPreview.totalChemMl * ratio;
      const mixSuffix = ctx.pestPreview.selectedPests.length > 1 ? `×${ctx.pestPreview.selectedPests.length}剤` : '';
      return rawHtml(`${fWater.toFixed(1)}L <span class="text-sky-600 font-semibold">(${Math.round(fChem)}mL${mixSuffix})</span>`);
    },
    stockSummary: (ctx) => ctx.pestPreview.selectedPests.length > 0
      ? ctx.pestPreview.selectedPests.map(p => {
        const unitInfo = calcPesticideUnitQty(p, ctx.totalArea, ctx.pestPreview.totalChemMl);
        if (unitInfo.isLiquid) {
          const curMl = Math.round(Number(p.stockMl) || 0);
          const nextMl = Math.max(0, curMl - unitInfo.neededMl);
          return `${p.name}: 残${curMl.toLocaleString()}mL → ${nextMl.toLocaleString()}mL (-${unitInfo.neededMl.toLocaleString()}mL)`;
        }
        const curKg = Math.round((Number(p.stockKg) || 0) * 10) / 10;
        const nextKg = Math.max(0, Math.round((curKg - unitInfo.neededKg) * 10) / 10);
        return `${p.name}: 残${curKg}kg → ${nextKg}kg (-${unitInfo.neededKg}kg)`;
      }).join(' ／ ')
      : '農薬マスタ未登録（＋追加 または 資源タブから登録してください）'
  },
  '収穫': {
    header: '按分収量 (反収)',
    formatCell: (ratio, ctx) => {
      const { harvTotalKg, wasteKg, yieldTawara10a } = ctx.harvPreview;
      const fHarvKg = Math.round(harvTotalKg * ratio);
      const fWasteKg = Math.round(wasteKg * ratio);
      const wasteStr = wasteKg > 0 ? ` <span class="text-slate-500">+ 屑${fWasteKg}kg</span>` : '';
      return rawHtml(`${fHarvKg.toLocaleString()}kg${wasteStr} <span class="text-amber-600 font-semibold">(${yieldTawara10a.toFixed(1)}俵/10a)</span>`);
    },
    stockSummary: (ctx) => {
      const { harvTotalKg, wasteKg, wasteRatePct, yieldTawara10a } = ctx.harvPreview;
      const grade = document.getElementById('harvestGradeSelect')?.value || '1等';
      const moist = document.getElementById('harvestMoistureInput')?.value || '14.8';
      const tasteSummary = typeof formatTasteSummary_ === 'function'
        ? formatTasteSummary_({
          tasteScore: document.getElementById('harvestTasteScoreInput')?.value,
          protein: document.getElementById('harvestProteinInput')?.value,
          wholeGrainRate: document.getElementById('harvestWholeGrainInput')?.value,
          amylose: document.getElementById('harvestAmyloseInput')?.value
        })
        : '';
      const tasteNote = tasteSummary ? ` / ${tasteSummary}` : '';
      const wasteNote = wasteKg > 0 ? ` / 屑米${wasteKg}kg(${wasteRatePct.toFixed(1)}%)` : '';
      return `収穫玄米: ${currentHarvestBags}袋 (${harvTotalKg}kg)${wasteNote} / 水分${moist}% / ${grade}${tasteNote} (${yieldTawara10a.toFixed(1)}俵/10a)`;
    }
  }
};

function recalculatePreview() {
  const selectedFields = fieldsData.filter(f => selectedFieldIds.includes(f.id));
  const totalArea = selectedFields.reduce((sum, f) => sum + f.area, 0);

  document.getElementById('selectedCountLabel').textContent = selectedFields.length;
  document.getElementById('selectedTotalAreaLabel').textContent = totalArea;
  document.getElementById('selectedTotalTanLabel').textContent = (totalArea / 10).toFixed(1);

  const weatherInfo = {
    weatherVal: document.getElementById('workWeatherSelect')?.value || '☀️ 晴れ',
    tempVal: document.getElementById('workTempInput')?.value || '25',
    rainfallVal: Math.max(0, Number(document.getElementById('workRainfallInput')?.value) || 0),
    windDirVal: document.getElementById('workWindDirSelect')?.value || '静穏',
    windSpeedVal: Math.max(0, Number(document.getElementById('workWindSpeedInput')?.value) || 0)
  };

  const ctx = {
    totalArea,
    fertPreview: computeFertilizerPreview_(totalArea),
    harvPreview: computeHarvestPreview_(totalArea),
    pestPreview: computePesticidePreview_(selectedFields, totalArea, weatherInfo)
  };

  const handler = PREVIEW_HANDLERS[currentWorkCat];
  document.getElementById('allocColHeader').textContent = handler ? handler.header : '更新ステータス';
  document.getElementById('allocationPreviewBody').innerHTML = selectedFields.map(f => {
    const ratio = totalArea > 0 ? (f.area / totalArea) : 0;
    const allocHr = currentDuration * ratio;
    const rightCell = handler ? handler.formatCell(ratio, ctx) : `${currentWorkCat}済`;
    return safeHtml`
      <tr class="hover:bg-[var(--secondary)]/50">
        <td class="p-2.5 font-semibold text-[var(--foreground)]">${f.name}</td>
        <td class="p-2.5 text-right">${f.area}a</td>
        <td class="p-2.5 text-right font-mono">${(ratio * 100).toFixed(0)}%</td>
        <td class="p-2.5 text-right font-semibold">${allocHr.toFixed(2)}h</td>
        <td class="p-2.5 text-right">${rightCell}</td>
      </tr>
    `;
  }).join('');

  const workerName = document.getElementById('workerNameInput').value || '佐藤 健一';
  const memoVal = (document.getElementById('workDiaryMemoInput')?.value || '').trim();
  const memoPreview = memoVal ? ` ／ 📔メモ: ${memoVal}` : '';
  const weatherSummary = formatWeatherSummary_({
    weather: weatherInfo.weatherVal,
    tempC: weatherInfo.tempVal,
    rainfallMm: weatherInfo.rainfallVal,
    windDir: weatherInfo.windDirVal,
    windSpeedMs: weatherInfo.windSpeedVal
  });
  document.getElementById('previewDiarySummary').textContent =
    `天候: ${weatherSummary} / 作業者: ${workerName} / 分類: ${currentWorkCat} / 合計: ${currentDuration.toFixed(1)}h (${selectedFields.length}筆へ按分)${memoPreview}`;

  const machId = document.getElementById('machineSelect').value;
  if (machId !== 'NONE' && machines[machId]) {
    const m = machines[machId];
    document.getElementById('previewMachineSummary').textContent =
      `${m.name}: ${m.currentHour.toFixed(1)}h → ${(m.currentHour + currentDuration).toFixed(1)}h (次回点検目安 ${m.nextMaint}h)`;
  } else {
    document.getElementById('previewMachineSummary').textContent = '機械使用なし（手作業）';
  }

  document.getElementById('previewStockSummary').textContent = handler
    ? handler.stockSummary(ctx)
    : '資材消費なし（在庫変動なし）';
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

