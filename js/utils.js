// Common Utilities & Normalization Helpers (js/utils.js)
function roundTo_(value, decimals = 1) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) || 0) * factor) / factor;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rawHtml(htmlStr) {
  return { __rawHtml: String(htmlStr ?? '') };
}

function safeHtml(strings, ...values) {
  const renderVal = (val) => {
    if (val && typeof val === 'object' && typeof val.__rawHtml === 'string') return val.__rawHtml;
    if (Array.isArray(val)) return val.map(renderVal).join('');
    return escapeHtml(val);
  };
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderVal(values[i]) + strings[i + 1];
  }
  return out;
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


/**
 * 食味・品質データ（食味値・タンパク・整粒歩合・アミロース等）を読みやすい文字列に整形する
 */
function formatTasteSummary_(obj) {
  if (!obj) return '';
  const parts = [];
  if (obj.tasteScore !== undefined && obj.tasteScore !== null && obj.tasteScore !== '') parts.push(`食味${obj.tasteScore}点`);
  if (obj.protein !== undefined && obj.protein !== null && obj.protein !== '') parts.push(`タンパク${obj.protein}%`);
  if (obj.wholeGrainRate !== undefined && obj.wholeGrainRate !== null && obj.wholeGrainRate !== '') parts.push(`整粒${obj.wholeGrainRate}%`);
  if (obj.amylose !== undefined && obj.amylose !== null && obj.amylose !== '') parts.push(`アミロース${obj.amylose}%`);
  if (obj.fattyAcid !== undefined && obj.fattyAcid !== null && obj.fattyAcid !== '') parts.push(`脂肪酸度${obj.fattyAcid}`);
  return parts.join(' / ');
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

