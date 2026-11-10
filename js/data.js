/**
 * ============================================================================
 * らくらく営農日誌 Next — データモデル・初期状態・永続化・再計算エンジン (js/data.js)
 * ============================================================================
 */

const STORAGE_KEY = 'rakuraku_einou_next_pwa_state_v1';

// 初期デフォルトデータ定義
const DEFAULT_STATE = {
  fieldsData: [
    { id: 'F01', name: '① 本場1号', lot: '大字下新田 102-1', group: 'gps', area: 30, crop: 'コシヒカリ (BL)', harvest: '2026/09/20', stage: '施肥済', lat: 37.9161, lng: 139.0364, doneCats: ['耕起', '草刈り', '施肥'], nPer10a: 2.8, pPer10a: 2.8, kPer10a: 2.8, pestCount: { P01: 1, P02: 1, P03: 2 } },
    { id: 'F02', name: '② 本場2号', lot: '大字下新田 102-2', group: 'gps', area: 20, crop: 'コシヒカリ (BL)', harvest: '2026/09/20', stage: '施肥済', lat: 37.9163, lng: 139.0368, doneCats: ['耕起', '草刈り', '施肥'], nPer10a: 2.8, pPer10a: 2.8, kPer10a: 2.8, pestCount: { P01: 1, P02: 0, P03: 1 } },
    { id: 'F03', name: '③ 本場3号・大町', lot: '大字下新田 105', group: 'gps', area: 50, crop: 'コシヒカリ (BL)', harvest: '2026/09/20', stage: '施肥済', lat: 37.9158, lng: 139.0365, doneCats: ['耕起', '草刈り', '施肥'], nPer10a: 2.8, pPer10a: 2.8, kPer10a: 2.8, pestCount: { P01: 1, P02: 1, P03: 2 } },
    { id: 'F04', name: '④ 川向4号', lot: '大字川向 44-1', group: 'river', area: 35, crop: 'つきあかり', harvest: '2026/09/10', stage: '耕起済', lat: 37.9145, lng: 139.0355, doneCats: ['耕起', '草刈り'], nPer10a: 1.4, pPer10a: 1.4, kPer10a: 1.4, pestCount: { P01: 0, P02: 0, P03: 0 } },
    { id: 'F05', name: '⑤ 上山田A(飛び地)', lot: '上山田字沢 88-1', group: 'yama', area: 15, crop: 'コシヒカリ (BL)', harvest: '2026/09/28', stage: '未着手', lat: 37.9210, lng: 139.0480, doneCats: [], nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: { P01: 0, P02: 0, P03: 0 } },
    { id: 'F06', name: '⑥ 上山田B(飛び地)', lot: '上山田字沢 89-3', group: 'yama', area: 18, crop: 'コシヒカリ (BL)', harvest: '2026/09/28', stage: '未着手', lat: 37.9215, lng: 139.0488, doneCats: [], nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: { P01: 0, P02: 0, P03: 0 } },
    { id: 'F07', name: '⑦ 上山田棚田C', lot: '上山田字峯 12-1', group: 'yama', area: 22, crop: 'コシヒカリ (BL)', harvest: '2026/09/28', stage: '草刈り済', lat: 37.9202, lng: 139.0475, doneCats: ['草刈り'], nPer10a: 0, pPer10a: 0, kPer10a: 0, pestCount: { P01: 0, P02: 0, P03: 0 } }
  ],
  fertilizers: {
    F01: { id: 'F01', name: 'くみあい苦土入り複合オール14', unitKg: 20, n: 14, p: 14, k: 14, stock: 45, minStock: 15 },
    F02: { id: 'F02', name: '水稲一発基肥コートL80', unitKg: 20, n: 24, p: 10, k: 12, stock: 30, minStock: 10 },
    F03: { id: 'F03', name: 'NK化成2号（穂肥用）', unitKg: 20, n: 17, p: 0, k: 17, stock: 12, minStock: 15 }
  },
  pesticides: {
    P01: { id: 'P01', name: 'アミスターフロアブル', regNo: '第20142号', activeIngredient: 'アゾキシストロビン', maxUse: 2, phiDays: 14, stock: 18, unit: '本(500mL)' },
    P02: { id: 'P02', name: 'スタークル液剤10', regNo: '第21993号', activeIngredient: 'ジノテフラン', maxUse: 3, phiDays: 7, stock: 24, unit: '本(500mL)' },
    P03: { id: 'P03', name: 'ビームゾル', regNo: '第14201号', activeIngredient: 'トリシクラゾール', maxUse: 2, phiDays: 21, stock: 6, unit: '本(500mL)' },
    P04: { id: 'P04', name: 'スタークル粒剤（同一成分別剤）', regNo: '第21992号', activeIngredient: 'ジノテフラン', maxUse: 3, phiDays: 14, stock: 15, unit: '袋(3kg)' }
  },
  machines: {
    M01: { id: 'M01', name: 'ヤンマー トラクター YT357', cat: 'トラクター', currentHour: 248.0, nextMaint: 300.0, interval: 100.0 },
    M02: { id: 'M02', name: 'クボタ 乗用草刈機 RM983', cat: '乗用モア', currentHour: 96.5, nextMaint: 100.0, interval: 50.0 },
    M03: { id: 'M03', name: '農業用ドローン DJI Agras T30', cat: 'ドローン', currentHour: 42.0, nextMaint: 60.0, interval: 30.0 },
    M04: { id: 'M04', name: 'クボタ 田植機 NW8S', cat: '田植機', currentHour: 115.0, nextMaint: 150.0, interval: 50.0 }
  },
  workLogs: [
    {
      id: 'WL-20260425-01',
      date: '2026/04/25',
      cat: '草刈り',
      worker: '佐藤 健一',
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
let workLogs = [];
let gasWebhookUrl = '';

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
// LocalStorage 永続化エンジン
// =========================================================================
function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      fieldsData = parsed.fieldsData || JSON.parse(JSON.stringify(DEFAULT_STATE.fieldsData));
      fertilizers = parsed.fertilizers || JSON.parse(JSON.stringify(DEFAULT_STATE.fertilizers));
      pesticides = {
        ...JSON.parse(JSON.stringify(DEFAULT_STATE.pesticides)),
        ...(parsed.pesticides || {})
      };
      // 既存保存データに activeIngredient が欠けている場合はデフォルトから補完
      Object.keys(pesticides).forEach(pid => {
        if (!pesticides[pid].activeIngredient && DEFAULT_STATE.pesticides[pid]) {
          pesticides[pid].activeIngredient = DEFAULT_STATE.pesticides[pid].activeIngredient;
        }
      });
      machines = parsed.machines || JSON.parse(JSON.stringify(DEFAULT_STATE.machines));
      workLogs = parsed.workLogs || JSON.parse(JSON.stringify(DEFAULT_STATE.workLogs));
      gasWebhookUrl = parsed.gasWebhookUrl || '';
      return;
    }
  } catch (e) {}
  const def = JSON.parse(JSON.stringify(DEFAULT_STATE));
  fieldsData = def.fieldsData;
  fertilizers = def.fertilizers;
  pesticides = def.pesticides;
  machines = def.machines;
  workLogs = def.workLogs;
  gasWebhookUrl = def.gasWebhookUrl;
}

function saveStateToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fieldsData,
      fertilizers,
      pesticides,
      machines,
      workLogs,
      gasWebhookUrl
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

    // 有効成分（activeIngredient）単位での累積使用回数を集計
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
