// Feature: ドローン・スマホ撮影写真のEXIF GPS位置情報読み取り ＆ 圃場自動判別 (Pure JS / オフライン対応)

let _photoGpsItems = [];
if (typeof window !== 'undefined') {
  window._uploadedGeoPhotos = window._uploadedGeoPhotos || [];
}

/**
 * DataView から ASCII 文字列を読み取る
 */
function readExifAscii_(view, offset, length) {
  let str = '';
  const end = Math.min(view.byteLength, offset + length);
  for (let i = offset; i < end; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str.trim();
}

/**
 * DataView から EXIF RATIONAL (分子/分母 uint32) を読み取る
 */
function readExifRational_(view, offset, littleEndian) {
  if (offset + 8 > view.byteLength) return null;
  const num = view.getUint32(offset, littleEndian);
  const den = view.getUint32(offset + 4, littleEndian);
  if (!den) return null;
  return num / den;
}

/**
 * IFD エントリ群を読み取り、タグ番号 -> 値 のマップを返す
 */
function readIfdTags_(view, tiffStart, ifdOffset, littleEndian, targetTags) {
  const result = {};
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return result;
  const count = view.getUint16(base, littleEndian);

  for (let i = 0; i < count; i++) {
    const entryOffset = base + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (targetTags && !targetTags.has(tag)) continue;

    const type = view.getUint16(entryOffset + 2, littleEndian);
    const numValues = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffsetField = entryOffset + 8;

    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const unitSize = typeSizes[type] || 1;
    const totalBytes = numValues * unitSize;
    const dataOffset = totalBytes <= 4
      ? valueOffsetField
      : tiffStart + view.getUint32(valueOffsetField, littleEndian);

    if (dataOffset < 0 || dataOffset >= view.byteLength) continue;

    if (type === 2) {
      result[tag] = readExifAscii_(view, dataOffset, numValues);
    } else if (type === 3 && numValues === 1) {
      result[tag] = view.getUint16(dataOffset, littleEndian);
    } else if (type === 4 && numValues === 1) {
      result[tag] = view.getUint32(dataOffset, littleEndian);
    } else if (type === 1 && numValues === 1) {
      result[tag] = view.getUint8(dataOffset);
    } else if (type === 5) {
      if (numValues === 1) {
        result[tag] = readExifRational_(view, dataOffset, littleEndian);
      } else {
        const arr = [];
        for (let k = 0; k < numValues; k++) {
          arr.push(readExifRational_(view, dataOffset + k * 8, littleEndian));
        }
        result[tag] = arr;
      }
    }
  }
  return result;
}

/**
 * JPEG ArrayBuffer から EXIF GPS位置情報・撮影日時・機種名を抽出する（外部ライブラリ不要）
 */
function parseExifGpsFromBuffer(arrayBuffer) {
  const out = { hasGps: false, lat: null, lng: null, altitude: null, takenAt: '', cameraModel: '' };
  if (!arrayBuffer || arrayBuffer.byteLength < 12) return out;
  const view = new DataView(arrayBuffer);

  // JPEG SOI (0xFFD8) チェック
  if (view.getUint16(0, false) !== 0xFFD8) return out;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    if (marker === 0xFFDA || marker === 0xFFD9) break; // SOS / EOI

    const segLength = view.getUint16(offset + 2, false);
    if (segLength < 2 || offset + 2 + segLength > view.byteLength) break;

    if (marker === 0xFFE1) {
      // APP1 "Exif\0\0" 判定
      const exifHeader = readExifAscii_(view, offset + 4, 6);
      if (exifHeader === 'Exif') {
        const tiffStart = offset + 10;
        if (tiffStart + 8 > view.byteLength) return out;
        const endianMark = view.getUint16(tiffStart, false);
        const littleEndian = endianMark === 0x4949; // 'II'
        if (!littleEndian && endianMark !== 0x4D4D) return out;

        const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
        const ifd0Tags = readIfdTags_(view, tiffStart, firstIfdOffset, littleEndian, new Set([0x0110, 0x0132, 0x8769, 0x8825]));

        if (ifd0Tags[0x0110]) out.cameraModel = String(ifd0Tags[0x0110]);
        let rawDate = ifd0Tags[0x0132] ? String(ifd0Tags[0x0132]) : '';

        if (ifd0Tags[0x8769]) {
          const exifTags = readIfdTags_(view, tiffStart, ifd0Tags[0x8769], littleEndian, new Set([0x9003]));
          if (exifTags[0x9003]) rawDate = String(exifTags[0x9003]);
        }
        if (rawDate) {
          out.takenAt = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1/$2/$3').slice(0, 16);
        }

        if (ifd0Tags[0x8825]) {
          const gpsTags = readIfdTags_(view, tiffStart, ifd0Tags[0x8825], littleEndian, new Set([1, 2, 3, 4, 5, 6]));
          const latArr = gpsTags[2];
          const lngArr = gpsTags[4];
          if (Array.isArray(latArr) && latArr.length >= 3 && Array.isArray(lngArr) && lngArr.length >= 3) {
            const latVal = (Number(latArr[0]) || 0) + (Number(latArr[1]) || 0) / 60 + (Number(latArr[2]) || 0) / 3600;
            const lngVal = (Number(lngArr[0]) || 0) + (Number(lngArr[1]) || 0) / 60 + (Number(lngArr[2]) || 0) / 3600;
            if (!isNaN(latVal) && !isNaN(lngVal) && (latVal !== 0 || lngVal !== 0)) {
              const latRef = String(gpsTags[1] || 'N').toUpperCase();
              const lngRef = String(gpsTags[3] || 'E').toUpperCase();
              out.lat = (latRef === 'S' ? -1 : 1) * latVal;
              out.lng = (lngRef === 'W' ? -1 : 1) * lngVal;
              out.hasGps = true;
            }
          }
          if (typeof gpsTags[6] === 'number' && !isNaN(gpsTags[6])) {
            const altRef = gpsTags[5] === 1 ? -1 : 1;
            out.altitude = Math.round(gpsTags[6] * altRef * 10) / 10;
          }
        }
        return out;
      }
    }
    offset += 2 + segLength;
  }
  return out;
}

/**
 * Ray Casting 法によるポリゴン内外判定 (polygonLatLngs: [[lat, lng], ...])
 */
function isPointInPolygon_(lat, lng, polygonLatLngs) {
  if (!Array.isArray(polygonLatLngs) || polygonLatLngs.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygonLatLngs.length - 1; i < polygonLatLngs.length; j = i++) {
    const xi = Number(polygonLatLngs[i][0]);
    const yi = Number(polygonLatLngs[i][1]);
    const xj = Number(polygonLatLngs[j][0]);
    const yj = Number(polygonLatLngs[j][1]);

    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * GPS座標から既存圃場を自動判別する（ポリゴン内最優先 → 150m以内最近傍 → 要確認）
 */
function matchFieldByGpsCoord(lat, lng) {
  if (!Array.isArray(fieldsData) || fieldsData.length === 0) {
    return { field: null, inPolygon: false, distM: null, confidence: 'none' };
  }

  // 1. ポリゴン内判定（最優先）
  for (let i = 0; i < fieldsData.length; i++) {
    const f = fieldsData[i];
    if (typeof getFieldPolygonLatLngs_ === 'function') {
      const poly = getFieldPolygonLatLngs_(f);
      if (isPointInPolygon_(lat, lng, poly)) {
        return { field: f, inPolygon: true, distM: 0, confidence: 'high' };
      }
    }
  }

  // 2. 中心座標との直線距離による最近傍判定
  let nearest = null;
  let minDist = Infinity;
  fieldsData.forEach(f => {
    const d = getDistanceMeters(lat, lng, Number(f.lat) || 37.9161, Number(f.lng) || 139.0364);
    if (d < minDist) {
      minDist = d;
      nearest = f;
    }
  });

  if (!nearest) return { field: null, inPolygon: false, distM: null, confidence: 'none' };
  const confidence = minDist <= 150 ? 'medium' : 'low';
  return { field: nearest, inPolygon: false, distM: minDist, confidence };
}

/**
 * 選択画像の軽量サムネイル DataURL を生成（長辺160px）
 */
function createPhotoThumbnailDataUrl_(file, maxSide = 160) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve('');
      img.src = ev.target.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function openPhotoGpsModal() {
  if (typeof ModalManager !== 'undefined') {
    ModalManager.open('photoGpsModal');
  } else {
    document.getElementById('photoGpsModal')?.classList.remove('hidden');
  }
  renderPhotoGpsResults_();
}

function closePhotoGpsModal() {
  if (typeof ModalManager !== 'undefined') {
    ModalManager.close('photoGpsModal');
  } else {
    document.getElementById('photoGpsModal')?.classList.add('hidden');
  }
}

async function handlePhotoGpsFileSelect(event) {
  const files = [...(event?.target?.files || [])];
  if (files.length === 0) return;

  const statusEl = document.getElementById('photoGpsStatusBanner');
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = `⏳ ${files.length}枚の画像からEXIF GPS位置情報を解析中...`;
  }

  const parsedItems = [];
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const exif = parseExifGpsFromBuffer(buf);
    const thumbUrl = await createPhotoThumbnailDataUrl_(file);
    const match = exif.hasGps
      ? matchFieldByGpsCoord(exif.lat, exif.lng)
      : { field: null, inPolygon: false, distM: null, confidence: 'none' };

    parsedItems.push({
      id: 'PIMG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      filename: file.name,
      hasGps: exif.hasGps,
      lat: exif.lat,
      lng: exif.lng,
      altitude: exif.altitude,
      takenAt: exif.takenAt,
      cameraModel: exif.cameraModel,
      thumbUrl,
      matchedFieldId: match.field ? match.field.id : '',
      matchedFieldName: match.field ? match.field.name : '',
      inPolygon: match.inPolygon,
      distM: match.distM,
      confidence: match.confidence
    });
  }

  _photoGpsItems = parsedItems;
  if (typeof window !== 'undefined') {
    window._uploadedGeoPhotos = parsedItems.filter(it => it.hasGps);
  }
  if (event?.target) event.target.value = '';
  renderPhotoGpsResults_();
  if (typeof refreshInteractiveMaps_ === 'function') refreshInteractiveMaps_();
}

function renderPhotoGpsResults_() {
  const listEl = document.getElementById('photoGpsResultList');
  const statusEl = document.getElementById('photoGpsStatusBanner');
  if (!listEl) return;

  if (_photoGpsItems.length === 0) {
    if (statusEl) statusEl.classList.add('hidden');
    listEl.innerHTML = `<div class="p-6 text-center text-xs text-[var(--muted-foreground)] border border-dashed border-[var(--border)] rounded-2xl">ドローン空撮写真やスマホ現場写真を選択すると、EXIFのGPS座標を読み取り自動で圃場を判別します（複数枚一括対応）。</div>`;
    return;
  }

  const gpsCount = _photoGpsItems.filter(i => i.hasGps).length;
  const matchedIds = [...new Set(_photoGpsItems.filter(i => i.confidence === 'high' || i.confidence === 'medium').map(i => i.matchedFieldId).filter(Boolean))];

  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = `✅ ${ _photoGpsItems.length }枚を解析完了（GPS検出: ${gpsCount}枚 ／ 自動判別圃場: ${matchedIds.length}筆）`;
  }

  listEl.innerHTML = _photoGpsItems.map((item, idx) => {
    let badgeHtml = '';
    let actionBtnHtml = '';
    if (!item.hasGps) {
      badgeHtml = safeHtml`<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/15 text-slate-600">📍 GPS情報なし</span>`;
    } else if (item.confidence === 'high') {
      badgeHtml = safeHtml`<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-700">🎯 圃場内確定: ${item.matchedFieldName}</span>`;
      actionBtnHtml = safeHtml`<button type="button" data-action="inspectMatchedFieldFromPhoto" data-arg="${item.matchedFieldId}" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700">カルテ確認</button>`;
    } else if (item.confidence === 'medium') {
      badgeHtml = safeHtml`<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-700">📍 近接一致 (${item.distM}m): ${item.matchedFieldName}</span>`;
      actionBtnHtml = safeHtml`<button type="button" data-action="inspectMatchedFieldFromPhoto" data-arg="${item.matchedFieldId}" class="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[11px] font-bold hover:bg-sky-700">カルテ確認</button>`;
    } else {
      const distLabel = item.distM !== null ? `最寄りから${item.distM}m` : '登録圃場なし';
      badgeHtml = safeHtml`<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-700">🆕 未登録エリア (${distLabel})</span>`;
      actionBtnHtml = safeHtml`<button type="button" data-action="createNewFieldFromPhotoCluster" data-arg="${idx}" class="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700">＋ この位置に新規圃場登録</button>`;
    }

    const coordText = item.hasGps
      ? `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}${item.altitude !== null ? ` / 高度 ${item.altitude}m` : ''}`
      : 'EXIFにGPS位置タグが含まれていません（LINE等で圧縮された画像は位置情報が削除されます）';

    return safeHtml`
      <div class="p-3 rounded-2xl bg-[var(--background)] border border-[var(--border)] flex items-center gap-3">
        ${item.thumbUrl ? rawHtml(`<img src="${escapeHtml(item.thumbUrl)}" alt="" class="w-16 h-16 rounded-xl object-cover border border-[var(--border)] shrink-0">`) : rawHtml('<div class="w-16 h-16 rounded-xl bg-[var(--secondary)] flex items-center justify-center text-xl shrink-0">📷</div>')}
        <div class="flex-1 min-w-0">
          <div class="flex items-center flex-wrap gap-1.5 mb-1">
            <span class="font-bold text-xs text-[var(--foreground)] truncate max-w-[200px]">${item.filename}</span>
            ${rawHtml(badgeHtml)}
          </div>
          <div class="text-[11px] text-[var(--muted-foreground)] font-mono">${coordText}</div>
          <div class="text-[11px] text-[var(--muted-foreground)] mt-0.5">
            ${item.takenAt ? `🕒 ${item.takenAt}` : ''}${item.cameraModel ? ` ／ 📷 ${item.cameraModel}` : ''}
          </div>
        </div>
        <div class="shrink-0">${rawHtml(actionBtnHtml)}</div>
      </div>
    `;
  }).join('');
}

function applyPhotoGpsFieldsToInput() {
  const matchedIds = [...new Set(
    _photoGpsItems
      .filter(i => i.hasGps && (i.confidence === 'high' || i.confidence === 'medium') && i.matchedFieldId)
      .map(i => i.matchedFieldId)
  )];
  if (matchedIds.length === 0) {
    showToast('⚠️ 判別された圃場がありません', 'GPS付き写真（既存圃場の範囲内・150m以内）を選択するか、「＋新規圃場登録」を行ってください。');
    return;
  }
  selectedFieldIds = matchedIds;
  const banner = document.getElementById('gpsStatusBanner');
  if (banner) {
    const names = matchedIds.map(id => fieldsData.find(f => f.id === id)?.name || id).join('・');
    banner.classList.remove('hidden');
    banner.textContent = `📷 写真GPS自動判別：${matchedIds.length} 筆［${names}］を作業対象にセットしました`;
  }
  renderInputFieldGrid();
  recalculatePreview();
  closePhotoGpsModal();
  switchMainTab('input');
  showToast(`📷 写真GPSから ${matchedIds.length} 筆を自動選択しました`, '作業分類を選んでそのまま記録できます。');
}

function showPhotoGpsOnGisMap() {
  const gpsCount = _photoGpsItems.filter(i => i.hasGps).length;
  if (gpsCount === 0) {
    showToast('⚠️ GPS付き写真がありません', '先にGPS位置情報を含む写真を選択してください。');
    return;
  }
  closePhotoGpsModal();
  switchMainTab('gis');
  switchGisMapMode('google');
  showToast(`🗺️ 航空写真マップに ${gpsCount} 枚の写真ピンを表示しました`, '青いピンをクリックするとサムネイルと判別結果を確認できます。');
}

function inspectMatchedFieldFromPhoto(fieldId) {
  if (!fieldId) return;
  closePhotoGpsModal();
  switchMainTab('gis');
  inspectField(fieldId);
}

function createNewFieldFromPhotoCluster(itemIndex) {
  const item = _photoGpsItems[Number(itemIndex)];
  if (!item || !item.hasGps) return;
  const newId = generateNextId('F', fieldsData.map(f => f.id));
  const defaultName = `📷 写真認識圃場 (${newId})`;
  const newField = {
    id: newId,
    name: defaultName,
    lot: `GPS自動登録 (${item.lat.toFixed(4)}, ${item.lng.toFixed(4)})`,
    group: 'gps',
    area: 25,
    crop: 'コシヒカリ (BL)',
    headingDate: '2026/08/08',
    targetTempC: 1000,
    dailyMeanTempC: 25.0,
    harvest: '2026/09/20',
    stage: '未着手',
    lat: item.lat,
    lng: item.lng,
    doneCats: [],
    nPer10a: 0,
    pPer10a: 0,
    kPer10a: 0,
    pestCount: {},
    alerts: [],
    baseline: makeEmptyBaseline()
  };
  fieldsData.push(newField);

  // 同じ撮影エリア内の他の写真も再マッチング
  _photoGpsItems.forEach(p => {
    if (!p.hasGps) return;
    const m = matchFieldByGpsCoord(p.lat, p.lng);
    p.matchedFieldId = m.field ? m.field.id : '';
    p.matchedFieldName = m.field ? m.field.name : '';
    p.inPolygon = m.inPolygon;
    p.distM = m.distM;
    p.confidence = m.confidence;
  });
  if (typeof window !== 'undefined') {
    window._uploadedGeoPhotos = _photoGpsItems.filter(it => it.hasGps);
  }

  saveStateToStorage();
  refreshAllViews();
  renderPhotoGpsResults_();
  showToast(`🆕 「${defaultName}」を登録しました`, '圃場面積・名称はタブ3（資源・マスタ）またはカルテからいつでも変更できます。');
}

function clearPhotoGpsResults() {
  _photoGpsItems = [];
  if (typeof window !== 'undefined') window._uploadedGeoPhotos = [];
  renderPhotoGpsResults_();
  if (typeof refreshInteractiveMaps_ === 'function') refreshInteractiveMaps_();
}
