// =========================================================================
// Feature: 音声入力（TSK-029 音声コマンド入力 / TSK-039-4 日誌メモ音声書き起こし）
//   - Web Speech API (SpeechRecognition / webkitSpeechRecognition, ja-JP)
//   - 「本場1号から3号まで草刈り2時間」等の発話を解析してフォームへ自動セット
//   - 非対応ブラウザ・圏外時は「文章入力」で同じ解析を利用可能
// =========================================================================

const VOICE_CAT_RULES = [
  ['収穫', /(収穫|稲刈|刈り取|刈取|コンバイン)/],
  ['田植え', /(田植|植え付け|植付)/],
  ['代かき', /(代かき|代掻|しろかき|シロカキ)/],
  ['施肥', /(施肥|肥料|追肥|穂肥|基肥|元肥|肥まき)/],
  ['防除', /(防除|消毒|農薬|殺菌|殺虫|除草剤|ドローン|散布)/],
  ['草刈り', /(草刈|くさかり|畦畔|あぜ刈|モア|刈払)/],
  ['耕起', /(耕起|耕うん|耕運|耕耘|田起こし|荒起こし|秋起こし)/]
];

const VOICE_MACHINE_KEYWORDS = [
  [/トラクタ/, ['トラクター', 'トラクタ']],
  [/ドローン/, ['ドローン']],
  [/(モア|草刈機|草刈り機)/, ['モア', '草刈']],
  [/田植機|田植え機/, ['田植機', '田植']],
  [/コンバイン/, ['コンバイン']]
];

const VOICE_WEATHER_RULES = [
  ['💨 強風', /(強風|風が強)/],
  ['🌧️ 雨', /(雨|小雨)/],
  ['⛅ 曇り', /(曇り|くもり|曇)/],
  ['☀️ 晴れ', /(晴れ|はれ|快晴)/]
];

const KANJI_DIGITS_ = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };

function kanjiNumberToInt_(str) {
  if (!str) return NaN;
  if (str === '十') return 10;
  if (str.includes('十')) {
    const [tensStr, onesStr] = str.split('十');
    const tens = tensStr ? KANJI_DIGITS_[tensStr] : 1;
    const ones = onesStr ? KANJI_DIGITS_[onesStr] : 0;
    return (tens ?? NaN) * 10 + (ones ?? NaN);
  }
  return Number(str.split('').map(c => KANJI_DIGITS_[c] ?? '').join(''));
}

/**
 * 音声認識テキストの正規化
 *  - 丸数字の除去（NFKC で「① → 1」になり号数と混同するのを防ぐ）
 *  - 全角英数→半角、空白除去
 *  - 単位直前の漢数字 → 算用数字（「二時間半」→「2時間半」）
 *  - 「エー/ビー/シー」→ A/B/C
 */
function normalizeVoiceText_(text) {
  let s = String(text || '');
  s = s.replace(/[\u2460-\u2473\u24EA\u3251-\u325F\u32B1-\u32BF\u2776-\u277F]/g, '');
  s = s.normalize('NFKC');
  s = s.replace(/[\s\u3000]+/g, '');
  s = s.replace(/([〇零一二三四五六七八九十]+)(?=号|時間|袋|分|本|筆|日|枚|反)/g, (m) => {
    const n = kanjiNumberToInt_(m);
    return Number.isFinite(n) ? String(n) : m;
  });
  s = s.replace(/エー/g, 'A').replace(/ビー/g, 'B').replace(/シー/g, 'C').replace(/ディー/g, 'D');
  s = s.replace(/[〜～]/g, '〜');
  return s;
}

function normalizeFieldName_(name) {
  return normalizeVoiceText_(name).replace(/[（(][^）)]*[）)]/g, '');
}

function extractFieldBase_(normName) {
  const m = normName.match(/^(.*?)(\d+)号/);
  if (m && m[1]) return m[1];
  const stripped = normName.replace(/[A-Za-z0-9・]+$/g, '');
  return stripped.length >= 2 ? stripped : '';
}

/**
 * 発話テキストを解析して入力フォーム用のパラメータへ変換（純関数・単体テスト対象）
 * @param {string} text 認識テキスト
 * @param {Array} fields 圃場マスタ（fieldsData）
 * @param {Object} machineMap 機械マスタ（machines）
 */
function parseVoiceCommand(text, fields = [], machineMap = {}) {
  const raw = String(text || '').trim();
  const norm = normalizeVoiceText_(raw);
  const result = {
    rawText: raw,
    normalizedText: norm,
    fieldIds: [],
    cat: null,
    duration: null,
    bags: null,
    dateOffset: null,
    machineId: null,
    weather: null,
    memo: '',
    labels: []
  };
  if (!norm) return result;

  // メモ部分（「メモ」「備考」「引き継ぎ」以降）は他項目の解析対象から外す
  let body = norm;
  const memoMatch = norm.match(/(メモ|備考|引き継ぎ|引継ぎ|ひきつぎ)[:：、,は]?(.*)$/);
  if (memoMatch) {
    body = norm.slice(0, memoMatch.index);
    const memoText = memoMatch[2].trim();
    result.memo = /引き?継/.test(memoMatch[1]) ? `【引き継ぎ】${memoText}` : memoText;
  }

  // ---- 圃場の特定 ----
  const fieldInfos = (fields || []).map(f => {
    const normName = normalizeFieldName_(f.name || '');
    return { f, normName, base: extractFieldBase_(normName) };
  });
  const bases = [...new Set(fieldInfos.map(fi => fi.base).filter(b => b && b.length >= 2))]
    .sort((a, b) => b.length - a.length);
  const selected = new Set();

  if (/(全圃場|全ての田|すべての田|全部の田|全筆)/.test(body)) {
    fieldInfos.forEach(fi => selected.add(fi.f.id));
  }

  // 団地・地区一括（「上山田団地」「本場全部」など）
  bases.forEach(base => {
    const re = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(団地|全部|全筆|すべて|ぜんぶ|全体|一帯|エリア|地区)`);
    if (re.test(body)) {
      fieldInfos
        .filter(fi => fi.normName.startsWith(base) || String(fi.f.groupName || '').includes(base) || String(fi.f.lot || '').includes(base))
        .forEach(fi => selected.add(fi.f.id));
    }
  });

  // 号数指定（範囲「1号から3号まで」・列挙「1号と2号」）
  const addByNumber = (base, n) => {
    fieldInfos.forEach(fi => {
      if (base) {
        if (fi.normName.includes(`${base}${n}号`)) selected.add(fi.f.id);
      } else if (new RegExp(`(^|[^0-9])${n}号`).test(fi.normName)) {
        selected.add(fi.f.id);
      }
    });
  };
  const numRe = /(\d+)号/g;
  let m;
  let prevEnd = 0;
  let prevNum = null;
  let currentBase = '';
  while ((m = numRe.exec(body)) !== null) {
    const n = Number(m[1]);
    const between = body.slice(prevEnd, m.index);
    let foundBase = '';
    let foundIdx = -1;
    bases.forEach(b => {
      const idx = between.lastIndexOf(b);
      if (idx > foundIdx) { foundIdx = idx; foundBase = b; }
    });
    const isRange = prevNum !== null && (!foundBase || foundBase === currentBase) && /(から|〜|~|-|－)/.test(between);
    if (foundBase) currentBase = foundBase;
    if (isRange && n > prevNum && n - prevNum <= 50) {
      for (let k = prevNum + 1; k <= n; k++) addByNumber(currentBase, k);
    } else {
      addByNumber(currentBase, n);
    }
    prevNum = n;
    prevEnd = m.index + m[0].length;
  }

  // 圃場名の完全一致（「上山田A」「大町」など号数を含まない名称）
  fieldInfos.forEach(fi => {
    const variants = [fi.normName, ...fi.normName.split('・')].filter(v => v && v.length >= 2 && !/^\d+号$/.test(v));
    if (variants.some(v => body.includes(v) && !/\d+号$/.test(v))) selected.add(fi.f.id);
  });

  result.fieldIds = (fields || []).filter(f => selected.has(f.id)).map(f => f.id);

  // ---- 作業分類 ----
  for (const [cat, re] of VOICE_CAT_RULES) {
    if (re.test(body)) { result.cat = cat; break; }
  }

  // ---- 作業時間 ----
  let dm;
  if ((dm = body.match(/(\d+(?:\.\d+)?)時間半/))) {
    result.duration = Number(dm[1]) + 0.5;
  } else if ((dm = body.match(/(\d+(?:\.\d+)?)時間(\d+)分/))) {
    result.duration = Number(dm[1]) + Number(dm[2]) / 60;
  } else if ((dm = body.match(/(\d+(?:\.\d+)?)時間/))) {
    result.duration = Number(dm[1]);
  } else if ((dm = body.match(/(\d+)分/))) {
    result.duration = Number(dm[1]) / 60;
  } else if (/半日/.test(body)) {
    result.duration = 4;
  } else if (/(1日|一日)(中|作業)/.test(body)) {
    result.duration = 8;
  }
  if (result.duration !== null) {
    result.duration = Math.max(0.5, Math.round(result.duration * 10) / 10);
  }

  // ---- 袋数 ----
  if ((dm = body.match(/(\d+)袋/))) result.bags = Number(dm[1]);

  // ---- 作業日 ----
  if (/(一昨日|おととい)/.test(body)) result.dateOffset = -2;
  else if (/(昨日|きのう)/.test(body)) result.dateOffset = -1;
  else if (/(今日|本日|きょう)/.test(body)) result.dateOffset = 0;

  // ---- 天候 ----
  for (const [w, re] of VOICE_WEATHER_RULES) {
    if (re.test(body)) { result.weather = w; break; }
  }

  // ---- 使用機械 ----
  const machList = Object.values(machineMap || {});
  for (const [re, keys] of VOICE_MACHINE_KEYWORDS) {
    if (!re.test(body)) continue;
    const hit = machList.find(mc => keys.some(k => String(mc.name || '').includes(k) || String(mc.category || '').includes(k)));
    if (hit) { result.machineId = hit.id; break; }
  }
  if (!result.machineId && /(手作業|機械なし|手で)/.test(body)) result.machineId = 'NONE';

  // ---- 解析結果ラベル ----
  const fieldNameMap = Object.fromEntries((fields || []).map(f => [f.id, f.name]));
  if (result.fieldIds.length > 0) result.labels.push(`📍 圃場: ${result.fieldIds.map(id => fieldNameMap[id]).join('・')}`);
  if (result.cat) result.labels.push(`🏷️ 作業: ${result.cat}`);
  if (result.duration !== null) result.labels.push(`⏱️ 時間: ${result.duration}h`);
  if (result.bags !== null) result.labels.push(`📦 袋数: ${result.bags}袋`);
  if (result.dateOffset !== null) result.labels.push(`📅 日付: ${['一昨日', '昨日', '今日'][result.dateOffset + 2]}`);
  if (result.weather) result.labels.push(`🌤️ 天候: ${result.weather}`);
  if (result.machineId) result.labels.push(`🚜 機械: ${result.machineId === 'NONE' ? '機械なし' : (machineMap[result.machineId]?.name || result.machineId)}`);
  if (result.memo) result.labels.push(`📔 メモ: ${result.memo}`);
  return result;
}

// =========================================================================
// 解析結果のフォーム反映
// =========================================================================
function applyVoiceCommandToForm(result) {
  if (!result) return 0;
  let applied = 0;

  if (result.fieldIds.length > 0) {
    selectedFieldIds = [...result.fieldIds];
    applied++;
  }
  if (result.cat) {
    selectWorkCat(result.cat);
    applied++;
  }
  if (result.duration !== null) {
    currentDuration = result.duration;
    const el = document.getElementById('durationValue');
    if (el) el.textContent = currentDuration.toFixed(1);
    applied++;
  }
  if (result.bags !== null) {
    const cat = result.cat || currentWorkCat;
    if (cat === '収穫') {
      currentHarvestBags = Math.max(10, result.bags);
      const el = document.getElementById('harvestBagValue');
      if (el) el.textContent = currentHarvestBags;
    } else {
      currentBags = Math.max(1, result.bags);
      const el = document.getElementById('bagCountValue');
      if (el) el.textContent = currentBags;
    }
    applied++;
  }
  if (result.dateOffset !== null) {
    const d = new Date();
    d.setDate(d.getDate() + result.dateOffset);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const el = document.getElementById('workDateInput');
    if (el) el.value = iso;
    applied++;
  }
  if (result.weather) {
    const el = document.getElementById('workWeatherSelect');
    if (el && [...el.options].some(o => o.value === result.weather)) {
      el.value = result.weather;
      applied++;
    }
  }
  if (result.machineId) {
    const el = document.getElementById('machineSelect');
    if (el && [...el.options].some(o => o.value === result.machineId)) {
      el.value = result.machineId;
      applied++;
    }
  }
  if (result.memo) {
    const el = document.getElementById('workDiaryMemoInput');
    if (el) {
      const cur = el.value.trim();
      el.value = cur ? `${cur} ／ ${result.memo}` : result.memo;
      applied++;
    }
  }

  renderInputFieldGrid();
  recalculatePreview();
  return applied;
}

// =========================================================================
// Web Speech API ラッパー
// =========================================================================
const VoiceState = {
  recognizer: null,
  mode: null, // 'command' | 'memo'
  listening: false,
  lastResult: null,
  interim: ''
};

function getSpeechRecognitionCtor_() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isVoiceRecognitionSupported() {
  return !!getSpeechRecognitionCtor_();
}

function stopVoiceRecognition() {
  if (VoiceState.recognizer) {
    try { VoiceState.recognizer.stop(); } catch (e) {}
  }
}

function startVoiceRecognition_(mode) {
  const Ctor = getSpeechRecognitionCtor_();
  if (!Ctor) {
    showToast('🎤 このブラウザは音声認識に未対応です', 'Chrome / Edge / Safari（iPhone）をご利用ください。下の入力欄に文章を打ち込んでも同じように解析できます。');
    return false;
  }
  if (typeof isOfflineMode !== 'undefined' && isOfflineMode) {
    showToast('📡 圏外モード中は音声認識を利用できません', '音声認識はブラウザのクラウド認識を使うため、電波のある場所でお使いください（文章入力は圏外でも使えます）。');
    return false;
  }
  if (VoiceState.listening) stopVoiceRecognition();

  const rec = new Ctor();
  rec.lang = 'ja-JP';
  rec.interimResults = true;
  rec.continuous = mode === 'memo';
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const transcript = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) {
        finalText += transcript;
        if (mode === 'memo') appendMemoTranscript_(transcript);
      } else {
        interim += transcript;
      }
    }
    VoiceState.interim = interim;
    renderVoiceLiveText_(mode === 'memo' ? interim : (finalText + interim));
  };
  rec.onerror = (ev) => {
    const messages = {
      'not-allowed': 'マイクの使用が許可されていません。ブラウザのアドレスバー横の設定からマイクを「許可」にしてください。',
      'service-not-allowed': 'マイクの使用が許可されていません。端末の設定をご確認ください。',
      'no-speech': '音声が聞き取れませんでした。マイクに近づいてもう一度お話しください。',
      'network': '音声認識サーバーに接続できません。電波状況をご確認ください。',
      'audio-capture': 'マイクが見つかりません。'
    };
    if (ev.error !== 'aborted') {
      showToast('🎤 音声認識エラー', messages[ev.error] || `エラー: ${ev.error}`);
    }
  };
  rec.onend = () => {
    VoiceState.listening = false;
    VoiceState.recognizer = null;
    updateVoiceButtonsState_();
    if (mode === 'command' && finalText.trim()) {
      const input = document.getElementById('voiceTextInput');
      if (input) input.value = finalText.trim();
      runVoiceCommandText_(finalText.trim(), true);
    }
    if (mode === 'memo') renderVoiceLiveText_('');
  };

  try {
    rec.start();
  } catch (e) {
    showToast('🎤 音声認識を開始できませんでした', String(e && e.message ? e.message : e));
    return false;
  }
  VoiceState.recognizer = rec;
  VoiceState.mode = mode;
  VoiceState.listening = true;
  if (navigator.vibrate) navigator.vibrate(30);
  updateVoiceButtonsState_();
  return true;
}

function appendMemoTranscript_(transcript) {
  const el = document.getElementById('workDiaryMemoInput');
  if (!el) return;
  const t = String(transcript || '').trim();
  if (!t) return;
  const cur = el.value.trim();
  el.value = cur ? `${cur} ${t}` : t;
  recalculatePreview();
}

function renderVoiceLiveText_(text) {
  const live = document.getElementById(VoiceState.mode === 'memo' ? 'memoVoiceLiveText' : 'voiceLiveText');
  if (!live) return;
  live.textContent = text || (VoiceState.listening ? '🎙️ 聞き取り中…' : '');
}

function updateVoiceButtonsState_() {
  const listeningCmd = VoiceState.listening && VoiceState.mode === 'command';
  const listeningMemo = VoiceState.listening && VoiceState.mode === 'memo';

  const mainMic = document.getElementById('voiceMicMainBtn');
  if (mainMic) {
    mainMic.classList.toggle('voice-listening', listeningCmd);
    mainMic.setAttribute('aria-pressed', listeningCmd ? 'true' : 'false');
    const label = document.getElementById('voiceMicMainLabel');
    if (label) label.textContent = listeningCmd ? '聞き取り中…（タップで停止）' : 'タップして話す';
  }
  const memoBtn = document.getElementById('memoVoiceBtn');
  if (memoBtn) {
    memoBtn.classList.toggle('voice-listening', listeningMemo);
    memoBtn.textContent = listeningMemo ? '⏹️ 書き起こし停止' : '🎤 音声でメモ';
  }
  document.querySelectorAll('[data-voice-indicator]').forEach(el => {
    el.classList.toggle('voice-listening', VoiceState.listening);
  });
  if (VoiceState.listening) renderVoiceLiveText_('');
}

// =========================================================================
// UI（音声入力パネル）
// =========================================================================
function openVoiceInputModal() {
  if (typeof switchMainTab === 'function') switchMainTab('input');
  ModalManager.open('voiceInputModal');
  const support = document.getElementById('voiceSupportStatus');
  if (support) {
    support.textContent = isVoiceRecognitionSupported()
      ? '✅ この端末は音声認識に対応しています（オンライン時に利用可能）'
      : '⚠️ このブラウザは音声認識に未対応です。下の欄に文章を入力すると同じように解析できます。';
    support.className = isVoiceRecognitionSupported()
      ? 'text-[11px] font-semibold text-emerald-600'
      : 'text-[11px] font-semibold text-amber-600';
  }
  renderVoiceParseResult_(VoiceState.lastResult);
}

function closeVoiceInputModal() {
  stopVoiceRecognition();
  ModalManager.close('voiceInputModal');
}

function toggleVoiceCommandListening() {
  if (VoiceState.listening && VoiceState.mode === 'command') {
    stopVoiceRecognition();
    return;
  }
  startVoiceRecognition_('command');
}

function toggleMemoDictation() {
  if (VoiceState.listening && VoiceState.mode === 'memo') {
    stopVoiceRecognition();
    return;
  }
  startVoiceRecognition_('memo');
}

function runVoiceCommandText_(text, autoApply) {
  const result = parseVoiceCommand(text, fieldsData, machines);
  VoiceState.lastResult = result;
  renderVoiceParseResult_(result);
  if (autoApply && result.labels.length > 0) {
    const n = applyVoiceCommandToForm(result);
    showToast(`🎤 音声の内容を ${n} 項目フォームへ反映しました`, result.labels.join(' ／ '));
  }
  return result;
}

function parseVoiceTextFromInput() {
  const input = document.getElementById('voiceTextInput');
  const text = input ? input.value.trim() : '';
  if (!text) {
    showToast('🎤 入力が空です', '例：「本場1号から3号まで草刈り2時間」');
    return;
  }
  runVoiceCommandText_(text, true);
}

function useVoiceExample(text) {
  const input = document.getElementById('voiceTextInput');
  if (input) input.value = text;
  runVoiceCommandText_(text, true);
}

function applyVoiceResultAndSubmit() {
  const result = VoiceState.lastResult;
  if (!result || result.labels.length === 0) {
    showToast('🎤 先に音声または文章で内容を入力してください', '例：「上山田団地 防除 1時間半 ドローン」');
    return;
  }
  closeVoiceInputModal();
  submitUnifiedWorkLog();
}

function renderVoiceParseResult_(result) {
  const box = document.getElementById('voiceParseResult');
  const submitBtn = document.getElementById('voiceSubmitBtn');
  if (!box) return;
  if (!result || !result.rawText) {
    box.innerHTML = '<div class="text-xs text-[var(--muted-foreground)]">まだ解析結果はありません。マイクボタンを押して話すか、文章を入力してください。</div>';
    if (submitBtn) submitBtn.disabled = true;
    return;
  }
  const chips = result.labels.length > 0
    ? result.labels.map(l => safeHtml`<span class="inline-block px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 text-xs font-bold">${l}</span>`).join('')
    : '<span class="text-xs font-bold text-amber-600">⚠️ 圃場名・作業名・時間などを読み取れませんでした。言い方を変えてお試しください。</span>';
  const fieldHint = (result.fieldIds.length === 0 && fieldsData.length > 0)
    ? '<div class="text-[11px] text-[var(--muted-foreground)] mt-1">※ 圃場が特定できない場合は、現在選択中の圃場のまま登録されます。</div>'
    : '';
  box.innerHTML = safeHtml`
    <div class="text-[11px] text-[var(--muted-foreground)] mb-1.5">認識テキスト：「${result.rawText}」</div>
    <div class="flex flex-wrap gap-1.5">${rawHtml(chips)}</div>
    ${rawHtml(fieldHint)}
  `;
  if (submitBtn) submitBtn.disabled = result.labels.length === 0;
}
