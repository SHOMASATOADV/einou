// =========================================================================
// Feature: TSK-030 FAMIC（農林水産消費安全技術センター）農薬登録情報連携
//   - 水稲向け主要登録農薬の最新適用基準（使用回数・収穫前日数 PHI）照合・自動更新
//   - FAMIC公式CSVファイルの直接インポート＆自動抽出パースに対応
// =========================================================================

const FAMIC_LAST_SYNC_KEY = 'rakuraku_famic_last_sync_v1';

// 水稲主要農薬の FAMIC 登録基準参照テーブル（オフライン動作＆即時照合用）
const FAMIC_RICE_REGISTRY = [
  { regNo: '20142', name: 'アミスターフロアブル', activeIngredient: 'アゾキシストロビン', maxUse: 2, phiDays: 14, updatedAt: '2026-11-01' },
  { regNo: '21993', name: 'スタークル液剤10', activeIngredient: 'ジノテフラン', maxUse: 3, phiDays: 7, updatedAt: '2026-11-01' },
  { regNo: '14201', name: 'ビームゾル', activeIngredient: 'トリシクラゾール', maxUse: 2, phiDays: 21, updatedAt: '2026-11-01' },
  { regNo: '21992', name: 'スタークル粒剤', activeIngredient: 'ジノテフラン', maxUse: 3, phiDays: 14, updatedAt: '2026-11-01' },
  { regNo: '20905', name: 'ダントツ水溶剤', activeIngredient: 'クロチアニジン', maxUse: 3, phiDays: 7, updatedAt: '2026-11-01' },
  { regNo: '16859', name: 'コラトップ粒剤5', activeIngredient: 'ピロキロン', maxUse: 2, phiDays: 21, updatedAt: '2026-11-01' },
  { regNo: '13499', name: 'オリゼメート粒剤', activeIngredient: 'プロベナゾール', maxUse: 2, phiDays: 21, updatedAt: '2026-11-01' },
  { regNo: '22501', name: 'キラップフロアブル', activeIngredient: 'エチプロール', maxUse: 2, phiDays: 14, updatedAt: '2026-11-01' },
  { regNo: '23426', name: 'ブーンフロアブル', activeIngredient: 'トルプロカルブ', maxUse: 2, phiDays: 14, updatedAt: '2026-11-01' },
  { regNo: '21766', name: 'ラウンドアップマックスロード', activeIngredient: 'グリホサートカリウム塩', maxUse: 3, phiDays: 7, updatedAt: '2026-11-01' }
];

function normalizeRegDigits_(regStr) {
  return String(regStr || '').normalize('NFKC').replace(/\D/g, '');
}

function extractDaysFromTiming_(raw) {
  const s = String(raw || '').normalize('NFKC');
  const m = s.match(/(\d+)\s*日前/);
  if (m) return Number(m[1]);
  const num = Number(s.replace(/[^\d]/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function extractCountFromUse_(raw) {
  const s = String(raw || '').normalize('NFKC');
  const m = s.match(/(\d+)\s*回/);
  if (m) return Number(m[1]);
  const num = Number(s.replace(/[^\d]/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * FAMIC公式CSV（または同形式CSV）をパースして基準レコード配列へ変換（純関数・単体テスト対象）
 */
function parseFamicCsvText(csvText) {
  const raw = String(csvText || '').trim();
  if (!raw) return [];
  const rows = typeof parseDelimitedText === 'function'
    ? parseDelimitedText(raw, ',')
    : raw.split(/\r?\n/).map(line => line.split(',').map(c => c.trim()));
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => String(h || '').trim());
  const findCol = (kws) => headers.findIndex(h => kws.some(k => h.includes(k)));

  const regIdx = findCol(['登録番号', 'reg']);
  const nameIdx = findCol(['農薬の名称', '農薬名', '名称', 'name']);
  const ingIdx = findCol(['有効成分', '成分', 'ingredient']);
  const cropIdx = findCol(['作物名', '適用作物', 'crop']);
  const phiIdx = findCol(['使用時期', '収穫前日数', 'PHI', 'phi']);
  const cntIdx = findCol(['総使用回数', '使用回数', '回数', 'maxUse']);

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    // 作物列がある場合は水稲・稲のみを対象にする
    if (cropIdx !== -1 && r[cropIdx]) {
      const cropVal = String(r[cropIdx]);
      if (!cropVal.includes('稲') && !cropVal.includes('米') && !cropVal.includes('すべて')) continue;
    }
    const regNo = regIdx !== -1 ? normalizeRegDigits_(r[regIdx]) : '';
    const name = nameIdx !== -1 ? String(r[nameIdx] || '').trim() : '';
    if (!regNo && !name) continue;

    const phiDays = phiIdx !== -1 ? extractDaysFromTiming_(r[phiIdx]) : null;
    const maxUse = cntIdx !== -1 ? extractCountFromUse_(r[cntIdx]) : null;
    const activeIngredient = ingIdx !== -1 ? String(r[ingIdx] || '').trim() : '';

    records.push({
      regNo,
      name,
      activeIngredient,
      phiDays,
      maxUse,
      updatedAt: typeof getTodayIsoDate === 'function' ? getTodayIsoDate() : new Date().toISOString().slice(0, 10)
    });
  }
  return records;
}

/**
 * FAMIC基準レコードを登録済み pesticides マスタへ照合・一括適用（純関数・単体テスト対象）
 */
function applyFamicUpdatesToPesticides(records = [], pestMap = {}) {
  const changes = [];
  let matchedCount = 0;
  let updatedCount = 0;

  Object.keys(pestMap || {}).forEach(pid => {
    const p = pestMap[pid];
    if (!p) return;
    const pReg = normalizeRegDigits_(p.regNo);
    const pName = String(p.name || '').trim();

    const hit = (records || []).find(rec => {
      if (pReg && rec.regNo && pReg === normalizeRegDigits_(rec.regNo)) return true;
      if (pName && rec.name && (pName === rec.name || pName.includes(rec.name) || rec.name.includes(pName))) return true;
      return false;
    });
    if (!hit) return;

    matchedCount++;
    const diffFields = [];

    if (Number.isFinite(hit.maxUse) && hit.maxUse > 0 && Number(p.maxUse) !== hit.maxUse) {
      diffFields.push(`使用上限 ${p.maxUse}回→${hit.maxUse}回`);
      p.maxUse = hit.maxUse;
    }
    if (Number.isFinite(hit.phiDays) && hit.phiDays > 0 && Number(p.phiDays) !== hit.phiDays) {
      diffFields.push(`PHI ${p.phiDays}日→${hit.phiDays}日`);
      p.phiDays = hit.phiDays;
    }
    if (hit.activeIngredient && p.activeIngredient !== hit.activeIngredient) {
      diffFields.push(`有効成分 ${p.activeIngredient || '-'}→${hit.activeIngredient}`);
      p.activeIngredient = hit.activeIngredient;
    }
    if (hit.regNo && !pReg) {
      p.regNo = `第${hit.regNo}号`;
      diffFields.push(`登録番号 →第${hit.regNo}号`);
    }
    p.famicUpdatedAt = hit.updatedAt || new Date().toISOString().slice(0, 10);

    if (diffFields.length > 0) {
      updatedCount++;
      changes.push({ id: pid, name: p.name, diffs: diffFields });
    }
  });

  return { matchedCount, updatedCount, changes };
}

function renderFamicSyncStatus(summaryText = '') {
  const el = document.getElementById('famicSyncStatusBox');
  if (!el) return;
  let lastSync = '';
  try { lastSync = localStorage.getItem(FAMIC_LAST_SYNC_KEY) || ''; } catch (e) {}
  if (summaryText) {
    el.textContent = summaryText;
    return;
  }
  el.textContent = lastSync
    ? `最終FAMIC基準照合：${lastSync}（登録済み農薬 ${Object.keys(pesticides || {}).length} 剤）`
    : `未照合（登録済み農薬 ${Object.keys(pesticides || {}).length} 剤 ／ ワンクリックで水稲最新基準を確認できます）`;
}

function runFamicBuiltInSync() {
  const res = applyFamicUpdatesToPesticides(FAMIC_RICE_REGISTRY, pesticides);
  const nowStr = new Date().toLocaleString('ja-JP');
  try { localStorage.setItem(FAMIC_LAST_SYNC_KEY, nowStr); } catch (e) {}

  saveStateToStorage();
  refreshAllViews();

  const detail = res.changes.length > 0
    ? res.changes.map(c => `${c.name}(${c.diffs.join(' / ')})`).join('、')
    : 'すべての照合済み農薬が最新FAMIC基準と一致しています。';

  renderFamicSyncStatus(`✅ FAMIC基準照合完了 (${nowStr})：照合 ${res.matchedCount} 剤 ／ 基準更新 ${res.updatedCount} 剤`);
  showToast(
    `🏛️ FAMIC農薬基準を照合しました（照合 ${res.matchedCount}剤 / 更新 ${res.updatedCount}剤）`,
    detail
  );
}

function handleFamicCsvUpload(ev) {
  const file = ev?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const records = parseFamicCsvText(e.target.result);
      if (records.length === 0) {
        showToast('⚠️ FAMIC CSV解析エラー', '水稲対象の登録番号・使用時期・使用回数列が検出できませんでした。');
        return;
      }
      const res = applyFamicUpdatesToPesticides(records, pesticides);
      const nowStr = new Date().toLocaleString('ja-JP');
      try { localStorage.setItem(FAMIC_LAST_SYNC_KEY, `${nowStr} (CSV取込)`); } catch (err) {}
      saveStateToStorage();
      refreshAllViews();

      renderFamicSyncStatus(`✅ FAMIC CSV反映完了 (${nowStr})：読込 ${records.length}件 ／ 照合 ${res.matchedCount}剤 ／ 更新 ${res.updatedCount}剤`);
      showToast(
        `🏛️ FAMIC公式CSVから農薬基準を更新しました（更新 ${res.updatedCount}剤）`,
        res.changes.length > 0
          ? res.changes.map(c => `${c.name}: ${c.diffs.join(', ')}`).join(' ／ ')
          : `CSV内 ${records.length}件と照合し、すべて最新基準と一致していました。`
      );
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsText(file, 'UTF-8');
}

registerActionHandlers({
  runFamicBuiltInSync: () => runFamicBuiltInSync(),
  handleFamicCsvUpload: (el, ev) => handleFamicCsvUpload(ev)
});
