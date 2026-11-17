// Domain Calculations: NPK, Pesticide Units, Accumulated Temp, Profitability, Field Stats
function getLogPesticideIds(log) {
  if (Array.isArray(log.materialIds) && log.materialIds.length > 0) {
    return log.materialIds.filter(Boolean);
  }
  if (log.materialId) {
    return String(log.materialId).split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * 農薬が粒剤・粉剤（kg/袋管理）か液剤（mL/本管理）かを判定する
 */
function isGranulePesticide_(pest) {
  if (!pest) return false;
  if (pest.formulation === 'granule') return true;
  if (pest.formulation === 'liquid') return false;
  const unitStr = String(pest.unit || '');
  return unitStr.includes('袋') || unitStr.includes('kg');
}

/**
 * 農薬マスタの精密在庫フィールド（stockMl / stockKg / unitSizeMl / unitSizeKg）を正規化・移行する
 */
function ensurePesticideInventoryFields_(pest) {
  if (!pest || typeof pest !== 'object') return pest;
  const isGranule = isGranulePesticide_(pest);
  pest.formulation = isGranule ? 'granule' : 'liquid';
  if (isGranule) {
    pest.unitSizeKg = Math.max(0.1, Number(pest.unitSizeKg) || 3);
    pest.rateKgPer10a = Math.max(0.1, Number(pest.rateKgPer10a) || 1.0);
    if (pest.stockKg === undefined || isNaN(Number(pest.stockKg))) {
      pest.stockKg = Math.round(Math.max(0, Number(pest.stock) || 0) * pest.unitSizeKg * 10) / 10;
    } else {
      pest.stockKg = Math.round(Math.max(0, Number(pest.stockKg)) * 10) / 10;
    }
    pest.stock = Math.round((pest.stockKg / pest.unitSizeKg) * 100) / 100;
    if (!pest.unit) pest.unit = `袋(${pest.unitSizeKg}kg)`;
  } else {
    pest.unitSizeMl = Math.max(10, Number(pest.unitSizeMl) || 500);
    if (pest.stockMl === undefined || isNaN(Number(pest.stockMl))) {
      pest.stockMl = Math.round(Math.max(0, Number(pest.stock) || 0) * pest.unitSizeMl);
    } else {
      pest.stockMl = Math.round(Math.max(0, Number(pest.stockMl)));
    }
    pest.stock = Math.round((pest.stockMl / pest.unitSizeMl) * 100) / 100;
    if (!pest.unit) pest.unit = `本(${pest.unitSizeMl}mL)`;
  }
  return pest;
}

/**
 * 農薬の現在庫を「総量 + 本数/袋数・端数」形式で表示用に整形する
 */
function formatPesticideStock_(pest) {
  ensurePesticideInventoryFields_(pest);
  if (pest.formulation === 'granule') {
    const unitKg = pest.unitSizeKg;
    const totalKg = Math.round((Number(pest.stockKg) || 0) * 10) / 10;
    const fullBags = Math.floor(totalKg / unitKg + 1e-6);
    const remKg = Math.round((totalKg - fullBags * unitKg) * 10) / 10;
    const detail = remKg > 0 ? `${fullBags}袋＋端数${remKg}kg` : `${fullBags}袋`;
    return { totalLabel: `${totalKg.toLocaleString()} kg`, detailLabel: detail, isLow: totalKg < unitKg * 2 };
  }
  const unitMl = pest.unitSizeMl;
  const totalMl = Math.round(Number(pest.stockMl) || 0);
  const fullBottles = Math.floor(totalMl / unitMl);
  const remMl = totalMl - fullBottles * unitMl;
  const detail = remMl > 0 ? `${fullBottles}本＋端数${remMl}mL` : `${fullBottles}本分`;
  return { totalLabel: `${totalMl.toLocaleString()} mL`, detailLabel: detail, isLow: totalMl < unitMl * 2 };
}

/**
 * 農薬の規格単位（液剤mL vs 粒剤kg）に応じて消費数量・端数消費量を算出する（M-9・Phase2対応）
 */
function calcPesticideUnitQty(pest, totalAreaA, totalChemMl) {
  if (!pest) {
    const neededMl = Math.round(Math.max(0, Number(totalChemMl) || 0));
    const qtyFloat = neededMl / 500;
    return { isLiquid: true, qty: Math.max(1, Math.ceil(qtyFloat)), qtyFloat, unitLabel: '本', neededMl, neededKg: 0, unitSizeMl: 500, unitSizeKg: 3 };
  }
  ensurePesticideInventoryFields_(pest);
  if (pest.formulation === 'granule') {
    const bagKg = pest.unitSizeKg;
    const rateKgPer10a = pest.rateKgPer10a;
    const neededKg = Math.round(((Math.max(0, Number(totalAreaA) || 0) / 10) * rateKgPer10a) * 10) / 10;
    const qtyFloat = neededKg / bagKg;
    return {
      isLiquid: false,
      qty: Math.max(1, Math.ceil(qtyFloat)),
      qtyFloat,
      unitLabel: '袋',
      neededMl: 0,
      neededKg,
      unitSizeMl: 0,
      unitSizeKg: bagKg
    };
  }
  const bottleMl = pest.unitSizeMl;
  const neededMl = Math.round(Math.max(0, Number(totalChemMl) || 0));
  const qtyFloat = neededMl / bottleMl;
  return {
    isLiquid: true,
    qty: Math.max(1, Math.ceil(qtyFloat)),
    qtyFloat,
    unitLabel: '本',
    neededMl,
    neededKg: 0,
    unitSizeMl: bottleMl,
    unitSizeKg: 0
  };
}

// =========================================================================
// ① 水稲「出穂後積算温度（1,000℃）」＆ 刈取適期予測エンジン（M-3対応：当日・作業日＆日誌実測気温連動）
// =========================================================================
function calcAccumulatedTempStats(field, refDateStr) {
  const headingStr = dateKey_(field.headingDate || '2026/08/08');
  const targetC = Number(field.targetTempC) || (String(field.crop || '').includes('つきあかり') ? 950 : 1000);
  const defaultDailyMean = Number(field.dailyMeanTempC) || (field.group === 'yama' ? 23.2 : 25.5);

  const headMs = new Date(headingStr.replace(/\//g, '-')).setHours(0, 0, 0, 0);
  const uiDateStr = (typeof document !== 'undefined' && document.getElementById('workDateInput')?.value) || '';
  let baseStr = refDateStr || uiDateStr || getTodayIsoDate();

  // オフシーズン（収穫予定日を大幅に過ぎた10月以降など）に閲覧した場合は収穫予定日または直近作業日を基準にキャップ
  const harvStr = dateKey_(field.harvest || '2026/09/20');
  const harvMs = new Date(harvStr.replace(/\//g, '-')).setHours(0, 0, 0, 0);
  let baseMs = new Date(String(baseStr).replace(/\//g, '-')).setHours(0, 0, 0, 0);
  if (!refDateStr && !isNaN(harvMs) && !isNaN(baseMs) && baseMs > harvMs + 10 * 86400000) {
    baseMs = harvMs;
  }

  let elapsedDays = 0;
  if (!isNaN(headMs) && !isNaN(baseMs)) {
    elapsedDays = Math.max(0, Math.floor((baseMs - headMs) / (1000 * 60 * 60 * 24)));
  }

  // 出穂日〜基準日の間に記録された作業日誌の気温（tempC）があれば実測値として反映
  const recordedTempByDate = {};
  (workLogs || []).forEach(l => {
    if (!l || l.tempC === undefined || l.tempC === '') return;
    if (Array.isArray(l.fieldIds) && l.fieldIds.includes(field.id)) {
      const dk = dateKey_(l.date);
      const lMs = new Date(dk.replace(/\//g, '-')).setHours(0, 0, 0, 0);
      if (!isNaN(lMs) && lMs >= headMs && lMs <= baseMs) {
        recordedTempByDate[dk] = Number(l.tempC);
      }
    }
  });
  const recordedDays = Object.keys(recordedTempByDate).length;
  const recordedSumC = Object.values(recordedTempByDate).reduce((s, v) => s + v, 0);
  const unrecordedDays = Math.max(0, elapsedDays - recordedDays);
  const accumulatedC = Math.round(recordedSumC + unrecordedDays * defaultDailyMean);
  const effectiveMean = elapsedDays > 0 ? Math.round((accumulatedC / elapsedDays) * 10) / 10 : defaultDailyMean;

  const pct = Math.min(100, Math.round((accumulatedC / targetC) * 100));
  const remainC = Math.max(0, targetC - accumulatedC);
  const remainDays = Math.ceil(remainC / effectiveMean);

  const totalDaysNeeded = Math.ceil(targetC / effectiveMean);
  let predictedDateStr = field.harvest || '2026/09/20';
  if (!isNaN(headMs)) {
    const predDate = new Date(headMs + totalDaysNeeded * 24 * 60 * 60 * 1000);
    predictedDateStr = `${predDate.getFullYear()}/${String(predDate.getMonth() + 1).padStart(2, '0')}/${String(predDate.getDate()).padStart(2, '0')}`;
  }

  let statusLabel = '登熟中';
  let statusColor = '#f59e0b'; // amber
  if (accumulatedC >= targetC + 100) {
    statusLabel = '刈遅れ注意';
    statusColor = '#ef4444'; // red
  } else if (accumulatedC >= targetC - 50) {
    statusLabel = '刈取適期';
    statusColor = '#10b981'; // emerald
  } else if (accumulatedC < 400) {
    statusLabel = '出穂・登熟初期';
    statusColor = '#0284c7'; // sky
  }

  return {
    headingDate: headingStr,
    targetC,
    dailyMean: effectiveMean,
    meanTemp: effectiveMean,
    elapsedDays,
    accumulatedC,
    pct,
    progressPct: pct,
    remainC,
    remainDays,
    remainingDays: remainDays,
    predictedDateStr,
    predictedHarvestDate: predictedDateStr,
    statusLabel,
    statusColor
  };
}

// =========================================================================
// ④ 圃場別「原価（資材・労務・機械）・売上・粗利益」自動試算エンジン
// =========================================================================
function calcFieldProfitability(field) {
  const wage = Number(costSettings.hourlyWageYen) || 1500;
  const ricePrice = Number(costSettings.ricePricePerTawaraYen) || 18500;
  const fLogs = workLogs.filter(l => (l.fieldIds || []).includes(field.id));

  let cumHr = 0;
  let fertCostYen = 0;
  let pestCostYen = 0;
  let machineCostYen = 0;

  fLogs.forEach(l => {
    const ratio = logAreaRatio_(l, field);
    const allocHr = (Number(l.duration) || 0) * ratio;
    cumHr += allocHr;

    if (l.machineId) {
      const mObj = machines[l.machineId] || DEFAULT_STATE.machines[l.machineId];
      const mRate = Number(l.machineHourlyCostYen || mObj?.hourlyCostYen) || 2000;
      machineCostYen += allocHr * mRate;
    }

    if (l.type === 'fertilizer') {
      const fertObj = fertilizers[l.materialId] || DEFAULT_STATE.fertilizers[l.materialId];
      const bagPrice = Number(l.unitPriceYen || fertObj?.priceYen) || 2450;
      const unitKg = Number(fertObj?.unitKg) || 20;
      const bags = Number(l.inputQty) || ((Number(l.totalKg) || 0) / unitKg);
      fertCostYen += bags * bagPrice * ratio;
    } else if (l.type === 'pesticide') {
      const pids = getLogPesticideIds(l);
      const qtyMap = l.stockDeductedByMap || {};
      const usedMlMap = l.usedMlByMap || {};
      const usedKgMap = l.usedKgByMap || {};
      const priceMap = l.unitPriceByMap || {};
      pids.forEach(pid => {
        const pObj = pesticides[pid] || DEFAULT_STATE.pesticides[pid];
        let unitQty = Number(qtyMap[pid] || l.inputQty) || 1;
        if (usedMlMap[pid] !== undefined && Number(usedMlMap[pid]) > 0) {
          const uMl = Number(pObj?.unitSizeMl) || 500;
          unitQty = Number(usedMlMap[pid]) / uMl;
        } else if (usedKgMap[pid] !== undefined && Number(usedKgMap[pid]) > 0) {
          const uKg = Number(pObj?.unitSizeKg) || 3;
          unitQty = Number(usedKgMap[pid]) / uKg;
        }
        const unitPrice = Number(priceMap[pid] || pObj?.priceYen) || 3000;
        pestCostYen += unitQty * unitPrice * ratio;
      });
    }
  });

  // 初期ベースライン分の施肥・防除がある場合の概算補完
  const b = field.baseline || {};
  if ((b.nPer10a || 0) > 0) {
    fertCostYen += (b.nPer10a / 2.8) * (field.area / 10) * 2450;
  }
  Object.entries(b.pestCount || {}).forEach(([pid, cnt]) => {
    if (cnt > 0) {
      const pObj = pesticides[pid];
      pestCostYen += cnt * (field.area / 50) * (Number(pObj?.priceYen) || 3000);
    }
  });

  const laborCostYen = Math.round(cumHr * wage);
  const roundedMachineCostYen = Math.round(machineCostYen);
  const totalCostYen = Math.round(fertCostYen + pestCostYen + laborCostYen + roundedMachineCostYen);

  const defaultYieldTawara10a = field.yieldTawara10a || (field.nPer10a > 0 ? 9.0 : 8.0);
  const harvKg = field.harvestKg || Math.round(defaultYieldTawara10a * 60 * (field.area / 10));
  const wasteRiceKg = Math.max(0, Number(field.wasteRiceKg) || 0);
  const wasteRatePct = (harvKg + wasteRiceKg) > 0
    ? Math.round((wasteRiceKg / (harvKg + wasteRiceKg)) * 1000) / 10
    : 0;
  const wastePricePerKg = Math.max(0, Number(costSettings?.wasteRicePricePerKgYen ?? 50));
  const totalTawara = harvKg / 60;
  const riceRevenueYen = Math.round(totalTawara * ricePrice);
  const wasteRevenueYen = Math.round(wasteRiceKg * wastePricePerKg);
  const revenueYen = riceRevenueYen + wasteRevenueYen;
  const profitYen = revenueYen - totalCostYen;
  const profitPer10aYen = field.area > 0 ? Math.round(profitYen / (field.area / 10)) : 0;

  let rank = 'B (標準)';
  let rankColor = '#0284c7';
  if (profitPer10aYen >= 120000) {
    rank = 'S (高収益)';
    rankColor = '#059669';
  } else if (profitPer10aYen >= 95000) {
    rank = 'A (優良)';
    rankColor = '#10b981';
  } else if (profitPer10aYen >= 70000) {
    rank = 'B (標準)';
    rankColor = '#0284c7';
  } else {
    rank = 'C (要改善)';
    rankColor = '#d97706';
  }

  return {
    cumHr,
    cumHours: cumHr,
    fertCostYen: Math.round(fertCostYen),
    pestCostYen: Math.round(pestCostYen),
    laborCostYen,
    machineCostYen: roundedMachineCostYen,
    laborMachineCostYen: Math.round(laborCostYen + roundedMachineCostYen),
    totalCostYen,
    harvKg,
    wasteRiceKg,
    wasteRatePct,
    wasteRevenueYen,
    defaultYieldTawara10a,
    yieldTawara10a: defaultYieldTawara10a,
    revenueYen,
    grossRevenueYen: revenueYen,
    profitYen,
    grossProfitYen: profitYen,
    profitPer10aYen,
    rank,
    profitRank: rank,
    rankColor
  };
}


// =========================================================================
// 圃場の集計値（累計NPK・農薬使用回数・有効成分別回数・進捗・収量）を作業履歴から再計算
// =========================================================================
function makeEmptyBaseline() {
  return {
    nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: {}, doneCats: [], stage: '未着手',
    harvestKg: 0, wasteRiceKg: 0, yieldTawara10a: 0, grade: '',
    moisture: null, tasteScore: null, protein: null, amylose: null, wholeGrainRate: null, fattyAcid: null
  };
}


function ensureFieldBaselines() {
  fieldsData.forEach(f => {
    if (f.baseline) return;
    const logs = workLogs.filter(l => (l.fieldIds || []).includes(f.id));
    const b = makeEmptyBaseline();
    let n = 0, p = 0, k = 0, harvKg = 0, wasteKg = 0;
    const pestCnt = {};
    logs.forEach(l => {
      if (l.type === 'fertilizer') {
        n += Number(l.n10a) || 0;
        p += Number(l.p10a) || 0;
        k += Number(l.k10a) || 0;
      } else if (l.type === 'pesticide') {
        getLogPesticideIds(l).forEach(pid => {
          pestCnt[pid] = (pestCnt[pid] || 0) + 1;
        });
      } else if (l.type === 'harvest') {
        const ratio = logAreaRatio_(l, f);
        harvKg += Math.round((Number(l.totalKg) || 0) * ratio);
        wasteKg += Math.round((Number(l.wasteRiceKg) || 0) * ratio);
      }
    });
    b.nPer10a = Math.max(0, Math.round(((f.nPer10a || 0) - n) * 100) / 100);
    b.pPer10a = Math.max(0, Math.round(((f.pPer10a || 0) - p) * 100) / 100);
    b.kPer10a = Math.max(0, Math.round(((f.kPer10a || 0) - k) * 100) / 100);
    Object.entries(f.pestCount || {}).forEach(([pid, cnt]) => {
      b.pestCount[pid] = Math.max(0, (cnt || 0) - (pestCnt[pid] || 0));
    });
    const logCats = new Set(logs.map(l => l.cat));
    b.doneCats = (f.doneCats || []).filter(c => !logCats.has(c));
    b.stage = logs.length > 0 ? (b.doneCats.length > 0 ? `${b.doneCats[b.doneCats.length - 1]}済` : '未着手') : (f.stage || '未着手');
    b.harvestKg = Math.max(0, (f.harvestKg || 0) - harvKg);
    b.wasteRiceKg = Math.max(0, (f.wasteRiceKg || 0) - wasteKg);
    b.yieldTawara10a = harvKg > 0 ? 0 : (f.yieldTawara10a || 0);
    b.grade = harvKg > 0 ? '' : (f.grade || '');
    f.baseline = b;
  });
}

function recalculateFieldStats() {
  fieldsData.forEach(f => {
    const b = f.baseline || makeEmptyBaseline();
    let n = b.nPer10a, p = b.pPer10a, k = b.kPer10a;
    const pestCount = { ...b.pestCount };
    const doneCats = [...b.doneCats];
    let stage = b.stage;
    let harvestKg = b.harvestKg;
    let wasteRiceKg = b.wasteRiceKg || 0;
    let yieldTawara10a = b.yieldTawara10a;
    let grade = b.grade;
    let moisture = b.moisture ?? null;
    let tasteScore = b.tasteScore ?? null;
    let protein = b.protein ?? null;
    let amylose = b.amylose ?? null;
    let wholeGrainRate = b.wholeGrainRate ?? null;
    let fattyAcid = b.fattyAcid ?? null;

    const logs = workLogs
      .map((l, idx) => ({ l, idx }))
      .filter(x => (x.l.fieldIds || []).includes(f.id))
      .sort((a, b2) => dateKey_(a.l.date).localeCompare(dateKey_(b2.l.date)) || (b2.idx - a.idx))
      .map(x => x.l);

    const logIngredientFallback = {};
    logs.forEach(l => {
      if (l.type === 'fertilizer') {
        n += Number(l.n10a) || 0;
        p += Number(l.p10a) || 0;
        k += Number(l.k10a) || 0;
      } else if (l.type === 'pesticide') {
        if (l.activeIngredientByMap && typeof l.activeIngredientByMap === 'object') {
          Object.assign(logIngredientFallback, l.activeIngredientByMap);
        }
        getLogPesticideIds(l).forEach(pid => {
          pestCount[pid] = (pestCount[pid] || 0) + 1;
        });
      } else if (l.type === 'harvest') {
        const ratio = logAreaRatio_(l, f);
        harvestKg += Math.round((Number(l.totalKg) || 0) * ratio);
        wasteRiceKg += Math.round((Number(l.wasteRiceKg) || 0) * ratio);
        if (l.yieldTawara10a !== undefined) yieldTawara10a = Number(l.yieldTawara10a);
        if (l.grade) grade = l.grade;
        if (l.moisture !== undefined && l.moisture !== null && l.moisture !== '') moisture = Number(l.moisture);
        if (l.tasteScore !== undefined && l.tasteScore !== null && l.tasteScore !== '') tasteScore = Number(l.tasteScore);
        if (l.protein !== undefined && l.protein !== null && l.protein !== '') protein = Number(l.protein);
        if (l.amylose !== undefined && l.amylose !== null && l.amylose !== '') amylose = Number(l.amylose);
        if (l.wholeGrainRate !== undefined && l.wholeGrainRate !== null && l.wholeGrainRate !== '') wholeGrainRate = Number(l.wholeGrainRate);
        if (l.fattyAcid !== undefined && l.fattyAcid !== null && l.fattyAcid !== '') fattyAcid = Number(l.fattyAcid);
      }
      if (l.cat && !doneCats.includes(l.cat)) doneCats.push(l.cat);
      if (l.cat) stage = `${l.cat}済`;
    });

    const ingredientCount = {};
    Object.entries(pestCount).forEach(([pid, count]) => {
      if (!count || count <= 0) return;
      const pObj = pesticides[pid] || DEFAULT_STATE.pesticides[pid];
      const ing = (pObj && pObj.activeIngredient) ? pObj.activeIngredient : (logIngredientFallback[pid] || pid);
      ingredientCount[ing] = (ingredientCount[ing] || 0) + count;
    });

    f.nPer10a = Math.round(n * 100) / 100;
    f.pPer10a = Math.round(p * 100) / 100;
    f.kPer10a = Math.round(k * 100) / 100;
    f.pestCount = pestCount;
    f.ingredientCount = ingredientCount;
    f.doneCats = doneCats;
    f.stage = stage;
    f.harvestKg = harvestKg;
    f.wasteRiceKg = wasteRiceKg;
    f.yieldTawara10a = yieldTawara10a;
    f.grade = grade;
    f.moisture = moisture;
    f.tasteScore = tasteScore;
    f.protein = protein;
    f.amylose = amylose;
    f.wholeGrainRate = wholeGrainRate;
    f.fattyAcid = fattyAcid;
  });
}
