// =========================================================================
// Feature: TSK-039 AI営農アドバイザー ＆ 今週の重点ToDoリスト自動提案
//   - TSK-039-1: 日誌メモ・見回りアラートのテキスト解析＆課題スコア化
//   - TSK-039-2: 生育ステージ（積算温度）・気象予察・実績ベースのタスク推論
//   - TSK-039-3: 「今週の重点ToDoリスト」生成UI ＆ 1タップ作業入力転送
//   - (TSK-039-4: Web Speech API 音声書き起こしは voiceInput.js にて実装済)
// =========================================================================

const AI_MEMO_KEYWORDS = [
  { key: 'water', label: '💧 水管理・水漏れ', cat: '草刈り', weight: 30, re: /(水漏れ|漏水|落水|水口|水尻|渇水|干割れ|中干し)/ },
  { key: 'animal', label: '🐗 獣害・畦畔損傷', cat: '草刈り', weight: 35, re: /(獣害|イノシシ|猪|シカ|鹿|掘り|侵入|畦畔崩)/ },
  { key: 'weed', label: '🌿 雑草・ヒエ・畦畔草', cat: '草刈り', weight: 25, re: /(雑草|ヒエ|稗|草丈高|草伸び|草刈|畦畔)/ },
  { key: 'pest', label: '🐛 病害虫・斑点米', cat: '防除', weight: 35, re: /(いもち|カメムシ|ウンカ|虫|病害|変色|防除)/ },
  { key: 'fert', label: '🧪 葉色・追肥・倒伏', cat: '施肥', weight: 25, re: /(葉色|追肥|穂肥|倒伏|生育遅|窒素|肥料)/ },
  { key: 'handover', label: '📌 引き継ぎ事項', cat: '草刈り', weight: 20, re: /(引き継ぎ|引継ぎ|要確認|次回|至急|注意)/ }
];

/**
 * TSK-039-1: 日誌メモ・見回りアラートのテキスト解析＆圃場別課題スコア化
 */
function analyzeFieldMemosAndAlerts(fields = [], logs = []) {
  const fieldMap = {};
  (fields || []).forEach(f => {
    fieldMap[f.id] = { fieldId: f.id, fieldName: f.name, score: 0, tags: [], snippets: [] };
  });

  // 1. 圃場カルテの未解決見回りアラートを解析
  (fields || []).forEach(f => {
    const rec = fieldMap[f.id];
    (f.alerts || []).forEach(a => {
      const txt = String(a.text || a.tag || '').trim();
      if (!txt) return;
      let matched = false;
      AI_MEMO_KEYWORDS.forEach(kw => {
        if (kw.re.test(txt)) {
          rec.score += kw.weight + 15; // 未解決アラートは高優先
          if (!rec.tags.includes(kw.label)) rec.tags.push(kw.label);
          matched = true;
        }
      });
      if (!matched) rec.score += 25;
      rec.snippets.push({ source: '見回りアラート', date: a.date || '', text: txt });
    });
  });

  // 2. 作業日誌の自由メモを解析（直近30件を対象）
  (logs || []).slice(0, 30).forEach(l => {
    const memo = String(l.memo || '').trim();
    if (!memo) return;
    const hitKeywords = AI_MEMO_KEYWORDS.filter(kw => kw.re.test(memo));
    if (hitKeywords.length === 0) return;

    (l.fieldIds || []).forEach(fid => {
      const rec = fieldMap[fid];
      if (!rec) return;
      hitKeywords.forEach(kw => {
        rec.score += kw.weight;
        if (!rec.tags.includes(kw.label)) rec.tags.push(kw.label);
      });
      rec.snippets.push({ source: '日誌メモ', date: l.date || '', text: memo });
    });
  });

  return Object.values(fieldMap).sort((a, b) => b.score - a.score);
}

/**
 * TSK-039-2: 生育ステージ・気象予察・メモ解析から「今週の重点ToDoリスト」を推論
 */
function generateWeeklyAiTasks(fields = [], logs = [], weatherData = null) {
  const tasks = [];
  const analysis = analyzeFieldMemosAndAlerts(fields, logs);
  const fieldLookup = Object.fromEntries((fields || []).map(f => [f.id, f]));

  // (1) 未解決アラート・メモ課題からの緊急タスク生成
  analysis.forEach(item => {
    if (item.score <= 0 || item.snippets.length === 0) return;
    const latest = item.snippets[0];
    const matchedKw = AI_MEMO_KEYWORDS.find(kw => kw.re.test(latest.text)) || AI_MEMO_KEYWORDS[5];
    const priority = item.score >= 50 ? 'high' : 'medium';
    tasks.push({
      id: `AI-MEMO-${item.fieldId}`,
      priority,
      score: item.score + 20,
      badge: priority === 'high' ? '🔴 最優先' : '🟠 優先対応',
      title: `${item.fieldName}：${matchedKw.label}の現地対応`,
      reason: `${latest.source}(${latest.date || '直近'})「${latest.text.slice(0, 40)}」を検出`,
      fieldIds: [item.fieldId],
      suggestedCat: matchedKw.cat,
      suggestedMemo: `【AI提案対応】${latest.text.slice(0, 50)}`
    });
  });

  // (2) 生育ステージ（出穂後積算温度 1,000℃）ベースの刈取・落水タスク推論
  (fields || []).forEach(f => {
    if (typeof calcAccumulatedTempStats !== 'function') return;
    const tStats = calcAccumulatedTempStats(f);
    const doneHarvest = Array.isArray(f.doneCats) && f.doneCats.includes('収穫');
    if (doneHarvest) return;

    if (tStats.progressPct >= 95) {
      tasks.push({
        id: `AI-HARV-${f.id}`,
        priority: 'high',
        score: 90,
        badge: '🔴 刈取適期',
        title: `${f.name}：刈取・収穫作業の着手推奨`,
        reason: `出穂後積算温度 ${tStats.accumulatedC}℃（目標${tStats.targetC}℃の${tStats.progressPct}%到達）`,
        fieldIds: [f.id],
        suggestedCat: '収穫',
        suggestedMemo: `積算温度${tStats.accumulatedC}℃到達により適期収穫実施`
      });
    } else if (tStats.progressPct >= 82 && tStats.remainingDays <= 10) {
      tasks.push({
        id: `AI-DRAIN-${f.id}`,
        priority: 'medium',
        score: 65,
        badge: '🟠 落水・準備',
        title: `${f.name}：落水確認・刈取準備（あと約${tStats.remainingDays}日）`,
        reason: `予測刈取適期 ${tStats.predictedHarvestDate}（現在 ${tStats.accumulatedC}℃）`,
        fieldIds: [f.id],
        suggestedCat: '草刈り',
        suggestedMemo: `刈取前落水・枕地確認（予測適期 ${tStats.predictedHarvestDate}）`
      });
    }
  });

  // (3) 気象API予察（高温登熟・いもち病・カメムシ・ドローン風速）連動タスク
  if (weatherData && typeof evaluateHeatRipeningRisk === 'function' && typeof evaluatePestAndDroneRisk === 'function') {
    const heat = evaluateHeatRipeningRisk(weatherData);
    const pest = evaluatePestAndDroneRisk(weatherData);
    const allIds = (fields || []).map(f => f.id);

    if (heat.level === 'danger' && allIds.length > 0) {
      tasks.push({
        id: 'AI-WEATHER-HEAT',
        priority: 'high',
        score: 95,
        badge: '🔴 高温対策',
        title: '全圃場：夜間かけ流し灌漑・深水管理（高温登熟障害対策）',
        reason: `気象AI予察：${heat.badge}（平均${heat.avgMeanTemp}℃ / 35℃超${heat.daysOver35}日）`,
        fieldIds: allIds.slice(0, 5),
        suggestedCat: '草刈り',
        suggestedMemo: '高温登熟対策のため夜間入水・深水管理を実施'
      });
    }
    if ((pest.blast.level === 'danger' || pest.stinkBug.level === 'danger') && allIds.length > 0) {
      const targetPest = pest.blast.level === 'danger' ? 'いもち病予防防除' : '斑点米カメムシ防除';
      const windNote = pest.drone.ok ? `現在風速${pest.drone.windSpeed}m/s（ドローン散布可）` : `現在強風${pest.drone.windSpeed}m/s（風収まり次第実施）`;
      tasks.push({
        id: 'AI-WEATHER-PEST',
        priority: 'high',
        score: 88,
        badge: '🔴 病害虫予察',
        title: `重点圃場：${targetPest}の検討`,
        reason: `${pest.blast.level === 'danger' ? pest.blast.badge : pest.stinkBug.badge} ／ ${windNote}`,
        fieldIds: allIds.slice(0, 3),
        suggestedCat: '防除',
        suggestedMemo: `気象AI予察に基づく${targetPest}`
      });
    }
  }

  // (4) 未着手工程（草刈り・施肥未実施）の補完提案
  const unmowed = (fields || []).filter(f => !(f.doneCats || []).includes('草刈り'));
  if (unmowed.length > 0 && tasks.length < 4) {
    tasks.push({
      id: 'AI-CAT-MOW',
      priority: 'low',
      score: 40,
      badge: '🟡 計画作業',
      title: `未実施 ${unmowed.length}筆：畦畔草刈りの計画実施`,
      reason: `対象：${unmowed.slice(0, 3).map(f => f.name).join('・')}${unmowed.length > 3 ? ' ほか' : ''}`,
      fieldIds: unmowed.slice(0, 4).map(f => f.id),
      suggestedCat: '草刈り',
      suggestedMemo: 'AI提案：未実施圃場の畦畔草刈り'
    });
  }

  return tasks.sort((a, b) => b.score - a.score).slice(0, 6);
}

function toggleAiAdvisorPanel() {
  UiState.aiAdvisorOpen = !UiState.aiAdvisorOpen;
  renderAiAdvisorPanel();
}

/**
 * TSK-039-3: AI提案タスクを1タップで作業入力フォームへ転送
 */
function applyAiTaskToInput(taskIndex) {
  const task = (UiState.aiGeneratedTasks || [])[Number(taskIndex)];
  if (!task) return;

  if (typeof switchMainTab === 'function') switchMainTab('input');
  if (Array.isArray(task.fieldIds) && task.fieldIds.length > 0) {
    selectedFieldIds = task.fieldIds.filter(id => fieldsData.some(f => f.id === id));
  }
  if (task.suggestedCat && typeof selectWorkCat === 'function') {
    selectWorkCat(task.suggestedCat);
  }
  const memoEl = document.getElementById('workDiaryMemoInput');
  if (memoEl && task.suggestedMemo) {
    memoEl.value = task.suggestedMemo;
  }
  if (typeof renderInputFieldGrid === 'function') renderInputFieldGrid();
  if (typeof recalculatePreview === 'function') recalculatePreview();

  const inputSec = document.getElementById('tab-input');
  if (inputSec && typeof inputSec.scrollIntoView === 'function') {
    inputSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (typeof showToast === 'function') {
    showToast(`🧠 AI提案タスクを入力フォームへセットしました`, `${task.title}（内容を確認して「一括登録」を押してください）`);
  }
}

/**
 * TSK-039-3: 「今週の重点ToDoリスト」＆ 日誌メモ解析要約パネル描画
 */
function renderAiAdvisorPanel() {
  const host = document.getElementById('aiAdvisorPanel');
  if (!host) return;

  const analysis = analyzeFieldMemosAndAlerts(fieldsData, workLogs);
  const tasks = generateWeeklyAiTasks(fieldsData, workLogs, UiState.weatherDataState);
  UiState.aiGeneratedTasks = tasks;

  const flaggedFields = analysis.filter(a => a.score > 0);
  const memoSummaryText = flaggedFields.length > 0
    ? `メモ・見回り解析：要注目 ${flaggedFields.length}筆（${flaggedFields.slice(0, 3).map(a => `${a.fieldName}:${a.tags[0] || '要確認'}`).join(' ／ ')}）`
    : 'メモ・見回り解析：現在緊急の異常キーワードはありません';

  const taskCardsHtml = tasks.length > 0
    ? tasks.map((t, idx) => {
      const borderCls = t.priority === 'high'
        ? 'border-red-500/40 bg-red-500/5'
        : (t.priority === 'medium' ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border)] bg-[var(--background)]');
      return safeHtml`
        <div class="p-3 rounded-2xl border ${borderCls} flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--card)] border border-[var(--border)]">${t.badge}</span>
              <span class="text-xs font-bold text-[var(--foreground)]">${t.title}</span>
            </div>
            <div class="text-[11px] text-[var(--muted-foreground)] mt-1">${t.reason}</div>
          </div>
          <button type="button" data-action="applyAiTaskToInput" data-arg="${idx}" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition shrink-0 shadow-sm">
            ⚡ 1タップで入力へセット
          </button>
        </div>
      `;
    }).join('')
    : '<div class="text-xs text-[var(--muted-foreground)] p-2">現在提案中の優先タスクはありません。圃場や日誌が蓄積されると自動で次週タスクを提案します。</div>';

  host.innerHTML = safeHtml`
    <div class="flex items-center justify-between flex-wrap gap-2 px-4 py-3 bg-indigo-600/10 border-b border-indigo-500/20">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">AI ADVISOR</span>
        <h3 class="text-xs md:text-sm font-bold text-[var(--foreground)]">🧠 今週の重点ToDoリスト ＆ 日誌メモ自動解析（${tasks.length}件提案）</h3>
      </div>
      <button type="button" data-action="toggleAiAdvisorPanel" class="px-2.5 py-1 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[11px] font-bold text-[var(--foreground)] hover:opacity-80">
        ${UiState.aiAdvisorOpen ? '▲ 折りたたむ' : '▼ 提案を見る'}
      </button>
    </div>
    ${rawHtml(UiState.aiAdvisorOpen ? safeHtml`
      <div class="p-4 space-y-2.5">
        <div class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-xl">
          📝 ${memoSummaryText}
        </div>
        <div class="space-y-2">
          ${rawHtml(taskCardsHtml)}
        </div>
      </div>
    ` : '')}
  `;
}

registerActionHandlers({
  toggleAiAdvisorPanel: () => toggleAiAdvisorPanel(),
  applyAiTaskToInput: (el) => applyAiTaskToInput(el.dataset.arg)
});
