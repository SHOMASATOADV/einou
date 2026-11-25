// Feature: JA / Gov A4 Reports & CSV Export
function switchReportType(type) {
  ['ja', 'daily', 'yield', 'regression', 'portfolio', 'pareto'].forEach(t => {
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
  if (type === 'regression' && typeof renderNitrogenRegressionDashboard === 'function') {
    renderNitrogenRegressionDashboard();
  }
  if (type === 'portfolio' && typeof renderPortfolioDashboard === 'function') {
    renderPortfolioDashboard();
  }
  if (type === 'pareto' && typeof renderParetoDashboard === 'function') {
    renderParetoDashboard();
  }
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

function getJaReportTargetFields_() {
  const cropFilter = document.getElementById('jaReportCropFilter')?.value || 'ALL';
  const fieldFilter = document.getElementById('jaReportFieldFilter')?.value || 'ALL';

  const targetFields = fieldsData.filter(f => {
    const cropOk = (cropFilter === 'ALL') || (f.crop === cropFilter);
    let fieldOk = true;
    if (fieldFilter.startsWith('GROUP_')) {
      fieldOk = (f.group === fieldFilter.replace('GROUP_', ''));
    } else if (fieldFilter !== 'ALL') {
      fieldOk = (f.id === fieldFilter);
    }
    return cropOk && fieldOk;
  });
  const targetFieldIds = targetFields.map(f => f.id);
  const targetTotalArea = targetFields.reduce((sum, f) => sum + f.area, 0);

  const cropLabelEl = document.getElementById('jaHeaderCropLabel');
  const areaLabelEl = document.getElementById('jaHeaderAreaLabel');
  if (cropLabelEl) cropLabelEl.textContent = cropFilter === 'ALL' ? '全品種' : cropFilter;
  if (areaLabelEl) {
    const namesPreview = targetFields.length <= 3
      ? targetFields.map(f => f.name).join('・')
      : `${targetFields[0].name} ほか計${targetFields.length}筆`;
    areaLabelEl.textContent = targetFields.length > 0
      ? `${namesPreview}（合計 ${targetTotalArea} a）`
      : '該当圃場なし (0 a)';
  }
  return { targetFields, targetFieldIds, targetTotalArea };
}

function renderJaFertilizerTable_(targetFields, targetFieldIds, targetTotalArea) {
  const fertLogs = workLogs.filter(l => l.type === 'fertilizer' && l.fieldIds.some(id => targetFieldIds.includes(id)));
  let weightedNTotalKg = 0;
  let weightedPTotalKg = 0;
  let weightedKTotalKg = 0;

  const fertRowsHtml = fertLogs.map(l => {
    const matchedFieldsInLog = l.fieldIds
      .map(id => fieldsData.find(f => f.id === id))
      .filter(f => f && targetFieldIds.includes(f.id));
    const matchedArea = matchedFieldsInLog.reduce((s, f) => s + f.area, 0);
    const areaRatio = matchedArea / (l.totalArea || matchedArea || 1);
    const allocatedKg = Math.round(l.totalKg * areaRatio * 10) / 10;

    weightedNTotalKg += l.n10a * (matchedArea / 10);
    weightedPTotalKg += l.p10a * (matchedArea / 10);
    weightedKTotalKg += l.k10a * (matchedArea / 10);

    return safeHtml`
      <tr>
        <td class="border border-slate-400 p-2">${l.date}</td>
        <td class="border border-slate-400 p-2">${matchedFieldsInLog.map(f => f.name).join('、')}</td>
        <td class="border border-slate-400 p-2 text-right">${matchedArea} a</td>
        <td class="border border-slate-400 p-2 font-semibold">${l.fertName}</td>
        <td class="border border-slate-400 p-2 text-center">${l.npkLabel}</td>
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
}

function buildPestSafetySnapshotMap_() {
  const chronologicalPestLogs = workLogs
    .map((l, idx) => ({ l, idx }))
    .filter(x => x.l.type === 'pesticide')
    .sort((a, b) => dateKey_(a.l.date).localeCompare(dateKey_(b.l.date)) || (b.idx - a.idx))
    .map(x => x.l);

  const fieldRunningProdCnt = {};
  const fieldRunningIngCnt = {};
  fieldsData.forEach(f => {
    const basePest = (f.baseline && f.baseline.pestCount) ? { ...f.baseline.pestCount } : {};
    fieldRunningProdCnt[f.id] = basePest;
    const baseIng = {};
    Object.entries(basePest).forEach(([pid, cnt]) => {
      if (!cnt || cnt <= 0) return;
      const pObj = pesticides[pid];
      const ing = (pObj && pObj.activeIngredient) ? pObj.activeIngredient : pid;
      baseIng[ing] = (baseIng[ing] || 0) + cnt;
    });
    fieldRunningIngCnt[f.id] = baseIng;
  });

  const logSafetySnapshotMap = {};
  chronologicalPestLogs.forEach(l => {
    const pids = getLogPesticideIds(l);
    const fids = l.fieldIds || [];
    const perPidSnapshot = {};
    const logDateMs = new Date(String(l.date || '').replace(/\//g, '-')).setHours(0, 0, 0, 0);

    pids.forEach(pid => {
      const pObj = pesticides[pid];
      const ing = (pObj && pObj.activeIngredient) ? pObj.activeIngredient : pid;
      let maxProdAtLog = 0;
      let maxIngAtLog = 0;
      let phiViolated = false;

      fids.forEach(fid => {
        if (!fieldRunningProdCnt[fid]) fieldRunningProdCnt[fid] = {};
        if (!fieldRunningIngCnt[fid]) fieldRunningIngCnt[fid] = {};
        fieldRunningProdCnt[fid][pid] = (fieldRunningProdCnt[fid][pid] || 0) + 1;
        fieldRunningIngCnt[fid][ing] = (fieldRunningIngCnt[fid][ing] || 0) + 1;
        maxProdAtLog = Math.max(maxProdAtLog, fieldRunningProdCnt[fid][pid]);
        maxIngAtLog = Math.max(maxIngAtLog, fieldRunningIngCnt[fid][ing]);

        const fieldObj = fieldsData.find(item => item.id === fid);
        if (pObj && fieldObj && fieldObj.harvest) {
          const harvMs = new Date(String(fieldObj.harvest).replace(/\//g, '-')).setHours(0, 0, 0, 0);
          if (!isNaN(logDateMs) && !isNaN(harvMs)) {
            if (Math.floor((harvMs - logDateMs) / 86400000) < pObj.phiDays) phiViolated = true;
          }
        }
      });

      const overUse = pObj ? (maxProdAtLog > pObj.maxUse || maxIngAtLog > pObj.maxUse) : false;
      let status = 'ok';
      if (l.safetyOk === false || overUse || phiViolated) status = 'ng';
      else if (!pObj && l.safetyOk !== true) status = 'unverified';
      perPidSnapshot[pid] = { maxProdAtLog, maxIngAtLog, overUse, phiViolated, status };
    });
    logSafetySnapshotMap[l.id] = perPidSnapshot;
  });
  return logSafetySnapshotMap;
}

function renderJaPesticideTable_(targetFieldIds) {
  const pestLogs = workLogs.filter(l => l.type === 'pesticide' && l.fieldIds.some(id => targetFieldIds.includes(id)));
  const logSafetySnapshotMap = buildPestSafetySnapshotMap_();

  const renderVerdictCell_ = (status) => {
    if (status === 'ng') return rawHtml('<td class="border border-slate-400 p-2 text-center font-bold text-red-600">⚠️ 要確認（基準超過）</td>');
    if (status === 'unverified') return rawHtml('<td class="border border-slate-400 p-2 text-center font-bold text-amber-600">未判定（移行履歴）</td>');
    return rawHtml('<td class="border border-slate-400 p-2 text-center font-bold text-emerald-700">適（基準内）</td>');
  };

  const pestRows = [];
  pestLogs.forEach(l => {
    const matchedFieldsInLog = l.fieldIds
      .map(id => fieldsData.find(f => f.id === id))
      .filter(f => f && targetFieldIds.includes(f.id));
    const matchedArea = matchedFieldsInLog.reduce((s, f) => s + f.area, 0);
    const areaRatio = matchedArea / (l.totalArea || matchedArea || 1);
    const allocWaterL = Math.round(l.waterL * areaRatio * 10) / 10;
    const allocChemMl = Math.round((parseFloat(String(l.chemAmount || '0').replace(/,/g, '')) || 0) * areaRatio);
    const fNames = matchedFieldsInLog.map(f => f.name).join('、');
    const snapMap = logSafetySnapshotMap[l.id] || {};
    const pids = getLogPesticideIds(l);

    if (pids.length > 1) {
      pids.forEach((pid, idx) => {
        const pObj = pesticides[pid];
        const snap = snapMap[pid] || { maxIngAtLog: 1, status: l.safetyOk === false ? 'ng' : (pObj ? 'ok' : 'unverified') };
        const pLabel = pObj ? `${pObj.name} (${pObj.regNo} / 成分:${pObj.activeIngredient || '-'}) [混用${idx + 1}]` : `${pid} [混用${idx + 1}]`;
        const ingCnt = pObj ? `成分${snap.maxIngAtLog}回目 / 上限${pObj.maxUse}回` : (l.useCountLabel || '未設定');
        pestRows.push(safeHtml`
          <tr>
            <td class="border border-slate-400 p-2">${l.date}</td>
            <td class="border border-slate-400 p-2">${fNames}</td>
            <td class="border border-slate-400 p-2 text-right">${matchedArea} a</td>
            <td class="border border-slate-400 p-2 font-semibold">${pLabel}</td>
            <td class="border border-slate-400 p-2 text-center">${l.dilution}</td>
            <td class="border border-slate-400 p-2 text-right">${allocWaterL} L</td>
            <td class="border border-slate-400 p-2 text-right font-bold">${allocChemMl.toLocaleString()} mL</td>
            <td class="border border-slate-400 p-2 text-center">${ingCnt}</td>
            ${renderVerdictCell_(snap.status)}
          </tr>
        `);
      });
    } else {
      const pid = pids[0] || '';
      const pObj = pid ? pesticides[pid] : null;
      const snap = snapMap[pid] || { maxIngAtLog: 1, status: l.safetyOk === false ? 'ng' : ((pObj || l.safetyOk === true) ? 'ok' : 'unverified') };
      const pLabel = pObj && pObj.activeIngredient
        ? `${pObj.name} (${pObj.regNo} / 成分:${pObj.activeIngredient})`
        : (l.pestName || l.materialSummary || '移行農薬');
      const countLabel = pObj ? `${snap.maxIngAtLog}回目 / 上限${pObj.maxUse}回` : (l.useCountLabel || '未判定');
      pestRows.push(safeHtml`
        <tr>
          <td class="border border-slate-400 p-2">${l.date}</td>
          <td class="border border-slate-400 p-2">${fNames}</td>
          <td class="border border-slate-400 p-2 text-right">${matchedArea} a</td>
          <td class="border border-slate-400 p-2 font-semibold">${pLabel}</td>
          <td class="border border-slate-400 p-2 text-center">${l.dilution || '-'}</td>
          <td class="border border-slate-400 p-2 text-right">${allocWaterL} L</td>
          <td class="border border-slate-400 p-2 text-right font-bold">${allocChemMl.toLocaleString()} mL</td>
          <td class="border border-slate-400 p-2 text-center">${countLabel}</td>
          ${renderVerdictCell_(snap.status)}
        </tr>
      `);
    }
  });

  document.getElementById('jaReportPesticideBody').innerHTML =
    pestRows.join('') || `<tr><td colspan="9" class="border border-slate-400 p-3 text-center text-slate-500">該当する防除履歴はありません</td></tr>`;
}

function renderDailyWorkReport_() {
  document.getElementById('dailyReportBody').innerHTML = workLogs.map(l => {
    const fNames = (l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join('、');
    const weatherNote = l.weather ? rawHtml(safeHtml`<div class="text-[11px] text-slate-600">${formatWeatherSummary_(l)}</div>`) : '';
    const memoNote = l.memo ? rawHtml(safeHtml`<div class="text-[11px] text-amber-800 mt-0.5">📔 ${l.memo}</div>`) : '';
    return safeHtml`
      <tr>
        <td class="border border-slate-400 p-2">${l.date}${weatherNote}</td>
        <td class="border border-slate-400 p-2 font-bold">${l.cat}</td>
        <td class="border border-slate-400 p-2">${l.worker}</td>
        <td class="border border-slate-400 p-2">${fNames}</td>
        <td class="border border-slate-400 p-2 text-right">${l.totalArea} a</td>
        <td class="border border-slate-400 p-2 text-right font-bold">${(Number(l.duration) || 0).toFixed(1)} h</td>
        <td class="border border-slate-400 p-2">${l.machineName}</td>
        <td class="border border-slate-400 p-2">${l.materialSummary}${memoNote}</td>
        <td class="no-print border border-slate-400 p-1 text-center whitespace-nowrap">
          <button data-action="editWorkLog" data-arg="${l.id}" class="px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100" title="修正">✏️</button>
          <button data-action="deleteWorkLog" data-arg="${l.id}" class="px-1.5 py-0.5 rounded border border-red-300 bg-red-50 hover:bg-red-100" title="取消">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProfitabilityReport_() {
  const yieldBody = document.getElementById('yieldReportBody');
  if (!yieldBody) return;

  let sumArea = 0, sumHours = 0, sumHarvKg = 0, sumWasteKg = 0;
  let sumMatCost = 0, sumLabMachCost = 0, sumRevenue = 0, sumGrossProfit = 0;

  const rowsHtml = fieldsData.map(f => {
    const p = calcFieldProfitability(f);
    const gradeStr = f.grade || (p.harvKg > 0 ? '1等(見込)' : '収穫前');
    const matCost = p.fertCostYen + p.pestCostYen;
    const labMachCost = p.laborCostYen + p.machineCostYen;

    sumArea += f.area;
    sumHours += p.cumHours;
    sumHarvKg += p.harvKg;
    sumWasteKg += p.wasteRiceKg || 0;
    sumMatCost += matCost;
    sumLabMachCost += labMachCost;
    sumRevenue += p.grossRevenueYen;
    sumGrossProfit += p.grossProfitYen;

    const wasteCellNote = p.wasteRiceKg > 0
      ? rawHtml(`<div class="text-[10px] text-slate-500">屑米: ${p.wasteRiceKg.toLocaleString()}kg (${p.wasteRatePct.toFixed(1)}%)</div>`)
      : '';
    const profitCls = p.grossProfitYen >= 0 ? 'text-emerald-700' : 'text-red-600';
    return safeHtml`
      <tr>
        <td class="border border-slate-400 p-2 font-bold">${f.name} <div class="font-normal text-slate-600 text-[11px]">${f.lot}</div></td>
        <td class="border border-slate-400 p-2">${f.crop} <div class="font-bold text-slate-700">${f.area} a</div></td>
        <td class="border border-slate-400 p-2 text-right font-semibold">${p.cumHours.toFixed(1)} h</td>
        <td class="border border-slate-400 p-2 text-right">
          <span class="font-bold text-emerald-700">N:${f.nPer10a.toFixed(1)}</span>
          <div class="text-[11px] text-slate-600">P:${f.pPer10a.toFixed(1)} / K:${f.kPer10a.toFixed(1)}</div>
        </td>
        <td class="border border-slate-400 p-2 text-right">
          <span class="font-bold text-amber-700">${p.yieldTawara10a.toFixed(1)} 俵/10a</span>
          <div class="text-[11px] text-slate-600">${p.harvKg.toLocaleString()} kg (${gradeStr})</div>
          ${wasteCellNote}
        </td>
        <td class="border border-slate-400 p-2 text-right">
          <div class="font-semibold">${matCost.toLocaleString()} 円</div>
          <div class="text-[11px] text-slate-600">肥:${p.fertCostYen.toLocaleString()} / 薬:${p.pestCostYen.toLocaleString()}</div>
        </td>
        <td class="border border-slate-400 p-2 text-right">
          <div class="font-semibold">${labMachCost.toLocaleString()} 円</div>
          <div class="text-[11px] text-slate-600">労:${p.laborCostYen.toLocaleString()} / 機:${p.machineCostYen.toLocaleString()}</div>
        </td>
        <td class="border border-slate-400 p-2 text-right font-bold text-slate-900">
          ${p.grossRevenueYen.toLocaleString()} 円
        </td>
        <td class="border border-slate-400 p-2 text-right">
          <div class="font-bold ${profitCls}">${p.grossProfitYen >= 0 ? '+' : ''}${p.grossProfitYen.toLocaleString()} 円</div>
          <div class="text-[11px] font-bold ${profitCls}">(10a: ${p.profitPer10aYen >= 0 ? '+' : ''}${p.profitPer10aYen.toLocaleString()}円)</div>
        </td>
        <td class="border border-slate-400 p-2 text-center font-bold" style="color:${p.rankColor}">
          ${p.profitRank}
        </td>
      </tr>
    `;
  }).join('');

  const avgProfit10a = sumArea > 0 ? Math.round(sumGrossProfit / (sumArea / 10)) : 0;
  const avgYield10a = sumArea > 0 ? ((sumHarvKg / 60) / (sumArea / 10)).toFixed(1) : '0.0';
  const summaryRow = `
    <tr class="bg-emerald-50 font-bold text-slate-900">
      <td class="border border-slate-400 p-2">【全 ${fieldsData.length} 筆 経営合計・平均】</td>
      <td class="border border-slate-400 p-2 text-right">計 ${sumArea} a</td>
      <td class="border border-slate-400 p-2 text-right">${sumHours.toFixed(1)} h</td>
      <td class="border border-slate-400 p-2 text-right">-</td>
      <td class="border border-slate-400 p-2 text-right text-amber-800">平均 ${avgYield10a} 俵/10a<div class="text-[11px]">計 ${sumHarvKg.toLocaleString()} kg${sumWasteKg > 0 ? ` / 屑${sumWasteKg.toLocaleString()}kg` : ''}</div></td>
      <td class="border border-slate-400 p-2 text-right">${sumMatCost.toLocaleString()} 円</td>
      <td class="border border-slate-400 p-2 text-right">${sumLabMachCost.toLocaleString()} 円</td>
      <td class="border border-slate-400 p-2 text-right">${sumRevenue.toLocaleString()} 円</td>
      <td class="border border-slate-400 p-2 text-right text-emerald-800">
        ${sumGrossProfit >= 0 ? '+' : ''}${sumGrossProfit.toLocaleString()} 円
        <div class="text-[11px]">(10a平均: ${avgProfit10a >= 0 ? '+' : ''}${avgProfit10a.toLocaleString()}円)</div>
      </td>
      <td class="border border-slate-400 p-2 text-center text-emerald-800">総括</td>
    </tr>
  `;
  yieldBody.innerHTML = rowsHtml + summaryRow;
}

function renderReportsTab() {
  populateJaReportFilterOptions_();
  const { targetFields, targetFieldIds, targetTotalArea } = getJaReportTargetFields_();
  renderJaFertilizerTable_(targetFields, targetFieldIds, targetTotalArea);
  renderJaPesticideTable_(targetFieldIds);
  renderDailyWorkReport_();
  renderProfitabilityReport_();
  if (typeof renderNitrogenRegressionDashboard === 'function') {
    renderNitrogenRegressionDashboard();
  }
  if (typeof renderPortfolioDashboard === 'function') {
    renderPortfolioDashboard();
  }
  if (typeof renderParetoDashboard === 'function') {
    renderParetoDashboard();
  }
}

function updateCostSettingsFromUi() {
  const riceInput = document.getElementById('simRicePriceInput');
  const wasteInput = document.getElementById('simWastePriceInput');
  const wageInput = document.getElementById('simHourlyWageInput');
  if (typeof costSettings !== 'object' || !costSettings) {
    costSettings = { hourlyWageYen: 1500, ricePricePerTawaraYen: 18500, wasteRicePricePerKgYen: 50 };
  }
  if (riceInput) costSettings.ricePricePerTawaraYen = Math.max(1000, Number(riceInput.value) || 18500);
  if (wasteInput) costSettings.wasteRicePricePerKgYen = Math.max(0, Number(wasteInput.value) || 0);
  if (wageInput) costSettings.hourlyWageYen = Math.max(500, Number(wageInput.value) || 1500);
  saveStateToStorage();
  renderReportsTab();
  showToast(
    '💴 経営分析パラメータを更新しました',
    `想定米価: ${costSettings.ricePricePerTawaraYen.toLocaleString()}円/俵 ／ 時給単価: ${costSettings.hourlyWageYen.toLocaleString()}円/h で全圃場の10a粗利を再計算しました。`
  );
}

function exportCsvData() {
  const header = ['作業日', '天候', '気温(℃)', '作業分類', '作業者', '対象圃場', '合計面積(a)', '作業時間(h)', '使用機械', '使用資材摘要', '日誌メモ'];
  const rows = workLogs.map(l => {
    const fNames = (l.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join('・');
    return [l.date, l.weather || '☀️ 晴れ', l.tempC ?? '', l.cat, l.worker, fNames, l.totalArea, l.duration, l.machineName, l.materialSummary, l.memo || ''].map(toCsvCell).join(',');
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

