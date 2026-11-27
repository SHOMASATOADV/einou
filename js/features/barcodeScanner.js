// =========================================================================
// Feature: TSK-028 スマホカメラ JANバーコード / QRコード読み取り 自動資材選択
//   - ネイティブ BarcodeDetector API (ean_13 / ean_8 / qr_code / code_128)
//   - カメラライブ読取 ＋ 写真ファイル読取 ＋ 手動JAN/QR入力フォールバック
//   - 未登録JANコードをその場で既存肥料・農薬マスタへ紐付け保存可能
// =========================================================================

const BarcodeScannerState = {
  stream: null,
  detector: null,
  rafId: null,
  scanning: false,
  lastCode: '',
  lastMatch: null
};

// 代表的なサンプル・デモJANコード（マスタ未設定時の照合補助およびテスト用）
const DEFAULT_JAN_HINTS = {
  '4901001000014': { type: 'fertilizer', id: 'F01', fallbackName: 'オール14' },
  '4901001000021': { type: 'fertilizer', id: 'F02', fallbackName: 'コート' },
  '4902002020142': { type: 'pesticide', id: 'P01', fallbackName: 'アミスター' },
  '4902002021993': { type: 'pesticide', id: 'P02', fallbackName: 'スタークル液剤' }
};

function normalizeBarcodeString_(raw) {
  return String(raw || '').normalize('NFKC').trim();
}

/**
 * 読み取ったJAN/QRコード文字列から肥料・農薬マスタを自動照合（純関数・単体テスト対象）
 * @param {string} rawCode
 * @param {Object} fertMap fertilizers
 * @param {Object} pestMap pesticides
 */
function matchMaterialByBarcode(rawCode, fertMap = {}, pestMap = {}) {
  const code = normalizeBarcodeString_(rawCode);
  if (!code) return { matched: false, code: '', type: null, id: null, item: null, reason: 'コードが空です' };

  const ferts = Object.values(fertMap || {});
  const pests = Object.values(pestMap || {});

  // 1. JSON QRコード形式: {"type":"pesticide","id":"P01"} / {"jan":"490..."}
  if (code.startsWith('{') && code.endsWith('}')) {
    try {
      const obj = JSON.parse(code);
      if (obj.jan) return matchMaterialByBarcode(obj.jan, fertMap, pestMap);
      if (obj.id) {
        if (fertMap[obj.id]) return { matched: true, code, type: 'fertilizer', id: obj.id, item: fertMap[obj.id], via: 'QR(JSON)' };
        if (pestMap[obj.id]) return { matched: true, code, type: 'pesticide', id: obj.id, item: pestMap[obj.id], via: 'QR(JSON)' };
      }
    } catch (e) {}
  }

  // 2. 専用QRプレフィックス: EINOU:F01 / EINOU:P01
  const prefixMatch = code.match(/^EINOU[:/]([A-Za-z0-9_-]+)$/i);
  if (prefixMatch) {
    const cid = prefixMatch[1].toUpperCase();
    if (fertMap[cid]) return { matched: true, code, type: 'fertilizer', id: cid, item: fertMap[cid], via: 'QR(ID)' };
    if (pestMap[cid]) return { matched: true, code, type: 'pesticide', id: cid, item: pestMap[cid], via: 'QR(ID)' };
  }

  // 3. マスタ登録済み janCode 完全一致
  const janFert = ferts.find(f => f && f.janCode && normalizeBarcodeString_(f.janCode) === code);
  if (janFert) return { matched: true, code, type: 'fertilizer', id: janFert.id, item: janFert, via: 'JAN完全一致' };
  const janPest = pests.find(p => p && p.janCode && normalizeBarcodeString_(p.janCode) === code);
  if (janPest) return { matched: true, code, type: 'pesticide', id: janPest.id, item: janPest, via: 'JAN完全一致' };

  // 4. 資材ID直接一致
  const upper = code.toUpperCase();
  if (fertMap[upper]) return { matched: true, code, type: 'fertilizer', id: upper, item: fertMap[upper], via: '資材ID一致' };
  if (pestMap[upper]) return { matched: true, code, type: 'pesticide', id: upper, item: pestMap[upper], via: '資材ID一致' };

  // 5. 農薬登録番号の数字一致（例: 20142 → 第20142号）
  const digitsOnly = code.replace(/\D/g, '');
  if (digitsOnly.length >= 4 && digitsOnly.length <= 7) {
    const regHit = pests.find(p => p && String(p.regNo || '').replace(/\D/g, '') === digitsOnly);
    if (regHit) return { matched: true, code, type: 'pesticide', id: regHit.id, item: regHit, via: '農薬登録番号一致' };
  }

  // 6. 代表JANヒント一致（デモ・初回導入用）
  const hint = DEFAULT_JAN_HINTS[digitsOnly];
  if (hint) {
    const targetMap = hint.type === 'fertilizer' ? fertMap : pestMap;
    const byId = targetMap[hint.id];
    if (byId) return { matched: true, code, type: hint.type, id: byId.id, item: byId, via: 'JAN標準辞書一致' };
    const byName = Object.values(targetMap).find(item => String(item.name || '').includes(hint.fallbackName));
    if (byName) return { matched: true, code, type: hint.type, id: byName.id, item: byName, via: 'JAN標準辞書一致' };
  }

  return {
    matched: false,
    code,
    type: null,
    id: null,
    item: null,
    reason: `コード「${code}」に一致する資材がマスタに見つかりません。下から既存資材に紐付け保存できます。`
  };
}

function isNativeBarcodeDetectorSupported_() {
  return typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
}

function openBarcodeScanModal() {
  ModalManager.open('barcodeScanModal');
  const statusEl = document.getElementById('barcodeSupportStatus');
  if (statusEl) {
    statusEl.textContent = isNativeBarcodeDetectorSupported_()
      ? '✅ カメラリアルタイム JAN/QR 読み取りに対応しています'
      : 'ℹ️ このブラウザはカメラ自動検出に未対応のため、写真選択またはコード手入力をご利用ください';
    statusEl.className = isNativeBarcodeDetectorSupported_()
      ? 'text-[11px] font-semibold text-emerald-600'
      : 'text-[11px] font-semibold text-amber-600';
  }
  renderBarcodeScanResult_(BarcodeScannerState.lastMatch);
}

function closeBarcodeScanModal() {
  stopBarcodeCamera();
  ModalManager.close('barcodeScanModal');
}

function stopBarcodeCamera() {
  BarcodeScannerState.scanning = false;
  if (BarcodeScannerState.rafId) {
    cancelAnimationFrame(BarcodeScannerState.rafId);
    BarcodeScannerState.rafId = null;
  }
  if (BarcodeScannerState.stream) {
    try {
      BarcodeScannerState.stream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    BarcodeScannerState.stream = null;
  }
  const video = document.getElementById('barcodeVideo');
  if (video) {
    video.srcObject = null;
    video.classList.add('hidden');
  }
  const placeholder = document.getElementById('barcodeCameraPlaceholder');
  if (placeholder) placeholder.classList.remove('hidden');
  const btn = document.getElementById('barcodeCameraToggleBtn');
  if (btn) btn.textContent = '📷 カメラでスキャン開始';
}

async function toggleBarcodeCamera() {
  if (BarcodeScannerState.scanning) {
    stopBarcodeCamera();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('📷 カメラを利用できません', 'HTTPS環境またはカメラ対応端末でご利用ください。下の入力欄から手動照合も可能です。');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    BarcodeScannerState.stream = stream;
    const video = document.getElementById('barcodeVideo');
    const placeholder = document.getElementById('barcodeCameraPlaceholder');
    if (video) {
      video.srcObject = stream;
      video.classList.remove('hidden');
      await video.play();
    }
    if (placeholder) placeholder.classList.add('hidden');

    const btn = document.getElementById('barcodeCameraToggleBtn');
    if (btn) btn.textContent = '⏹️ カメラを停止';
    BarcodeScannerState.scanning = true;

    if (isNativeBarcodeDetectorSupported_()) {
      BarcodeScannerState.detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'upc_a', 'upc_e']
      });
      scanBarcodeFrameLoop_();
    } else {
      showToast('📷 カメラ起動中（手動入力補助）', 'このブラウザでは自動検出APIが未対応のため、ラベルのJAN番号を下の入力欄へ入力して照合してください。');
    }
  } catch (err) {
    showToast('📷 カメラを起動できませんでした', 'カメラ権限を許可するか、下の写真読取・手入力をご利用ください。');
    stopBarcodeCamera();
  }
}

async function scanBarcodeFrameLoop_() {
  if (!BarcodeScannerState.scanning || !BarcodeScannerState.detector) return;
  const video = document.getElementById('barcodeVideo');
  if (video && video.readyState >= 2) {
    try {
      const barcodes = await BarcodeScannerState.detector.detect(video);
      if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
        const detected = barcodes[0].rawValue;
        if (navigator.vibrate) navigator.vibrate(40);
        stopBarcodeCamera();
        handleDetectedBarcode_(detected, true);
        return;
      }
    } catch (e) {}
  }
  BarcodeScannerState.rafId = requestAnimationFrame(scanBarcodeFrameLoop_);
}

async function handleBarcodeImageSelect(ev) {
  const file = ev?.target?.files?.[0];
  if (!file) return;
  if (!isNativeBarcodeDetectorSupported_()) {
    showToast('ℹ️ 画像バーコード検出未対応ブラウザです', 'Chrome / Edge（Android等）でご利用いただくか、下のJAN番号入力欄をご利用ください。');
    ev.target.value = '';
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    const detector = new window.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'upc_a', 'upc_e']
    });
    const barcodes = await detector.detect(bmp);
    if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
      handleDetectedBarcode_(barcodes[0].rawValue, true);
    } else {
      showToast('⚠️ バーコードを検出できませんでした', 'ピントが合った明るい写真を選び直すか、下の入力欄にJANコードを入力してください。');
    }
  } catch (err) {
    showToast('⚠️ 画像解析エラー', String(err && err.message ? err.message : err));
  } finally {
    ev.target.value = '';
  }
}

function handleDetectedBarcode_(rawCode, autoSelectToast = false) {
  const input = document.getElementById('barcodeManualInput');
  if (input) input.value = normalizeBarcodeString_(rawCode);
  const res = matchMaterialByBarcode(rawCode, fertilizers, pesticides);
  BarcodeScannerState.lastCode = res.code;
  BarcodeScannerState.lastMatch = res;
  renderBarcodeScanResult_(res);
  if (autoSelectToast && res.matched) {
    showToast(`📷 バーコード検出：${res.item.name}`, `照合方法: ${res.via} ／ 「フォームへセット」を押すと自動選択されます。`);
  }
}

function lookupBarcodeManualInput() {
  const input = document.getElementById('barcodeManualInput');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('📷 コード未入力', 'JANコード（13桁/8桁）または資材ID・農薬登録番号を入力してください。');
    return;
  }
  handleDetectedBarcode_(val, false);
}

function testBarcodeSample(sampleCode) {
  handleDetectedBarcode_(sampleCode, false);
}

/**
 * 検出した資材を入力フォームへ自動セット
 * @param {string} slot 'primary' | 'mix'
 */
function applyScannedMaterialToForm(slot = 'primary') {
  const m = BarcodeScannerState.lastMatch;
  if (!m || !m.matched) return;

  if (typeof switchMainTab === 'function') switchMainTab('input');
  if (m.type === 'fertilizer') {
    selectWorkCat('施肥');
    const sel = document.getElementById('fertilizerSelect');
    if (sel) sel.value = m.id;
  } else if (m.type === 'pesticide') {
    selectWorkCat('防除');
    if (slot === 'mix') {
      const mixSel = document.getElementById('pesticideMixSelect');
      if (mixSel) mixSel.value = m.id;
    } else {
      const pSel = document.getElementById('pesticideSelect');
      if (pSel) pSel.value = m.id;
    }
  }
  recalculatePreview();
  closeBarcodeScanModal();
  showToast(
    `✅ ${m.item.name} を${slot === 'mix' ? '第2農薬（混用）' : '使用資材'}にセットしました`,
    `作業分類を「${m.type === 'fertilizer' ? '施肥' : '防除'}」へ自動切替しました。`
  );
}

/**
 * 未登録JANコードを既存の肥料・農薬マスタへ紐付け保存
 */
function bindScannedBarcodeToExistingMaterial() {
  const code = BarcodeScannerState.lastCode;
  const sel = document.getElementById('barcodeBindSelect');
  const val = sel ? sel.value : '';
  if (!code || !val || !val.includes(':')) {
    showToast('⚠️ 紐付け先を選択してください', 'リストから登録済みの肥料または農薬を選んでください。');
    return;
  }
  const [type, id] = val.split(':');
  const target = type === 'fertilizer' ? fertilizers[id] : pesticides[id];
  if (!target) return;

  target.janCode = code;
  saveStateToStorage();
  handleDetectedBarcode_(code, false);
  showToast(`🔗 JANコード（${code}）を「${target.name}」に紐付けました`, '次回からはかざすだけで一発自動選択されます。');
}

function renderBarcodeScanResult_(res) {
  const box = document.getElementById('barcodeScanResult');
  if (!box) return;
  if (!res || !res.code) {
    box.innerHTML = '<div class="text-xs text-[var(--muted-foreground)]">カメラで農薬ボトル・肥料袋のJAN/QRコードを読み取るか、下のサンプル・手入力をお試しください。</div>';
    return;
  }

  if (res.matched && res.item) {
    const isFert = res.type === 'fertilizer';
    const typeLabel = isFert ? '🧪 肥料マスタ一致' : '🛡️ 農薬マスタ一致';
    const metaText = isFert
      ? `N${res.item.n}-P${res.item.p}-K${res.item.k} ／ ${res.item.unitKg}kg/袋 ／ 現在庫 ${res.item.stock}袋`
      : `登録番号:${res.item.regNo || '-'} ／ 成分:${res.item.activeIngredient || '-'} ／ 上限${res.item.maxUse}回・PHI${res.item.phiDays}日`;

    const mixBtnHtml = !isFert
      ? '<button type="button" data-action="applyScannedMaterialToForm" data-arg="mix" class="px-3 py-2 rounded-xl border border-sky-500/40 bg-sky-500/10 text-sky-700 text-xs font-bold hover:bg-sky-500/20">＋ 第2農薬(混用)にセット</button>'
      : '';

    box.innerHTML = safeHtml`
      <div class="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 space-y-2">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <span class="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">${typeLabel}（${res.via}）</span>
          <span class="font-mono text-[11px] text-[var(--muted-foreground)]">コード: ${res.code}</span>
        </div>
        <div class="text-sm font-extrabold text-[var(--foreground)]">${res.item.name}</div>
        <div class="text-xs text-[var(--muted-foreground)]">${metaText}</div>
        <div class="flex flex-wrap gap-2 pt-1">
          <button type="button" data-action="applyScannedMaterialToForm" data-arg="primary" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm">
            ✅ フォームへ自動セット
          </button>
          ${rawHtml(mixBtnHtml)}
        </div>
      </div>
    `;
    return;
  }

  // 未登録コード → 既存マスタへの紐付けUIを提示
  const optionsHtml = [
    ...Object.values(fertilizers || {}).map(f => safeHtml`<option value="fertilizer:${f.id}">🧪 [肥料] ${f.name}</option>`),
    ...Object.values(pesticides || {}).map(p => safeHtml`<option value="pesticide:${p.id}">🛡️ [農薬] ${p.name}</option>`)
  ].join('');

  box.innerHTML = safeHtml`
    <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-2.5">
      <div class="text-xs font-bold text-amber-800 dark:text-amber-300">⚠️ 未登録コード検出：<span class="font-mono">${res.code}</span></div>
      <div class="text-[11px] text-[var(--muted-foreground)]">${res.reason}</div>
      <div class="flex flex-col sm:flex-row gap-2">
        <select id="barcodeBindSelect" class="flex-1 px-3 py-2 rounded-xl bg-[var(--card)] border border-[var(--border)] text-xs font-semibold text-[var(--foreground)]">
          ${rawHtml(optionsHtml)}
        </select>
        <button type="button" data-action="bindScannedBarcodeToExistingMaterial" class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0">
          🔗 この資材にJANを紐付け保存
        </button>
      </div>
    </div>
  `;
}

registerActionHandlers({
  openBarcodeScanModal: () => openBarcodeScanModal(),
  closeBarcodeScanModal: () => closeBarcodeScanModal(),
  toggleBarcodeCamera: () => toggleBarcodeCamera(),
  handleBarcodeImageSelect: (el, ev) => handleBarcodeImageSelect(ev),
  lookupBarcodeManualInput: () => lookupBarcodeManualInput(),
  testBarcodeSample: (el) => testBarcodeSample(el.dataset.arg),
  applyScannedMaterialToForm: (el) => applyScannedMaterialToForm(el.dataset.arg),
  bindScannedBarcodeToExistingMaterial: () => bindScannedBarcodeToExistingMaterial()
});
