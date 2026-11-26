// =========================================================================
// Feature: TSK-031 複数スタッフ間のリアルタイム作業指示・進捗共有
//   - 管理者が朝にマップ／圃場選択から対象圃場を指定して作業指示を発行
//   - 作業者が「✅ 完了タップ」で即時共有（GAS doPost/doGet 連動）
// =========================================================================

window._teamDispatchOpen = true;
window._teamDispatchFilter = 'ALL'; // 'ALL' | 'PENDING' | 'DONE'

/**
 * ローカルとクラウド(GAS)の作業指示配列を orderId で安全マージ（純関数・単体テスト対象）
 */
function mergeWorkOrders_(localList = [], remoteList = []) {
  const map = {};
  (localList || []).forEach(o => {
    if (o && o.id) map[o.id] = { ...o };
  });
  (remoteList || []).forEach(ro => {
    if (!ro || !ro.id) return;
    const prev = map[ro.id];
    if (!prev) {
      map[ro.id] = { ...ro };
      return;
    }
    // どちらかが DONE になっていれば DONE 優先、または新しいタイムスタンプ優先
    const prevTs = String(prev.completedAt || prev.createdAt || '');
    const remTs = String(ro.completedAt || ro.createdAt || '');
    if (ro.status === 'DONE' && prev.status !== 'DONE') {
      map[ro.id] = { ...prev, ...ro };
    } else if (remTs >= prevTs) {
      map[ro.id] = { ...prev, ...ro };
    }
  });
  return Object.values(map).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function createTeamWorkOrder() {
  const dateEl = document.getElementById('dispatchDateInput');
  const catEl = document.getElementById('dispatchCatSelect');
  const assigneeEl = document.getElementById('dispatchAssigneeInput');
  const noteEl = document.getElementById('dispatchNoteInput');

  const targetDate = (dateEl && dateEl.value) ? dateEl.value.replace(/-/g, '/') : (typeof getTodayIsoDate === 'function' ? getTodayIsoDate().replace(/-/g, '/') : '2026/11/26');
  const cat = catEl ? catEl.value : '草刈り';
  const assignee = (assigneeEl && assigneeEl.value.trim()) ? assigneeEl.value.trim() : '全員';
  const note = noteEl ? noteEl.value.trim() : '';

  // 選択中の圃場（未選択ならGISで現在閲覧中の圃場）を対象にする
  let targetIds = Array.isArray(selectedFieldIds) && selectedFieldIds.length > 0
    ? [...selectedFieldIds]
    : (currentInspectedFieldId ? [currentInspectedFieldId] : []);
  targetIds = targetIds.filter(id => fieldsData.some(f => f.id === id));

  if (targetIds.length === 0) {
    showToast('⚠️ 対象圃場を選択してください', 'マップで圃場をタップするか、タブ1で対象圃場を選んでから作業指示を発行してください。');
    return;
  }

  const creator = document.getElementById('workerNameInput')?.value?.trim() || '管理者';
  const newOrder = {
    id: `WO-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    targetDate,
    cat,
    assignee,
    fieldIds: targetIds,
    note,
    status: 'PENDING',
    createdBy: creator,
    createdAt: new Date().toISOString(),
    completedBy: '',
    completedAt: ''
  };

  if (!Array.isArray(workOrders)) workOrders = [];
  workOrders.unshift(newOrder);
  if (noteEl) noteEl.value = '';

  saveStateToStorage();
  renderTeamDispatchPanel();
  syncTeamOrdersWithGas('push', true);

  const fNames = targetIds.map(id => fieldsData.find(f => f.id === id)?.name || id).join('・');
  showToast(`📢 作業指示を発行しました（担当：${assignee}）`, `${cat} ／ 対象：${fNames}`);
}

function toggleTeamWorkOrderDone(orderId) {
  if (!Array.isArray(workOrders)) return;
  const order = workOrders.find(o => o.id === orderId);
  if (!order) return;

  const actor = document.getElementById('workerNameInput')?.value?.trim() || order.assignee || '作業者';
  if (order.status === 'DONE') {
    order.status = 'PENDING';
    order.completedBy = '';
    order.completedAt = '';
  } else {
    order.status = 'DONE';
    order.completedBy = actor;
    order.completedAt = new Date().toISOString();
  }

  saveStateToStorage();
  renderTeamDispatchPanel();
  syncTeamOrdersWithGas('push', true);

  showToast(
    order.status === 'DONE' ? `✅ 作業指示を完了にしました（${actor}）` : '↩️ 作業指示を未完了に戻しました',
    gasWebhookUrl && !isOfflineMode ? 'クラウド（スプレッドシート）へ進捗を即時共有しました。' : '端末内に保存しました（オンライン同期時にチームへ共有されます）。'
  );
}

function jumpToInputFromWorkOrder(orderId) {
  const order = (workOrders || []).find(o => o.id === orderId);
  if (!order) return;

  if (typeof switchMainTab === 'function') switchMainTab('input');
  selectedFieldIds = (order.fieldIds || []).filter(id => fieldsData.some(f => f.id === id));
  if (typeof selectWorkCat === 'function') selectWorkCat(order.cat || '草刈り');
  if (order.assignee && order.assignee !== '全員') {
    const wEl = document.getElementById('workerNameInput');
    if (wEl) wEl.value = order.assignee;
  }
  const memoEl = document.getElementById('workDiaryMemoInput');
  if (memoEl) {
    memoEl.value = order.note ? `【作業指示】${order.note}` : `【作業指示】${order.cat}（指示者:${order.createdBy || '管理者'}）`;
  }
  if (typeof renderInputFieldGrid === 'function') renderInputFieldGrid();
  if (typeof recalculatePreview === 'function') recalculatePreview();
  showToast('📱 作業指示を入力フォームへセットしました', '内容を確認して「一括登録」を押してください。');
}

function deleteTeamWorkOrder(orderId) {
  if (!Array.isArray(workOrders)) return;
  workOrders = workOrders.filter(o => o.id !== orderId);
  saveStateToStorage();
  renderTeamDispatchPanel();
}

function setTeamDispatchFilter(filterVal) {
  window._teamDispatchFilter = filterVal || 'ALL';
  renderTeamDispatchPanel();
}

function toggleTeamDispatchPanel() {
  window._teamDispatchOpen = !window._teamDispatchOpen;
  renderTeamDispatchPanel();
}

/**
 * GAS バックエンドと作業指示をリアルタイム送受信
 * @param {'push'|'pull'} mode
 * @param {boolean} silent
 */
async function syncTeamOrdersWithGas(mode = 'pull', silent = false) {
  if (typeof isOfflineMode !== 'undefined' && isOfflineMode) {
    if (!silent) showToast('📡 オフラインモード中です', 'オンライン復帰後にチーム作業指示を同期してください。');
    return;
  }
  const url = gasWebhookUrl;
  if (!url) {
    if (!silent) showToast('⚙️ GASウェブアプリURLが未設定です', 'タブ5でGAS URLとトークンを設定すると、複数スタッフ間でリアルタイム共有できます。');
    return;
  }

  try {
    if (mode === 'push') {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: gasSyncToken, fields: [], logs: [], workOrders: workOrders || [] })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(json.message || 'GAS error');
      if (!silent) showToast('☁️ チーム作業指示をクラウドへ送信しました', `共有件数：${(workOrders || []).length}件`);
    } else {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}action=masters&token=${encodeURIComponent(gasSyncToken || '')}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(json.message || 'GAS error');
      if (Array.isArray(json.workOrders)) {
        workOrders = mergeWorkOrders_(workOrders || [], json.workOrders);
        saveStateToStorage();
        renderTeamDispatchPanel();
      }
      if (!silent) showToast('🔄 チームの最新作業指示・進捗を受信しました', `取得件数：${Array.isArray(json.workOrders) ? json.workOrders.length : 0}件`);
    }
  } catch (err) {
    if (!silent) showToast('⚠️ チーム共有同期エラー', String(err && err.message ? err.message : err));
  }
}

function renderTeamDispatchPanel() {
  const host = document.getElementById('teamDispatchPanel');
  if (!host) return;

  const orders = Array.isArray(workOrders) ? workOrders : [];
  const pendingCnt = orders.filter(o => o.status !== 'DONE').length;
  const doneCnt = orders.filter(o => o.status === 'DONE').length;
  const filtered = orders.filter(o => {
    if (window._teamDispatchFilter === 'PENDING') return o.status !== 'DONE';
    if (window._teamDispatchFilter === 'DONE') return o.status === 'DONE';
    return true;
  });

  const targetPreviewNames = (selectedFieldIds && selectedFieldIds.length > 0 ? selectedFieldIds : (currentInspectedFieldId ? [currentInspectedFieldId] : []))
    .map(id => fieldsData.find(f => f.id === id)?.name)
    .filter(Boolean);

  const cardsHtml = filtered.length > 0
    ? filtered.map(o => {
      const isDone = o.status === 'DONE';
      const fNames = (o.fieldIds || []).map(id => fieldsData.find(f => f.id === id)?.name || id).join('・');
      const cardCls = isDone
        ? 'border-emerald-500/30 bg-emerald-500/5 opacity-80'
        : 'border-amber-500/40 bg-amber-500/10';
      const doneTimeStr = o.completedAt ? String(o.completedAt).slice(11, 16) : '';
      return safeHtml`
        <div class="p-3 rounded-2xl border ${cardCls} flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div class="min-w-0 space-y-0.5">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isDone ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'}">${isDone ? '✅ 完了' : '🕒 未完了'}</span>
              <span class="font-bold text-[var(--foreground)]">${o.targetDate} ／ ${o.cat}</span>
              <span class="px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[10px] font-bold">担当: ${o.assignee}</span>
            </div>
            <div class="text-xs font-semibold text-[var(--foreground)]">📍 ${fNames || '圃場未指定'}</div>
            ${rawHtml(o.note ? safeHtml`<div class="text-[11px] text-[var(--muted-foreground)]">💬 ${o.note}</div>` : '')}
            ${rawHtml(isDone ? safeHtml`<div class="text-[10px] text-emerald-700 font-bold">完了者: ${o.completedBy || o.assignee} (${doneTimeStr})</div>` : '')}
          </div>
          <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
            <button type="button" data-action="jumpToInputFromWorkOrder" data-arg="${o.id}" class="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold">📱 日誌入力へ</button>
            <button type="button" data-action="toggleTeamWorkOrderDone" data-arg="${o.id}" class="px-2.5 py-1.5 rounded-xl ${isDone ? 'bg-[var(--secondary)] text-[var(--secondary-foreground)]' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} text-[11px] font-bold">
              ${isDone ? '↩️ 未完了へ' : '✅ 完了タップ'}
            </button>
            <button type="button" data-action="deleteTeamWorkOrder" data-arg="${o.id}" class="px-2 py-1.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 text-[11px] font-bold">🗑️</button>
          </div>
        </div>
      `;
    }).join('')
    : '<div class="text-xs text-[var(--muted-foreground)] p-3 text-center">表示する作業指示はありません。上から朝礼・作業指示を発行できます。</div>';

  const todayIso = typeof getTodayIsoDate === 'function' ? getTodayIsoDate() : '2026-11-26';

  host.innerHTML = safeHtml`
    <div class="flex items-center justify-between flex-wrap gap-2 px-4 py-3 bg-sky-600/10 border-b border-sky-500/20">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-2 py-0.5 rounded-full bg-sky-600 text-white text-[10px] font-bold">TEAM DISPATCH</span>
        <h3 class="text-xs md:text-sm font-bold text-[var(--foreground)]">👥 複数スタッフ 作業指示・リアルタイム進捗共有（未完了 ${pendingCnt}件 ／ 完了 ${doneCnt}件）</h3>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" data-action="syncTeamOrdersWithGas" data-arg="pull" class="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold">🔄 最新指示を受信</button>
        <button type="button" data-action="toggleTeamDispatchPanel" class="px-2.5 py-1 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[11px] font-bold">
          ${window._teamDispatchOpen ? '▲ 折りたたむ' : '▼ 開く'}
        </button>
      </div>
    </div>
    ${rawHtml(window._teamDispatchOpen ? safeHtml`
      <div class="p-4 space-y-3">
        <div class="p-3 rounded-2xl bg-[var(--background)] border border-[var(--border)] space-y-2 text-xs">
          <div class="flex items-center justify-between flex-wrap gap-1">
            <span class="font-bold text-sky-700">📢 新しい作業指示を発行（選択中：${targetPreviewNames.length > 0 ? targetPreviewNames.join('・') : 'マップで圃場をタップしてください'}）</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <input type="date" id="dispatchDateInput" value="${todayIso}" class="px-2.5 py-1.5 rounded-xl bg-[var(--card)] border border-[var(--border)] text-xs font-bold">
            <select id="dispatchCatSelect" class="px-2.5 py-1.5 rounded-xl bg-[var(--card)] border border-[var(--border)] text-xs font-bold">
              <option value="草刈り">🌿 草刈り</option>
              <option value="施肥">🧪 施肥</option>
              <option value="防除">🛡️ 防除</option>
              <option value="耕起">🚜 耕起</option>
              <option value="代かき">🌊 代かき</option>
              <option value="田植え">🌱 田植え</option>
              <option value="収穫">🌾 収穫</option>
            </select>
            <input type="text" id="dispatchAssigneeInput" placeholder="担当（例: 高橋 誠）" class="px-2.5 py-1.5 rounded-xl bg-[var(--card)] border border-[var(--border)] text-xs">
            <input type="text" id="dispatchNoteInput" placeholder="指示メモ（例: 午前中に水口確認）" class="px-2.5 py-1.5 rounded-xl bg-[var(--card)] border border-[var(--border)] text-xs">
            <button type="button" data-action="createTeamWorkOrder" class="col-span-2 sm:col-span-1 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold shadow-sm">📢 指示を発行</button>
          </div>
        </div>

        <div class="flex items-center gap-1.5 text-xs">
          <button type="button" data-action="setTeamDispatchFilter" data-arg="ALL" class="px-2.5 py-1 rounded-lg font-bold ${window._teamDispatchFilter === 'ALL' ? 'bg-sky-600 text-white' : 'bg-[var(--secondary)] text-[var(--secondary-foreground)]'}">すべて (${orders.length})</button>
          <button type="button" data-action="setTeamDispatchFilter" data-arg="PENDING" class="px-2.5 py-1 rounded-lg font-bold ${window._teamDispatchFilter === 'PENDING' ? 'bg-amber-600 text-white' : 'bg-[var(--secondary)] text-[var(--secondary-foreground)]'}">🕒 未完了 (${pendingCnt})</button>
          <button type="button" data-action="setTeamDispatchFilter" data-arg="DONE" class="px-2.5 py-1 rounded-lg font-bold ${window._teamDispatchFilter === 'DONE' ? 'bg-emerald-600 text-white' : 'bg-[var(--secondary)] text-[var(--secondary-foreground)]'}">✅ 完了 (${doneCnt})</button>
        </div>

        <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
          ${rawHtml(cardsHtml)}
        </div>
      </div>
    ` : '')}
  `;
}
