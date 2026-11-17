// =========================================================================
// 食味値判定結果 写真撮影・OCR / Vision API 読み取りモジュール
// 仕様書: docs/taste_ocr_spec.md
// =========================================================================

const TASTE_OCR_CFG_KEY = 'rakuraku_einou_taste_ocr_cfg_v1';

let tasteOcrState = {
  imageBase64: '',
  imageMimeType: 'image/jpeg',
  imageDataUrl: '',
  sourceMode: 'manual', // 'gemini-vision' | 'local-ocr' | 'sample' | 'manual'
  rawText: '',
  lastParsed: null
};

function getTasteOcrConfig() {
  try {
    const raw = localStorage.getItem(TASTE_OCR_CFG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      provider: parsed.provider || 'gemini',
      apiKey: parsed.apiKey || '',
      model: parsed.model || 'gemini-2.5-flash'
    };
  } catch (_) {
    return { provider: 'gemini', apiKey: '', model: 'gemini-2.5-flash' };
  }
}

function loadTasteOcrSettings() {
  const cfg = getTasteOcrConfig();
  const providerEl = document.getElementById('tasteOcrProviderSelect');
  const keyEl = document.getElementById('tasteOcrApiKeyInput');
  const modelEl = document.getElementById('tasteOcrModelSelect');
  if (providerEl) providerEl.value = cfg.provider;
  if (keyEl) keyEl.value = cfg.apiKey;
  if (modelEl) modelEl.value = cfg.model;
}

function saveTasteOcrSettings() {
  const provider = document.getElementById('tasteOcrProviderSelect')?.value || 'gemini';
  const apiKey = (document.getElementById('tasteOcrApiKeyInput')?.value || '').trim();
  const model = document.getElementById('tasteOcrModelSelect')?.value || 'gemini-2.5-flash';
  try {
    localStorage.setItem(TASTE_OCR_CFG_KEY, JSON.stringify({ provider, apiKey, model }));
    showToast('🤖 食味OCR設定を保存しました', provider === 'gemini' && apiKey ? `Vision API (${model}) が利用可能です` : 'ローカル解析・手動補正モードで動作します');
  } catch (_) {
    showToast('⚠️ 設定の保存に失敗しました', 'ブラウザのストレージ容量を確認してください。');
  }
}

// =========================================================================
// 数値・表記ゆれ正規化＆ローカル正規表現パーサー
// =========================================================================
function normalizeOcrDigits_(str) {
  return String(str || '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, '.')
    .replace(/％/g, '%')
    .replace(/：/g, ':');
}

function clampNumberOrNull_(val, min, max, decimals = 1) {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function normalizeGradeValue_(raw) {
  const s = normalizeOcrDigits_(raw).trim();
  if (!s) return null;
  if (/(規格外|等外)/.test(s)) return '規格外';
  if (/(1等|一等|１等)/.test(s)) return '1等';
  if (/(2等|二等|２等)/.test(s)) return '2等';
  if (/(3等|三等|３等)/.test(s)) return '3等';
  return null;
}

/**
 * 食味計画面・検査伝票のテキストから仕様定義の各項目を抽出する
 */
function parseTasteOcrText(rawText) {
  const text = normalizeOcrDigits_(rawText);
  const extractNum = (patterns) => {
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1] !== undefined) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  const tasteScore = clampNumberOrNull_(
    extractNum([/(?:食味値|食味|味度|総合評価|SCORE)[^\d]{0,10}(\d{2,3}(?:\.\d+)?)/i]),
    40, 100, 1
  );
  const moisture = clampNumberOrNull_(
    extractNum([/(?:水分率?|MOIST(?:URE)?)[^\d]{0,10}(\d{1,2}\.\d+)/i]),
    10.0, 25.0, 1
  );
  const protein = clampNumberOrNull_(
    extractNum([/(?:タンパク質?|粗蛋白|蛋白質|PROTEIN)[^\d]{0,10}(\d{1,2}\.\d+)/i]),
    3.5, 13.0, 1
  );
  const amylose = clampNumberOrNull_(
    extractNum([/(?:アミロース|AMYLOSE)[^\d]{0,10}(\d{1,2}\.\d+)/i]),
    5.0, 30.0, 1
  );
  const wholeGrainRate = clampNumberOrNull_(
    extractNum([/(?:整粒歩合|整粒率|整粒)[^\d]{0,10}(\d{2,3}(?:\.\d+)?)/i]),
    30.0, 100.0, 1
  );
  const fattyAcid = clampNumberOrNull_(
    extractNum([/(?:脂肪酸度|脂肪酸)[^\d]{0,10}(\d{1,2}(?:\.\d+)?)/i]),
    3.0, 50.0, 1
  );
  const harvestBags = clampNumberOrNull_(
    extractNum([/(?:荷受袋数|袋数|検査数量)[^\d]{0,10}(\d{1,4})\s*袋?/i]),
    1, 9999, 0
  );

  let grade = null;
  const gradeMatch = text.match(/(?:等級|検査等級|品位)[^\S\r\n:：]*[:：]?\s*([123一二三]等|規格外|等外)/i)
    || text.match(/([123一二三]等米?|規格外)/);
  if (gradeMatch) grade = normalizeGradeValue_(gradeMatch[1]);

  const lotMatch = text.match(/(?:伝票(?:番号|No\.?)|ロット(?:No\.?|番号)?|LOT)[^\S\r\n:：]*[:：]?\s*([A-Z0-9-]{4,24})/i);
  const varietyMatch = text.match(/(?:品種)[^\S\r\n:：]*[:：]?\s*([^\s\r\n/／]{2,14})/);

  return {
    tasteScore,
    moisture,
    protein,
    amylose,
    wholeGrainRate,
    fattyAcid,
    grade,
    harvestBags,
    lotNo: lotMatch ? lotMatch[1] : '',
    variety: varietyMatch ? varietyMatch[1] : '',
    rawText: String(rawText || '').trim(),
    confidenceNotes: 'ローカル正規表現パーサーで抽出しました。必要に応じて数値を微調整してください。'
  };
}

// =========================================================================
// 画像リサイズ・圧縮 & Gemini Vision API 呼び出し
// =========================================================================
function resizeImageFileToBase64_(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像ファイルの読み込みに失敗しました'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像のデコードに失敗しました'));
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ dataUrl, base64, mimeType: 'image/jpeg', width: w, height: h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function callGeminiTasteVision_(base64, mimeType, cfg) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const prompt = [
    'あなたは日本の米穀検査・食味計データの専門OCRパーサーです。',
    '画像（食味計の液晶画面・感熱紙レシート、またはJA/米穀検査伝票）から以下の項目を抽出し、必ずJSONのみを返してください。',
    '読み取れない項目は null（文字列項目は ""）にしてください。',
    '{',
    '  "sourceType": "meter" | "slip",',
    '  "tasteScore": number | null,      // 食味値 (例: 84)',
    '  "moisture": number | null,        // 玄米水分量 % (例: 14.8)',
    '  "protein": number | null,         // タンパク含有率 % (例: 6.2)',
    '  "amylose": number | null,         // アミロース含有率 % (例: 17.5)',
    '  "wholeGrainRate": number | null,  // 整粒歩合 % (例: 83.4)',
    '  "fattyAcid": number | null,       // 脂肪酸度 mgKOH/100g (例: 13.8)',
    '  "grade": "1等" | "2等" | "3等" | "規格外" | null,',
    '  "harvestBags": number | null,     // 30kg換算袋数',
    '  "lotNo": string,                  // 伝票番号・ロット番号',
    '  "variety": string,                // 品種名',
    '  "rawText": string,                // 画像内の主な読み取りテキスト',
    '  "confidenceNotes": string         // 読み取り時の補足・不鮮明箇所メモ',
    '}'
  ].join('\n');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API Error (${res.status}): ${errText.slice(0, 160)}`);
  }

  const data = await res.json();
  const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = rawJsonText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const obj = JSON.parse(cleaned);

  return {
    tasteScore: clampNumberOrNull_(obj.tasteScore, 40, 100, 1),
    moisture: clampNumberOrNull_(obj.moisture, 10.0, 25.0, 1),
    protein: clampNumberOrNull_(obj.protein, 3.5, 13.0, 1),
    amylose: clampNumberOrNull_(obj.amylose, 5.0, 30.0, 1),
    wholeGrainRate: clampNumberOrNull_(obj.wholeGrainRate, 30.0, 100.0, 1),
    fattyAcid: clampNumberOrNull_(obj.fattyAcid, 3.0, 50.0, 1),
    grade: normalizeGradeValue_(obj.grade),
    harvestBags: clampNumberOrNull_(obj.harvestBags, 1, 9999, 0),
    lotNo: String(obj.lotNo || '').trim(),
    variety: String(obj.variety || '').trim(),
    rawText: String(obj.rawText || '').trim(),
    confidenceNotes: String(obj.confidenceNotes || 'Gemini Vision APIで構造化抽出しました。').trim()
  };
}

// =========================================================================
// 実物サンプル生成（食味計画面 / JA検査伝票の模擬画像＋テキスト）
// =========================================================================
function renderSampleImageDataUrl_(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 440;
  const ctx = canvas.getContext('2d');

  if (kind === 'meter') {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 720, 440);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(28, 28, 664, 384);
    ctx.fillStyle = '#84cc16';
    ctx.fillRect(48, 72, 624, 316);
    ctx.fillStyle = '#1a2e05';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('SATAKE / SHIZUOKA 食味計 判定結果', 64, 112);
    ctx.font = 'bold 54px monospace';
    ctx.fillText('食味値:  84 点', 68, 182);
    ctx.font = 'bold 28px monospace';
    ctx.fillText('水  分: 14.8 %     タンパク:  6.2 %', 68, 240);
    ctx.fillText('アミロース: 17.4 %  脂肪酸度: 13.6', 68, 286);
    ctx.fillText('整粒歩合: 84.5 %   品種: コシヒカリ', 68, 332);
    ctx.font = '18px monospace';
    ctx.fillText('LOT: 2026-KM-0084   [測定完了]', 68, 370);
  } else {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 720, 440);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, 672, 392);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('JA 米穀検査・食味分析結果通知書', 44, 68);
    ctx.font = '18px sans-serif';
    ctx.fillText('伝票番号: JA-2026-0921-12   品種: コシヒカリ', 44, 108);
    ctx.beginPath();
    ctx.moveTo(44, 126);
    ctx.lineTo(676, 126);
    ctx.stroke();
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('検査等級: 1等      荷受袋数: 180 袋 (5,400kg)', 44, 174);
    ctx.fillText('玄米水分: 14.6 %   整粒歩合: 82.8 %', 44, 224);
    ctx.fillText('食味値  : 86 点    タンパク: 5.9 %', 44, 274);
    ctx.fillText('アミロース: 17.1 %', 44, 324);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('※ 農産物検査法に基づく玄米品位および食味分析結果', 44, 386);
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}

function loadTasteOcrSample(kind) {
  const sampleText = kind === 'meter'
    ? '食味計判定結果\n品種: コシヒカリ\nLOT: 2026-KM-0084\n食味値: 84\n水分: 14.8%\nタンパク: 6.2%\nアミロース: 17.4%\n整粒歩合: 84.5%\n脂肪酸度: 13.6'
    : 'JA 米穀検査・食味分析結果通知書\n伝票番号: JA-2026-0921-12\n品種: コシヒカリ\n検査等級: 1等\n荷受袋数: 180袋\n水分: 14.6%\n整粒歩合: 82.8%\n食味値: 86点\nタンパク: 5.9%\nアミロース: 17.1%';

  const dataUrl = renderSampleImageDataUrl_(kind);
  tasteOcrState.imageDataUrl = dataUrl;
  tasteOcrState.imageBase64 = dataUrl.split(',')[1] || '';
  tasteOcrState.imageMimeType = 'image/jpeg';
  tasteOcrState.sourceMode = 'sample';
  tasteOcrState.rawText = sampleText;

  const parsed = parseTasteOcrText(sampleText);
  parsed.confidenceNotes = kind === 'meter'
    ? '食味計液晶画面サンプルを読み込みました。このまま「収穫フォームへ反映」できます。'
    : 'JA検査伝票サンプルを読み込みました。このまま「収穫フォームへ反映」できます。';

  renderTasteOcrPreview_();
  populateTasteOcrResultForm_(parsed);
}

// =========================================================================
// モーダルUI制御・フォーム反映
// =========================================================================
function openTasteOcrModal() {
  if (typeof ModalManager !== 'undefined') {
    ModalManager.open('tasteOcrModal');
  } else {
    document.getElementById('tasteOcrModal')?.classList.remove('hidden');
  }
  updateTasteOcrModeBadge_();
  renderTasteOcrPreview_();
}

function closeTasteOcrModal() {
  if (typeof ModalManager !== 'undefined') {
    ModalManager.close('tasteOcrModal');
  } else {
    document.getElementById('tasteOcrModal')?.classList.add('hidden');
  }
}

function updateTasteOcrModeBadge_() {
  const badge = document.getElementById('tasteOcrModeBadge');
  if (!badge) return;
  const cfg = getTasteOcrConfig();
  if (cfg.provider === 'gemini' && cfg.apiKey && navigator.onLine && !isOfflineMode) {
    badge.className = 'px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 text-xs font-bold';
    badge.textContent = `🤖 Gemini Vision API (${cfg.model}) 接続可`;
  } else if (cfg.provider === 'gemini' && !cfg.apiKey) {
    badge.className = 'px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 text-xs font-bold';
    badge.textContent = '📝 ローカル解析モード（APIキー未設定・タブ5で設定可）';
  } else {
    badge.className = 'px-2.5 py-1 rounded-lg bg-slate-500/15 text-slate-700 text-xs font-bold';
    badge.textContent = '📡 オフライン / ローカル解析モード';
  }
}

function renderTasteOcrPreview_() {
  const img = document.getElementById('tasteOcrPreviewImg');
  const empty = document.getElementById('tasteOcrPreviewEmpty');
  if (!img || !empty) return;
  if (tasteOcrState.imageDataUrl) {
    img.src = tasteOcrState.imageDataUrl;
    img.classList.remove('hidden');
    empty.classList.add('hidden');
  } else {
    img.src = '';
    img.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}

function populateTasteOcrResultForm_(parsed) {
  tasteOcrState.lastParsed = parsed;
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = (v !== undefined && v !== null) ? v : '';
  };
  setVal('ocrResTasteScore', parsed.tasteScore);
  setVal('ocrResMoisture', parsed.moisture);
  setVal('ocrResProtein', parsed.protein);
  setVal('ocrResAmylose', parsed.amylose);
  setVal('ocrResWholeGrainRate', parsed.wholeGrainRate);
  setVal('ocrResFattyAcid', parsed.fattyAcid);
  setVal('ocrResGrade', parsed.grade || '');
  setVal('ocrResBags', parsed.harvestBags);
  setVal('ocrResLotNo', parsed.lotNo || '');
  setVal('ocrResRawText', parsed.rawText || '');

  const noteEl = document.getElementById('tasteOcrConfidenceNote');
  if (noteEl) noteEl.textContent = parsed.confidenceNotes || '';
}

async function handleTasteImageSelect(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    const resized = await resizeImageFileToBase64_(file);
    tasteOcrState.imageDataUrl = resized.dataUrl;
    tasteOcrState.imageBase64 = resized.base64;
    tasteOcrState.imageMimeType = resized.mimeType;
    tasteOcrState.sourceMode = 'manual';
    renderTasteOcrPreview_();
    await runTasteOcrAnalysis();
  } catch (err) {
    showToast('⚠️ 画像の読み込みに失敗しました', String(err?.message || err));
  } finally {
    if (event?.target) event.target.value = '';
  }
}

async function runTasteOcrAnalysis() {
  const cfg = getTasteOcrConfig();
  const statusEl = document.getElementById('tasteOcrStatusText');
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  if (tasteOcrState.imageBase64 && cfg.provider === 'gemini' && cfg.apiKey && navigator.onLine && !isOfflineMode) {
    try {
      setStatus('⏳ Gemini Vision API で画像を解析中...');
      const result = await callGeminiTasteVision_(tasteOcrState.imageBase64, tasteOcrState.imageMimeType, cfg);
      tasteOcrState.sourceMode = 'gemini-vision';
      tasteOcrState.rawText = result.rawText || '';
      populateTasteOcrResultForm_(result);
      setStatus('✅ AI読み取り完了！数値を確認して「収穫フォームへ反映」を押してください。');
      return;
    } catch (err) {
      setStatus(`⚠️ Vision API解析に失敗したためローカル解析へ切替: ${err?.message || err}`);
    }
  }

  const rawText = document.getElementById('ocrResRawText')?.value || tasteOcrState.rawText || '';
  if (rawText.trim()) {
    tasteOcrState.sourceMode = tasteOcrState.sourceMode === 'sample' ? 'sample' : 'local-ocr';
    const parsed = parseTasteOcrText(rawText);
    populateTasteOcrResultForm_(parsed);
    setStatus('✅ テキストから数値を抽出しました。確認して反映してください。');
  } else {
    setStatus('ℹ️ オフライン／APIキー未設定のため、下の抽出テキスト欄へ貼付するか数値を直接入力してください。');
  }
}

function reparseTasteRawText() {
  const rawText = document.getElementById('ocrResRawText')?.value || '';
  tasteOcrState.rawText = rawText;
  tasteOcrState.sourceMode = 'local-ocr';
  const parsed = parseTasteOcrText(rawText);
  populateTasteOcrResultForm_(parsed);
  const statusEl = document.getElementById('tasteOcrStatusText');
  if (statusEl) statusEl.textContent = '✅ テキストから項目を再抽出しました。';
}

function applyTasteOcrToHarvestForm() {
  const getNum = (id) => {
    const v = document.getElementById(id)?.value;
    return (v !== undefined && v !== null && String(v).trim() !== '') ? Number(v) : null;
  };
  const tasteScore = getNum('ocrResTasteScore');
  const moisture = getNum('ocrResMoisture');
  const protein = getNum('ocrResProtein');
  const amylose = getNum('ocrResAmylose');
  const wholeGrainRate = getNum('ocrResWholeGrainRate');
  const fattyAcid = getNum('ocrResFattyAcid');
  const grade = document.getElementById('ocrResGrade')?.value || '';
  const bags = getNum('ocrResBags');
  const lotNo = (document.getElementById('ocrResLotNo')?.value || '').trim();

  if (moisture !== null && document.getElementById('harvestMoistureInput')) {
    document.getElementById('harvestMoistureInput').value = moisture.toFixed(1);
  }
  if (grade && document.getElementById('harvestGradeSelect')) {
    document.getElementById('harvestGradeSelect').value = grade;
  }
  if (bags !== null && bags > 0) {
    currentHarvestBags = Math.round(bags);
    if (document.getElementById('harvestBagValue')) {
      document.getElementById('harvestBagValue').textContent = currentHarvestBags;
    }
  }

  const setField = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val !== null && val !== undefined ? val : '';
  };
  setField('harvestTasteScoreInput', tasteScore);
  setField('harvestProteinInput', protein);
  setField('harvestWholeGrainInput', wholeGrainRate);
  setField('harvestAmyloseInput', amylose);
  setField('harvestFattyAcidInput', fattyAcid);
  setField('harvestTasteLotNoInput', lotNo);
  setField('harvestTasteOcrSourceInput', tasteOcrState.sourceMode || 'manual');

  if (lotNo && document.getElementById('workDiaryMemoInput')) {
    const memoEl = document.getElementById('workDiaryMemoInput');
    const tag = `検査伝票:${lotNo}`;
    if (!memoEl.value.includes(tag)) {
      memoEl.value = memoEl.value.trim() ? `${memoEl.value.trim()} / ${tag}` : tag;
    }
  }

  recalculatePreview();
  closeTasteOcrModal();
  showToast('📸 食味・検査結果を収穫フォームへ反映しました', '内容を確認して「✅ この内容で一括登録」を押してください。');
}
