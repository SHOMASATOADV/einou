/**
 * ============================================================================
 * らくらく営農日誌 Next — データモデル・初期状態・永続化・再計算エンジン (js/data.js)
 * ============================================================================
 */

const STORAGE_KEY = 'rakuraku_einou_next_pwa_state_v1';

// 初期デフォルトデータ定義
const DEFAULT_STATE = {
  fieldsData: [
    { id: 'F01', name: '① 本場1号', lot: '大字下新田 102-1', group: 'gps', area: 30, crop: 'コシヒカリ (BL)', headingDate: '2026/08/08', targetTempC: 1000, dailyMeanTempC: 25.5, harvest: '2026/09/20', stage: '施肥済', lat: 37.9161, lng: 139.0364, doneCats: ['耕起', '草刈り', '施肥'], nPer10a: 2.8, pPer10a: 2.8, kPer10a: 2.8, pestCount: { P01: 1, P02: 1, P03: 2 }, alerts: [] },
    { id: 'F02', name: '② 本場2号', lot: '大字下新田 102-2', group: 'gps', area: 20, crop: 'コシヒカリ (BL)', headingDate: '2026/08/08', targetTempC: 1000, dailyMeanTempC: 25.5, harvest: '2026/09/20', stage: '施肥済', lat: 37.9163, lng: 139.0368, doneCats: ['耕起', '草刈り', '施肥'], nPer10a: 2.8, pPer10a: 2.8, kPer10a: 2.8, pestCount: { P01: 1, P02: 0, P03: 1 }, alerts: [] },
    { id: 'F03', name: '③ 本場3号・大町', lot: '大字下新田 105', group: 'gps', area: 50, crop: 'コシヒカリ (BL)', headingDate: '2026/08/08', targetTempC: 1000, dailyMeanTempC: 25.5, harvest: '2026/09/20', stage: '施肥済', lat: 37.9158, lng: 139.0365, doneCats: ['耕起', '草刈り', '施肥'], nPer10a: 2.8, pPer10a: 2.8, kPer10a: 2.8, pestCount: { P01: 1, P02: 1, P03: 2 }, alerts: [] },
    { id: 'F04', name: '④ 川向4号', lot: '大字川向 44-1', group: 'river', area: 35, crop: 'つきあかり', headingDate: '2026/07/30', targetTempC: 950, dailyMeanTempC: 25.8, harvest: '2026/09/10', stage: '耕起済', lat: 37.9145, lng: 139.0355, doneCats: ['耕起', '草刈り'], nPer10a: 1.4, pPer10a: 1.4, kPer10a: 1.4, pestCount: { P01: 0, P02: 0, P03: 0 }, alerts: [] },
    { id: 'F05', name: '⑤ 上山田A(飛び地)', lot: '上山田字沢 88-1', group: 'yama', area: 15, crop: 'コシヒカリ (BL)', headingDate: '2026/08/14', targetTempC: 1000, dailyMeanTempC: 23.2, harvest: '2026/09/28', stage: '未着手', lat: 37.9210, lng: 139.0480, doneCats: [], nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: { P01: 0, P02: 0, P03: 0 }, alerts: [{ id: 'AL-INIT-1', text: '🐗 獣害（イノシシ畦畔掘り）', tag: '🐗 獣害（イノシシ畦畔掘り）', date: '2026/08/03' }] },
    { id: 'F06', name: '⑥ 上山田B(飛び地)', lot: '上山田字沢 89-3', group: 'yama', area: 18, crop: 'コシヒカリ (BL)', headingDate: '2026/08/14', targetTempC: 1000, dailyMeanTempC: 23.2, harvest: '2026/09/28', stage: '未着手', lat: 37.9215, lng: 139.0488, doneCats: [], nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: { P01: 0, P02: 0, P03: 0 }, alerts: [] },
    { id: 'F07', name: '⑦ 上山田棚田C', lot: '上山田字峯 12-1', group: 'yama', area: 22, crop: 'コシヒカリ (BL)', headingDate: '2026/08/14', targetTempC: 1000, dailyMeanTempC: 23.2, harvest: '2026/09/28', stage: '草刈り済', lat: 37.9202, lng: 139.0475, doneCats: ['草刈り'], nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: { P01: 0, P02: 0, P03: 0 }, alerts: [{ id: 'AL-INIT-2', text: '💧 水口・畦畔水漏れ確認', tag: '💧 水口・畦畔水漏れ確認', date: '2026/08/04' }] }
  ],
  fertilizers: {
    F01: { id: 'F01', name: 'くみあい苦土入り複合オール14', unitKg: 20, n: 14, p: 14, k: 14, stock: 45, minStock: 15, priceYen: 2450 },
    F02: { id: 'F02', name: '水稲一発基肥コートL80', unitKg: 20, n: 24, p: 10, k: 12, stock: 30, minStock: 10, priceYen: 3800 },
    F03: { id: 'F03', name: 'NK化成2号（穂肥用）', unitKg: 20, n: 17, p: 0, k: 17, stock: 12, minStock: 15, priceYen: 2600 }
  },
  pesticides: {
    P01: { id: 'P01', name: 'アミスターフロアブル', regNo: '第20142号', activeIngredient: 'アゾキシストロビン', maxUse: 2, phiDays: 14, stock: 18, unit: '本(500mL)', priceYen: 3400 },
    P02: { id: 'P02', name: 'スタークル液剤10', regNo: '第21993号', activeIngredient: 'ジノテフラン', maxUse: 3, phiDays: 7, stock: 24, unit: '本(500mL)', priceYen: 2900 },
    P03: { id: 'P03', name: 'ビームゾル', regNo: '第14201号', activeIngredient: 'トリシクラゾール', maxUse: 2, phiDays: 21, stock: 6, unit: '本(500mL)', priceYen: 2800 },
    P04: { id: 'P04', name: 'スタークル粒剤（同一成分別剤）', regNo: '第21992号', activeIngredient: 'ジノテフラン', maxUse: 3, phiDays: 14, stock: 15, unit: '袋(3kg)', priceYen: 2500 }
  },
  machines: {
    M01: { id: 'M01', name: 'ヤンマー トラクター YT357', cat: 'トラクター', currentHour: 248.0, nextMaint: 300.0, interval: 100.0, hourlyCostYen: 2800 },
    M02: { id: 'M02', name: 'クボタ 乗用草刈機 RM983', cat: '乗用モア', currentHour: 96.5, nextMaint: 100.0, interval: 50.0, hourlyCostYen: 1500 },
    M03: { id: 'M03', name: '農業用ドローン DJI Agras T30', cat: 'ドローン', currentHour: 42.0, nextMaint: 60.0, interval: 30.0, hourlyCostYen: 3500 },
    M04: { id: 'M04', name: 'クボタ 田植機 NW8S', cat: '田植機', currentHour: 115.0, nextMaint: 150.0, interval: 50.0, hourlyCostYen: 2400 }
  },
  costSettings: {
    hourlyWageYen: 1500,
    ricePricePerTawaraYen: 18500
  },
  workLogs: [
    {
      id: 'WL-20260425-01',
      date: '2026/04/25',
      cat: '草刈り',
      worker: '佐藤 健一',
      weather: '☀️ 晴れ',
      tempC: 19,
      memo: '本場団地および上山田棚田Cの畦畔・法面草刈りを実施。棚田C北側の水口周辺に軽微な水漏れを確認したため次回補修予定。',
      fieldIds: ['F01', 'F02', 'F03', 'F07'],
      totalArea: 122,
      duration: 3.0,
      machineId: 'M02',
      machineName: 'クボタ 乗用草刈機 RM983',
      materialSummary: '畦畔・法面草刈り一括実施',
      type: 'general',
      synced: true
    },
    {
      id: 'WL-20260501-01',
      date: '2026/05/01',
      cat: '施肥',
      worker: '佐藤 健一',
      weather: '⛅ 曇り',
      tempC: 21,
      memo: '本場1〜3号（計100a）へ基肥散布。風が弱くブロードキャスタでの均一散布が良好。明日は代かき予定。',
      fieldIds: ['F01', 'F02', 'F03'],
      totalArea: 100,
      duration: 2.0,
      machineId: 'M01',
      machineName: 'ヤンマー トラクター YT357',
      materialId: 'F01',
      inputQty: 10,
      materialSummary: 'くみあい苦土入り複合オール14 (10袋 / 200kg)',
      type: 'fertilizer',
      fertName: 'くみあい苦土入り複合オール14',
      npkLabel: '14-14-14',
      totalKg: 200,
      per10aKg: 20.0,
      n10a: 2.80,
      p10a: 2.80,
      k10a: 2.80,
      synced: true
    },
    {
      id: 'WL-20260801-01',
      date: '2026/08/01',
      cat: '防除',
      worker: '高橋 誠（オペレーター）',
      weather: '☀️ 晴れ',
      tempC: 28,
      memo: '早朝5:30よりドローンT30で穂いもち予防散布。風速1.5m/s以下でドリフトなし。出穂は8/8頃の見込み。',
      fieldIds: ['F01', 'F02', 'F03'],
      totalArea: 100,
      duration: 1.5,
      machineId: 'M03',
      machineName: '農業用ドローン DJI Agras T30',
      materialId: 'P01',
      materialIds: ['P01'],
      inputQty: 2,
      dilutionRate: 8,
      materialSummary: 'アミスターフロアブル (8倍 / 総液量8L)',
      type: 'pesticide',
      pestName: 'アミスターフロアブル (第20142号)',
      dilution: '8倍 (ドローン)',
      waterL: 8.0,
      chemAmount: '1,000 mL',
      useCountLabel: '1回目 / 上限2回',
      safetyOk: true,
      synced: true
    }
  ],
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
let costSettings = { hourlyWageYen: 1500, ricePricePerTawaraYen: 18500 };
let workLogs = [];
let gasWebhookUrl = '';
// GAS doPost 認証用の共有トークン（スクリプトプロパティ SYNC_TOKEN と一致させる）
// ※ JSONバックアップには含めない（バックアップファイル共有時の漏えい防止）
let gasSyncToken = '';

// 現在のUI状態
let selectedFieldIds = ['F01', 'F02', 'F03'];
let currentWorkCat = '施肥';
let currentDuration = 2.0;
let currentBags = 10;
let currentHarvestBags = 180;
let isOfflineMode = false;
let currentHeatmapLayer = 'all';
let currentInspectedFieldId = 'F01';
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

// =========================================================================
// ① 水稲「出穂後積算温度（1,000℃）」＆ 刈取適期予測エンジン
// =========================================================================
function calcAccumulatedTempStats(field, refDateStr) {
  const headingStr = field.headingDate || '2026/08/08';
  const targetC = Number(field.targetTempC) || (String(field.crop || '').includes('つきあかり') ? 950 : 1000);
  const dailyMean = Number(field.dailyMeanTempC) || (field.group === 'yama' ? 23.2 : 25.5);

  const headMs = new Date(String(headingStr).replace(/\//g, '-')).setHours(0, 0, 0, 0);
  // 基準日は指定日（または収穫予定日前の9月15日基準で登熟進捗をシミュレーション）
  const baseStr = refDateStr || '2026-09-12';
  const baseMs = new Date(String(baseStr).replace(/\//g, '-')).setHours(0, 0, 0, 0);

  let elapsedDays = 0;
  if (!isNaN(headMs) && !isNaN(baseMs)) {
    elapsedDays = Math.max(0, Math.floor((baseMs - headMs) / (1000 * 60 * 60 * 24)));
  }

  const accumulatedC = Math.round(elapsedDays * dailyMean);
  const pct = Math.min(100, Math.round((accumulatedC / targetC) * 100));
  const remainC = Math.max(0, targetC - accumulatedC);
  const remainDays = Math.ceil(remainC / dailyMean);

  const totalDaysNeeded = Math.ceil(targetC / dailyMean);
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
    dailyMean,
    meanTemp: dailyMean,
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

    if (l.machineId && machines[l.machineId]) {
      const mRate = Number(machines[l.machineId].hourlyCostYen) || 2000;
      machineCostYen += allocHr * mRate;
    }

    if (l.type === 'fertilizer') {
      const fertObj = fertilizers[l.materialId] || Object.values(fertilizers)[0];
      const bagPrice = Number(fertObj?.priceYen) || 2450;
      const bags = Number(l.inputQty) || ((Number(l.totalKg) || 0) / 20);
      fertCostYen += bags * bagPrice * ratio;
    } else if (l.type === 'pesticide') {
      const pids = getLogPesticideIds(l);
      const bottles = Number(l.inputQty) || 1;
      pids.forEach(pid => {
        const pObj = pesticides[pid];
        const unitPrice = Number(pObj?.priceYen) || 3000;
        pestCostYen += bottles * unitPrice * ratio;
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
  const totalTawara = harvKg / 60;
  const revenueYen = Math.round(totalTawara * ricePrice);
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
  } catch (e) {}
  if (typeof updateSyncBadge === 'function') updateSyncBadge();
}

// =========================================================================
// 圃場の集計値（累計NPK・農薬使用回数・有効成分別回数・進捗・収量）を作業履歴から再計算
// =========================================================================
function makeEmptyBaseline() {
  return { nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: {}, doneCats: [], stage: '未着手', harvestKg: 0, yieldTawara10a: 0, grade: '' };
}

function logAreaRatio_(log, field) {
  const total = Number(log.totalArea) || 0;
  return total > 0 ? (field.area / total) : 0;
}

function dateKey_(d) {
  return String(d || '').replace(/-/g, '/');
}

function ensureFieldBaselines() {
  fieldsData.forEach(f => {
    if (f.baseline) return;
    const logs = workLogs.filter(l => (l.fieldIds || []).includes(f.id));
    const b = makeEmptyBaseline();
    let n = 0, p = 0, k = 0, harvKg = 0;
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
        harvKg += Math.round((Number(l.totalKg) || 0) * logAreaRatio_(l, f));
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
    let yieldTawara10a = b.yieldTawara10a;
    let grade = b.grade;

    const logs = workLogs
      .map((l, idx) => ({ l, idx }))
      .filter(x => (x.l.fieldIds || []).includes(f.id))
      .sort((a, b2) => dateKey_(a.l.date).localeCompare(dateKey_(b2.l.date)) || (b2.idx - a.idx))
      .map(x => x.l);

    logs.forEach(l => {
      if (l.type === 'fertilizer') {
        n += Number(l.n10a) || 0;
        p += Number(l.p10a) || 0;
        k += Number(l.k10a) || 0;
      } else if (l.type === 'pesticide') {
        getLogPesticideIds(l).forEach(pid => {
          pestCount[pid] = (pestCount[pid] || 0) + 1;
        });
      } else if (l.type === 'harvest') {
        harvestKg += Math.round((Number(l.totalKg) || 0) * logAreaRatio_(l, f));
        if (l.yieldTawara10a !== undefined) yieldTawara10a = Number(l.yieldTawara10a);
        if (l.grade) grade = l.grade;
      }
      if (l.cat && !doneCats.includes(l.cat)) doneCats.push(l.cat);
      if (l.cat) stage = `${l.cat}済`;
    });

    const ingredientCount = {};
    Object.entries(pestCount).forEach(([pid, count]) => {
      if (!count || count <= 0) return;
      const pObj = pesticides[pid];
      const ing = (pObj && pObj.activeIngredient) ? pObj.activeIngredient : pid;
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
    f.yieldTawara10a = yieldTawara10a;
    f.grade = grade;
  });
}
