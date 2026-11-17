// Feature: Machine Hours, Material Inventory & Master CRUD
function completeMachineMaintenance(machId) {
  const m = machines[machId];
  if (!m) return;
  m.nextMaint = Math.round((m.currentHour + (m.interval || 50)) * 10) / 10;
  saveStateToStorage();
  renderSelectOptions();
  renderResourcesTab();
  showToast(`🔧 ${m.name} の点検・オイル交換を記録しました`, `次回点検目安が ${m.nextMaint.toFixed(1)}h に更新されました。`);
}

function restockMaterial(type, id, amount) {
  if (type === 'fert' && fertilizers[id]) {
    fertilizers[id].stock += amount;
    showToast(`📦 ${fertilizers[id].name} を +${amount}袋 入庫しました`, `現在庫: ${fertilizers[id].stock} 袋`);
  } else if (type === 'pest' && pesticides[id]) {
    const p = pesticides[id];
    ensurePesticideInventoryFields_(p);
    if (p.formulation === 'granule') {
      const addKg = Math.round(amount * p.unitSizeKg * 10) / 10;
      p.stockKg = Math.round((p.stockKg + addKg) * 10) / 10;
      ensurePesticideInventoryFields_(p);
      const st = formatPesticideStock_(p);
      showToast(`📦 ${p.name} を +${amount}袋（+${addKg}kg）入庫しました`, `現在庫: ${st.totalLabel}（${st.detailLabel}）`);
    } else {
      const addMl = Math.round(amount * p.unitSizeMl);
      p.stockMl = Math.round(p.stockMl + addMl);
      ensurePesticideInventoryFields_(p);
      const st = formatPesticideStock_(p);
      showToast(`📦 ${p.name} を +${amount}本（+${addMl.toLocaleString()}mL）入庫しました`, `現在庫: ${st.totalLabel}（${st.detailLabel}）`);
    }
  }
  saveStateToStorage();
  renderSelectOptions();
  renderResourcesTab();
  recalculatePreview();
}

function renderResourcesTab() {
  const mList = document.getElementById('machineCardList');
  mList.innerHTML = Object.values(machines).map(m => {
    const remain = Math.round((m.nextMaint - m.currentHour) * 10) / 10;
    const pct = Math.min(100, Math.round((m.currentHour / m.nextMaint) * 100));
    const isWarn = remain <= 10;
    const badge = isWarn
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-600 border border-amber-500/40">⚠️ 要点検（残り ${remain}h）</span>`
      : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-600">正常（次回まで ${remain}h）</span>`;

    return `
      <div class="p-4 rounded-2xl bg-[var(--background)] border border-[var(--border)]">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div>
            <span class="text-[11px] font-bold text-emerald-600">[${escapeHtml(m.cat || '農機具')}] 稼働単価: ${(Number(m.hourlyCostYen) || 2500).toLocaleString()}円/h</span>
            <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(m.name)}</div>
          </div>
          <div class="flex items-center gap-1.5">
            ${badge}
            <button data-action="completeMachineMaintenance" data-arg="${escapeHtml(m.id)}" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition">
              🔧 点検完了
            </button>
            <button data-action="deleteMachineMaster" data-arg="${escapeHtml(m.id)}" class="px-2 py-1 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 text-xs font-bold hover:bg-red-500/20" title="機材を削除">
              🗑️
            </button>
          </div>
        </div>
        <div class="flex justify-between text-xs text-[var(--muted-foreground)] mb-1.5">
          <span>現在アワーメーター: <strong class="text-[var(--foreground)]">${m.currentHour.toFixed(1)} h</strong></span>
          <span>次回点検目安: ${m.nextMaint.toFixed(1)} h</span>
        </div>
        <div class="w-full h-2.5 rounded-full bg-[var(--secondary)] overflow-hidden">
          <div class="h-full ${isWarn ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const sList = document.getElementById('materialStockList');
  const fertCards = Object.values(fertilizers).map(f => {
    const isLow = f.stock <= f.minStock;
    return `
      <div class="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--border)] flex items-center justify-between gap-2">
        <div>
          <span class="text-xs font-bold text-emerald-600">[肥料] N${f.n}-P${f.p}-K${f.k} (${f.unitKg || 20}kg/袋・${(Number(f.priceYen) || 2500).toLocaleString()}円)</span>
          <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(f.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)]">${isLow ? '⚠️ 発注点割れ（要補充）' : '在庫十分'}</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <div class="text-right mr-1">
            <div class="text-base font-bold ${isLow ? 'text-amber-600' : 'text-[var(--foreground)]'}">残 ${f.stock} 袋</div>
          </div>
          <button data-action="restockMaterial" data-arg="fert" data-arg2="${escapeHtml(f.id)}" data-arg3="10" class="px-2.5 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋10袋入庫
          </button>
          <button data-action="deleteMaterialMaster" data-arg="fert" data-arg2="${escapeHtml(f.id)}" class="px-2 py-1.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 text-xs font-bold hover:bg-red-500/20" title="肥料を削除">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  const pestCards = Object.values(pesticides).map(p => {
    const st = formatPesticideStock_(p);
    const ingLabel = p.activeIngredient ? ` ／ 有効成分: ${escapeHtml(p.activeIngredient)}` : '';
    const specLabel = p.formulation === 'granule' ? `粒剤・粉剤 (${p.unitSizeKg}kg/袋)` : `液剤 (${p.unitSizeMl}mL/本)`;
    const unitBtn = p.formulation === 'granule' ? '袋' : '本';
    const lowText = st.isLow ? '<span class="text-amber-600 font-bold">⚠️ 在庫少（2本・袋未満）</span>' : '在庫十分';
    return `
      <div class="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--border)] flex items-center justify-between flex-wrap gap-2">
        <div>
          <span class="text-xs font-bold text-sky-600">[農薬・${specLabel}] ${escapeHtml(p.regNo)} (上限${p.maxUse}回)${ingLabel}</span>
          <div class="font-bold text-sm text-[var(--foreground)]">${escapeHtml(p.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)]">収穫前 ${p.phiDays} 日まで ／ 単価 ${(Number(p.priceYen) || 3000).toLocaleString()}円 ／ ${lowText}</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <div class="text-right mr-1">
            <div class="text-base font-bold ${st.isLow ? 'text-amber-600' : 'text-[var(--foreground)]'}">残 ${st.totalLabel}</div>
            <div class="text-[11px] text-[var(--muted-foreground)]">(${st.detailLabel})</div>
          </div>
          <button data-action="restockMaterial" data-arg="pest" data-arg2="${escapeHtml(p.id)}" data-arg3="1" class="px-2 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋1${unitBtn}
          </button>
          <button data-action="restockMaterial" data-arg="pest" data-arg2="${escapeHtml(p.id)}" data-arg3="5" class="px-2 py-1.5 rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)] text-xs font-bold border border-[var(--border)] hover:opacity-80">
            ＋5${unitBtn}
          </button>
          <button data-action="deleteMaterialMaster" data-arg="pest" data-arg2="${escapeHtml(p.id)}" class="px-2 py-1.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 text-xs font-bold hover:bg-red-500/20" title="農薬を削除">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');

  sList.innerHTML = fertCards + pestCards;
}


function toggleQuickAddPanel(panelId, forceOpen) {
  const el = document.getElementById(panelId);
  if (!el) return;
  const open = forceOpen !== undefined ? forceOpen : el.classList.contains('hidden');
  if (open) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function addNewFieldMaster() {
  const name = document.getElementById('newFieldName').value.trim();
  const lot = document.getElementById('newFieldLot').value.trim() || '地番未設定';
  const area = Math.max(1, Number(document.getElementById('newFieldArea').value || 20));
  const crop = document.getElementById('newFieldCrop').value.trim() || 'コシヒカリ (BL)';
  const group = document.getElementById('newFieldGroup')?.value || 'yama';
  const lat = Number(document.getElementById('newFieldLat')?.value || 37.9212);
  const lng = Number(document.getElementById('newFieldLng')?.value || 139.0482);

  if (!name) {
    showToast('⚠️ 入力確認', '圃場名（通称）を入力してください。');
    return;
  }

  const newId = generateNextId('F', fieldsData.map(f => f.id));
  fieldsData.push({
    id: newId,
    name: name,
    lot: lot,
    group: group,
    area: area,
    crop: crop,
    headingDate: group === 'yama' ? '2026/08/14' : '2026/08/08',
    targetTempC: crop.includes('つきあかり') ? 950 : 1000,
    dailyMeanTempC: group === 'yama' ? 23.2 : 25.5,
    harvest: '2026/09/25',
    stage: '未着手',
    lat: lat,
    lng: lng,
    polygonCoords: pickerDrawVertices.length >= 3 ? [...pickerDrawVertices] : null,
    doneCats: [],
    nPer10a: 0,
    pPer10a: 0,
    kPer10a: 0,
    pestCount: {},
    alerts: [],
    baseline: makeEmptyBaseline()
  });

  document.getElementById('newFieldName').value = '';
  document.getElementById('newFieldLot').value = '';
  if (document.getElementById('newFieldGmapUrl')) document.getElementById('newFieldGmapUrl').value = '';
  pickerDrawVertices = [];
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規圃場「${name} (${area}a)」を追加しました`, `GPS座標 (${lat.toFixed(4)}, ${lng.toFixed(4)}) でGoogleマップ航空写真＆GISカルテに即時反映されました。`);
}

function deleteFieldMaster(fieldId) {
  if (fieldsData.length <= 1) {
    showToast('⚠️ 削除不可', '最低1筆の圃場が必要です。');
    return;
  }
  const f = fieldsData.find(item => item.id === fieldId);
  if (!f) return;
  if (!confirm(`圃場「${f.name} (${f.area}a)」をマスタから削除しますか？`)) return;

  fieldsData = fieldsData.filter(item => item.id !== fieldId);
  selectedFieldIds = selectedFieldIds.filter(id => id !== fieldId);
  if (selectedFieldIds.length === 0 && fieldsData[0]) selectedFieldIds = [fieldsData[0].id];
  if (currentInspectedFieldId === fieldId && fieldsData[0]) currentInspectedFieldId = fieldsData[0].id;
  saveStateToStorage();
  refreshAllViews();
  showToast(`🗑️ 圃場「${f.name}」を削除しました`, '');
}

function addNewFertilizerMaster(source) {
  const isQuick = source === 'quick';
  const nameEl = document.getElementById(isQuick ? 'quickFertName' : 'newFertName');
  const name = (nameEl?.value || '').trim();
  const n = Number(document.getElementById(isQuick ? 'quickFertN' : 'newFertN')?.value || 0);
  const p = Number(document.getElementById(isQuick ? 'quickFertP' : 'newFertP')?.value || 0);
  const k = Number(document.getElementById(isQuick ? 'quickFertK' : 'newFertK')?.value || 0);
  const unitKg = Math.max(1, Number(document.getElementById(isQuick ? 'quickFertUnitKg' : 'newFertUnitKg')?.value || 20));
  const stock = Math.max(0, Number(document.getElementById(isQuick ? 'quickFertStock' : 'newFertStock')?.value || 20));
  const priceYen = Math.max(0, Number(document.getElementById(isQuick ? 'quickFertPrice' : 'newFertPrice')?.value || 2500));

  if (!name) {
    showToast('⚠️ 入力確認', '肥料名称を入力してください。');
    return;
  }

  // 圃場ID(F01...)とのプレフィックス衝突を避けるため新規肥料は FT01... で採番
  const newId = generateNextId('FT', Object.keys(fertilizers));
  fertilizers[newId] = { id: newId, name, unitKg, n, p, k, stock, minStock: 10, priceYen };
  if (nameEl) nameEl.value = '';
  if (isQuick) toggleQuickAddPanel('quickFertForm', false);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規肥料「${name} (N${n}-P${p}-K${k})」を追加しました`, '施肥入力リストおよび在庫・原価計算へ即時反映されました。');
}

function syncPestUnitPlaceholder(source) {
  const isQuick = source === 'quick';
  const formEl = document.getElementById(isQuick ? 'quickPestFormulation' : 'newPestFormulation');
  const labelEl = document.getElementById(isQuick ? 'quickPestUnitSizeLabel' : 'newPestUnitSizeLabel');
  const sizeEl = document.getElementById(isQuick ? 'quickPestUnitSize' : 'newPestUnitSize');
  if (!formEl || !labelEl || !sizeEl) return;
  if (formEl.value === 'granule') {
    labelEl.textContent = '1袋重量 (kg)';
    sizeEl.step = '0.5';
    if (Number(sizeEl.value) >= 50) sizeEl.value = '3';
  } else {
    labelEl.textContent = '1本容量 (mL)';
    sizeEl.step = '50';
    if (Number(sizeEl.value) < 50) sizeEl.value = '500';
  }
}

function addNewPesticideMaster(source) {
  const isQuick = source === 'quick';
  const nameEl = document.getElementById(isQuick ? 'quickPestName' : 'newPestName');
  const regEl = document.getElementById(isQuick ? 'quickPestRegNo' : 'newPestRegNo');
  const ingEl = document.getElementById(isQuick ? 'quickPestIngredient' : 'newPestIngredient');
  const formEl = document.getElementById(isQuick ? 'quickPestFormulation' : 'newPestFormulation');
  const sizeEl = document.getElementById(isQuick ? 'quickPestUnitSize' : 'newPestUnitSize');
  const name = (nameEl?.value || '').trim();
  const regNo = (regEl?.value || '').trim() || '登録番号未設定';
  const activeIngredient = (ingEl?.value || '').trim() || name;
  const formulation = formEl?.value === 'granule' ? 'granule' : 'liquid';
  const rawSize = Number(sizeEl?.value || (formulation === 'granule' ? 3 : 500));
  const maxUse = Math.max(1, Number(document.getElementById(isQuick ? 'quickPestMaxUse' : 'newPestMaxUse')?.value || 2));
  const phiDays = Math.max(1, Number(document.getElementById(isQuick ? 'quickPestPhiDays' : 'newPestPhiDays')?.value || 14));
  const stock = Math.max(0, Number(document.getElementById(isQuick ? 'quickPestStock' : 'newPestStock')?.value || 10));
  const priceYen = Math.max(0, Number(document.getElementById(isQuick ? 'quickPestPrice' : 'newPestPrice')?.value || 3000));

  if (!name) {
    showToast('⚠️ 入力確認', '農薬名称を入力してください。');
    return;
  }

  const newId = generateNextId('P', Object.keys(pesticides));
  const newPest = {
    id: newId,
    name,
    regNo,
    activeIngredient,
    formulation,
    maxUse,
    phiDays,
    stock,
    priceYen
  };
  if (formulation === 'granule') {
    newPest.unitSizeKg = Math.max(0.1, rawSize);
    newPest.stockKg = Math.round(stock * newPest.unitSizeKg * 10) / 10;
    newPest.unit = `袋(${newPest.unitSizeKg}kg)`;
  } else {
    newPest.unitSizeMl = Math.max(10, rawSize);
    newPest.stockMl = Math.round(stock * newPest.unitSizeMl);
    newPest.unit = `本(${newPest.unitSizeMl}mL)`;
  }
  ensurePesticideInventoryFields_(newPest);
  pesticides[newId] = newPest;
  if (nameEl) nameEl.value = '';
  if (regEl) regEl.value = '';
  if (ingEl) ingEl.value = '';
  if (isQuick) toggleQuickAddPanel('quickPestForm', false);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規農薬「${name}（有効成分: ${activeIngredient}）」を追加しました`, `使用上限${maxUse}回・収穫前${phiDays}日(PHI)の安全基準チェックへ連動しました。`);
}

function addNewMachineMaster(source) {
  const isQuick = source === 'quick';
  const nameEl = document.getElementById(isQuick ? 'quickMachName' : 'newMachName');
  const name = (nameEl?.value || '').trim();
  const cat = document.getElementById(isQuick ? 'quickMachCat' : 'newMachCat')?.value || 'トラクター';
  const currentHour = Math.max(0, Number(document.getElementById(isQuick ? 'quickMachHour' : 'newMachHour')?.value || 0));
  const interval = Math.max(10, Number(document.getElementById(isQuick ? 'quickMachInterval' : 'newMachInterval')?.value || 50));
  const hourlyCostYen = Math.max(0, Number(document.getElementById(isQuick ? 'quickMachCost' : 'newMachCost')?.value || 2500));

  if (!name) {
    showToast('⚠️ 入力確認', '機材・農機具名称を入力してください。');
    return;
  }

  const newId = generateNextId('M', Object.keys(machines));
  machines[newId] = {
    id: newId,
    name,
    cat,
    currentHour,
    nextMaint: Math.round((currentHour + interval) * 10) / 10,
    interval,
    hourlyCostYen
  };
  if (nameEl) nameEl.value = '';
  if (isQuick) toggleQuickAddPanel('quickMachineForm', false);
  saveStateToStorage();
  refreshAllViews();
  showToast(`✅ 新規機材「${name} (${cat})」を追加しました`, `現在 ${currentHour}h ／ 次回点検 ${machines[newId].nextMaint}h でアワーメーター管理へ追加されました。`);
}

function deleteMachineMaster(machId) {
  if (Object.keys(machines).length <= 1) {
    showToast('⚠️ 削除不可', '最低1台の機材マスタが必要です。');
    return;
  }
  const m = machines[machId];
  if (!m) return;
  if (!confirm(`機材「${m.name}」をマスタから削除しますか？`)) return;
  delete machines[machId];
  saveStateToStorage();
  refreshAllViews();
  showToast(`🗑️ 機材「${m.name}」を削除しました`, '');
}

function deleteMaterialMaster(type, id) {
  const dict = type === 'fert' ? fertilizers : pesticides;
  const label = type === 'fert' ? '肥料' : '農薬';
  if (Object.keys(dict).length <= 1) {
    showToast('⚠️ 削除不可', `最低1銘柄の${label}マスタが必要です。`);
    return;
  }
  const item = dict[id];
  if (!item) return;
  if (!confirm(`${label}「${item.name}」をマスタから削除しますか？`)) return;
  delete dict[id];
  saveStateToStorage();
  refreshAllViews();
  showToast(`🗑️ ${label}「${item.name}」を削除しました`, '');
}

