/**
 * ============================================================================
 * らくらく営農日誌 Next — データモデル・初期状態・永続化・再計算エンジン (js/data.js)
 * ============================================================================
 */

const STORAGE_KEY = 'rakuraku_einou_next_pwa_state_v1';

// 初期デフォルトデータ定義（空の初期状態）
const DEFAULT_STATE = {
  fieldsData: [],
  fertilizers: {},
  pesticides: {},
  machines: {},
  costSettings: {
    hourlyWageYen: 1500,
    ricePricePerTawaraYen: 18500,
    wasteRicePricePerKgYen: 50
  },
  workLogs: [],
  gasWebhookUrl: ''
};

const MIGRATION_SAMPLES = {
  agrinote: `ほ場ID,ほ場名,グループ名,地番・住所,面積(㎡),作付名,品種名,収穫予定日,緯度,経度
AGN-101,⑧ アグリ下新田1号,本場エリア,大字下新田 201-1,2800,水稲,コシヒカリ (BL),2026/09/22,37.9165,139.0370
AGN-102,⑨ アグリ下新田2号,本場エリア,大字下新田 201-2,3200,水稲,コシヒカリ (BL),2026/09/22,37.9168,139.0372
AGN-103,⑩ アグリ山間棚田,上山田飛び地,上山田字沢 110,1400,水稲,つきあかり,2026/09/15,37.9220,139.0490`,
  ksas: `作業日,作業項目,作業担当者,圃場名称,登録面積(ha),作業時間(h),使用機械名,使用資材名,使用量(kg),成分N(%),成分P(%),成分K(%)
2026/10/20,耕起,佐藤 健一,① 本場1号・② 本場2号,0.50,1.5,ヤンマー トラクター YT357,-,0,0,0,0
2026/10/25,施肥,佐藤 健一,④ 川向4号,0.35,1.0,ヤンマー トラクター YT357,くみあい苦土入り複合オール14,70,14,14,14`,
  emaff: JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { polygon_id: 'EMAFF-01', name: '⑪ eMAFF北沢1号', address: '大字北沢 55-1', area_m2: 2400, crop: 'コシヒカリ (BL)' },
        geometry: { type: 'Polygon', coordinates: [[[139.0380, 37.9180], [139.0388, 37.9181], [139.0386, 37.9186], [139.0379, 37.9185]]] }
      },
      {
        type: 'Feature',
        properties: { polygon_id: 'EMAFF-02', name: '⑫ eMAFF北沢2号', address: '大字北沢 56-3', area_m2: 1900, crop: 'つきあかり' },
        geometry: { type: 'Polygon', coordinates: [[[139.0390, 37.9180], [139.0397, 37.9182], [139.0395, 37.9187], [139.0389, 37.9185]]] }
      }
    ]
  }, null, 2)
};

// アプリ状態変数
let fieldsData = [];
let fertilizers = {};
let pesticides = {};
let machines = {};
let costSettings = { hourlyWageYen: 1500, ricePricePerTawaraYen: 18500, wasteRicePricePerKgYen: 50 };
let workLogs = [];
let gasWebhookUrl = '';
// GAS doPost 認証用の共有トークン（スクリプトプロパティ SYNC_TOKEN と一致させる）
// ※ JSONバックアップには含めない（バックアップファイル共有時の漏えい防止）
let gasSyncToken = '';

// 現在のUI状態
let selectedFieldIds = [];
let currentWorkCat = '施肥';
let currentDuration = 2.0;
let currentBags = 10;
let currentHarvestBags = 180;
let isOfflineMode = false;
let currentHeatmapLayer = 'all';
let currentInspectedFieldId = '';
let editingLogId = null;
let pendingMigrationItems = [];
let pendingMigrationMode = 'fields';

// =========================================================================
// 共通ユーティリティ
// =========================================================================
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateNextId(prefix, existingIds) {
  const re = new RegExp('^' + prefix + '(\\d+)$');
  let maxNum = 0;
  (existingIds || []).forEach(id => {
    const m = String(id).match(re);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return prefix + String(maxNum + 1).padStart(2, '0');
}

function parseDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cur.trim());
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur.trim());
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur.trim());
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c !== ''));
}

function toCsvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function getTodayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Googleマップの共有URLや「37.9161, 139.0364」形式の文字列から緯度・経度を抽出する
 */
function parseGoogleMapsCoords(inputStr) {
  const s = String(inputStr || '').trim();
  if (!s) return null;
  // 1. !3d37.9161!4d139.0364 形式（ピン座標）
  const bangMatch = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bangMatch) {
    return { lat: parseFloat(bangMatch[1]), lng: parseFloat(bangMatch[2]) };
  }
  // 2. @37.9161,139.0364 または q=37.9161,139.0364 または ll=37.9161,139.0364 または 生の座標ペア
  const pairMatch = s.match(/(-?\d{2}\.\d{3,})\s*,\s*(-?\d{2,3}\.\d{3,})/);
  if (pairMatch) {
    const lat = parseFloat(pairMatch[1]);
    const lng = parseFloat(pairMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

/**
 * ポリゴン頂点配列 [[lng, lat], ...] から面積(㎡・a)および重心座標を算出する（平面直角近似・Shoelace公式）
 */
function calcPolygonAreaStats(lngLatPts) {
  if (!Array.isArray(lngLatPts) || lngLatPts.length < 3) {
    const first = Array.isArray(lngLatPts) && lngLatPts[0] ? lngLatPts[0] : [139.0364, 37.9161];
    return { areaM2: 0, areaA: 0, centerLat: Number(first[1]) || 37.9161, centerLng: Number(first[0]) || 139.0364 };
  }
  const n = lngLatPts.length;
  const centerLng = lngLatPts.reduce((s, p) => s + Number(p[0]), 0) / n;
  const centerLat = lngLatPts.reduce((s, p) => s + Number(p[1]), 0) / n;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;

  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const p1 = lngLatPts[i];
    const p2 = lngLatPts[(i + 1) % n];
    const x1 = (Number(p1[0]) - centerLng) * mPerDegLng;
    const y1 = (Number(p1[1]) - centerLat) * mPerDegLat;
    const x2 = (Number(p2[0]) - centerLng) * mPerDegLng;
    const y2 = (Number(p2[1]) - centerLat) * mPerDegLat;
    twiceArea += (x1 * y2 - x2 * y1);
  }
  const areaM2 = Math.round(Math.abs(twiceArea) / 2);
  const areaA = Math.max(1, Math.round(areaM2 / 100));
  return { areaM2, areaA, centerLat, centerLng };
}

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

// =========================================================================
// 圃場の集計値（累計NPK・農薬使用回数・有効成分別回数・進捗・収量）を作業履歴から再計算
// =========================================================================
function makeEmptyBaseline() {
  return { nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: {}, doneCats: [], stage: '未着手', harvestKg: 0, wasteRiceKg: 0, yieldTawara10a: 0, grade: '' };
}

/**
 * 作業ログの気象情報（天候・気温・降水量・風向・風速）を読みやすい文字列に整形する
 */
function formatWeatherSummary_(log) {
  if (!log) return '☀️ 晴れ';
  const base = log.weather || '☀️ 晴れ';
  const parts = [];
  if (log.tempC !== undefined && log.tempC !== '') parts.push(`${log.tempC}℃`);
  if (log.rainfallMm !== undefined && Number(log.rainfallMm) > 0) parts.push(`降水${log.rainfallMm}mm`);
  if (log.windDir || (log.windSpeedMs !== undefined && log.windSpeedMs !== '')) {
    const dir = log.windDir && log.windDir !== '静穏' ? `${log.windDir} ` : '';
    const spd = (log.windSpeedMs !== undefined && log.windSpeedMs !== '') ? `${log.windSpeedMs}m/s` : '';
    const windStr = `${dir}${spd}`.trim();
    if (windStr) parts.push(`風:${windStr}`);
  }
  return parts.length > 0 ? `${base} (${parts.join(' / ')})` : base;
}

function logAreaRatio_(log, field) {
  const total = Number(log.totalArea) || 0;
  return total > 0 ? (field.area / total) : 0;
}

/**
 * 日付文字列（例: "2026/5/1", "2026-5-1", "2026/05/01"）をゼロ埋め "YYYY/MM/DD" に正規化する（M-11対応）
 */
function dateKey_(d) {
  const raw = String(d || '').trim().replace(/-/g, '/');
  const m = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  }
  return raw;
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
  });
}
