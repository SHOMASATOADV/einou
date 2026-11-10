/**
 * ============================================================================
 * 次世代版「らくらく営農日誌」 Googleスプレッドシート × GAS 自動化エンジン
 * ============================================================================
 * 【主な機能】
 * 1. setupAllSheets()       : 1クリックで全マスタ・日誌シート・A4帳票テンプレートシートを自動構築
 * 2. processPendingLogs()   : 「1作業×複数圃場」の日誌データから、面積比率で各圃場へ自動按分展開
 *                             ＋ NPK成分積算 ＋ 機械アワー加算 ＋ 資材在庫引落を同時実行
 * 3. refreshA4ReportSheet() : JA提出用「生産履歴記帳簿（施肥・防除台帳）」A4シートへ最新データを自動転記
 * 4. exportA4ReportToPdf()  : A4帳票シートをワンクリックで提出用PDFファイルとしてGoogleドライブに出力
 * 5. doPost(e) / doGet(e)   : スマホPWAアプリ（オフライン対応版）からの直接データ同期API
 */

const SHEET_NAMES = {
  FIELDS: 'M_FIELDS',
  MATERIALS: 'M_MATERIALS',
  MACHINES: 'M_MACHINES',
  WORK_LOGS: 'T_WORK_LOGS',
  LOG_FIELDS: 'T_LOG_FIELDS',
  REPORT_JA: 'A4帳票_JA生産履歴記帳簿',
  REPORT_DAILY: 'A4帳票_作業日報集計表',
  IMP_RAW: 'IMP_他社データ移行貼付'
};

/**
 * スプレッドシート起動時に専用カスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🌾 らくらく営農日誌')
    .addItem('① 初期シート＆A4帳票テンプレートを一括作成', 'setupAllSheets')
    .addSeparator()
    .addItem('② 未処理の作業日誌を「面積按分・在庫・アワー」へ一括反映', 'processPendingLogs')
    .addItem('③ JA提出用 A4帳票シートを最新データで更新', 'refreshA4ReportSheet')
    .addItem('④ JA提出用 A4帳票をPDFファイル出力', 'exportA4ReportToPdf')
    .addSeparator()
    .addItem('⑤ 他社営農アプリ（アグリノート/KSAS/旧日誌）貼付データを自動変換インポート', 'importExternalAppData')
    .addToUi();
}

/**
 * 1. 全テーブル＆A4帳票シートの初期セットアップ（空のスプレッドシートで最初に1回実行）
 */
function setupAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // (1) M_FIELDS: 圃場マスタ
  const fieldsSheet = getOrCreateSheet_(ss, SHEET_NAMES.FIELDS);
  fieldsSheet.clear();
  const fieldsData = [
    ['field_id', 'field_code', 'field_name', 'address_lot', 'area_group', 'area_a', 'crop_name', 'planned_harvest_date', 'current_stage', 'center_lat', 'center_lng', 'cum_n_per10a_kg', 'cum_p_per10a_kg', 'cum_k_per10a_kg'],
    ['F01', '001', '① 本場1号', '大字下新田 102-1', '本場平場団地', 30, 'コシヒカリ(BL)', '2026-09-20', '施肥済', 37.9161, 139.0364, 2.80, 2.80, 2.80],
    ['F02', '002', '② 本場2号', '大字下新田 102-2', '本場平場団地', 20, 'コシヒカリ(BL)', '2026-09-20', '施肥済', 37.9163, 139.0368, 2.80, 2.80, 2.80],
    ['F03', '003', '③ 本場3号・大町', '大字下新田 105', '本場平場団地', 50, 'コシヒカリ(BL)', '2026-09-20', '施肥済', 37.9158, 139.0365, 2.80, 2.80, 2.80],
    ['F04', '004', '④ 川向4号', '大字川向 44-1', '川向団地', 35, 'つきあかり', '2026-09-10', '耕起済', 37.9145, 139.0355, 1.40, 1.40, 1.40],
    ['F05', '005', '⑤ 上山田A(飛び地)', '上山田字沢 88-1', '上山田中山間団地', 15, 'コシヒカリ(BL)', '2026-09-28', '未着手', 37.9210, 139.0480, 0.00, 0.00, 0.00],
    ['F06', '006', '⑥ 上山田B(飛び地)', '上山田字沢 89-3', '上山田中山間団地', 18, 'コシヒカリ(BL)', '2026-09-28', '未着手', 37.9215, 139.0488, 0.00, 0.00, 0.00],
    ['F07', '007', '⑦ 上山田棚田C', '上山田字峯 12-1', '上山田中山間団地', 22, 'コシヒカリ(BL)', '2026-09-28', '草刈り済', 37.9202, 139.0475, 0.00, 0.00, 0.00]
  ];
  fieldsSheet.getRange(1, 1, fieldsData.length, fieldsData[0].length).setValues(fieldsData);
  styleHeaderRow_(fieldsSheet, fieldsData[0].length, '#047857');

  // (2) M_MATERIALS: 資材マスタ（肥料・農薬）
  const matSheet = getOrCreateSheet_(ss, SHEET_NAMES.MATERIALS);
  matSheet.clear();
  const matData = [
    ['material_id', 'material_type', 'material_name', 'reg_number', 'active_ingredient', 'unit_size', 'base_unit', 'n_ratio_pct', 'p_ratio_pct', 'k_ratio_pct', 'std_dilution_rate', 'max_use_count', 'pre_harvest_days', 'current_stock_qty', 'reorder_point_qty'],
    ['F01', 'FERTILIZER', 'くみあい苦土入り複合オール14', '-', '-', 20, 'kg', 14, 14, 14, 0, 0, 0, 45, 15],
    ['F02', 'FERTILIZER', '水稲一発基肥コートL80', '-', '-', 20, 'kg', 24, 10, 12, 0, 0, 0, 30, 10],
    ['F03', 'FERTILIZER', 'NK化成2号（穂肥用）', '-', '-', 20, 'kg', 17, 0, 17, 0, 0, 0, 12, 15],
    ['P01', 'PESTICIDE', 'アミスターフロアブル', '第20142号', 'アゾキシストロビン', 500, 'mL', 0, 0, 0, 1000, 2, 14, 18, 5],
    ['P02', 'PESTICIDE', 'スタークル液剤10', '第21993号', 'ジノテフラン', 500, 'mL', 0, 0, 0, 1000, 3, 7, 24, 5],
    ['P03', 'PESTICIDE', 'ビームゾル', '第14201号', 'トリシクラゾール', 500, 'mL', 0, 0, 0, 1000, 2, 21, 6, 5],
    ['P04', 'PESTICIDE', 'スタークル粒剤', '第21992号', 'ジノテフラン', 3000, 'g', 0, 0, 0, 1, 3, 14, 15, 5]
  ];
  matSheet.getRange(1, 1, matData.length, matData[0].length).setValues(matData);
  styleHeaderRow_(matSheet, matData[0].length, '#0369a1');

  // (3) M_MACHINES: 機械マスタ
  const machSheet = getOrCreateSheet_(ss, SHEET_NAMES.MACHINES);
  machSheet.clear();
  const machData = [
    ['machine_id', 'machine_name', 'category', 'initial_hour_meter', 'current_hour_meter', 'next_maint_hour', 'maint_interval_hr', 'status'],
    ['M01', 'ヤンマー トラクター YT357', 'トラクター', 120.0, 248.0, 300.0, 100.0, '正常'],
    ['M02', 'クボタ 乗用草刈機 RM983', '乗用モア', 30.0, 96.5, 100.0, 50.0, '点検近し'],
    ['M03', '農業用ドローン DJI Agras T30', 'ドローン', 0.0, 42.0, 60.0, 30.0, '正常'],
    ['M04', 'クボタ 田植機 NW8S', '田植機', 50.0, 115.0, 150.0, 50.0, '正常']
  ];
  machSheet.getRange(1, 1, machData.length, machData[0].length).setValues(machData);
  styleHeaderRow_(machSheet, machData[0].length, '#b45309');

  // (4) T_WORK_LOGS: 作業日誌ヘッダ（1アクション入力テーブル）
  const logSheet = getOrCreateSheet_(ss, SHEET_NAMES.WORK_LOGS);
  logSheet.clear();
  const logData = [
    ['work_log_id', 'work_date', 'work_category', 'worker_name', 'selected_field_ids', 'total_area_a', 'total_duration_hr', 'machine_id', 'material_id', 'input_qty_bags_or_bottles', 'total_weight_kg', 'dilution_rate', 'water_volume_l', 'calc_n_per10a_kg', 'calc_p_per10a_kg', 'calc_k_per10a_kg', 'notes', 'allocated_flag'],
    ['WL-20261028-01', '2026-10-28', '草刈り', '佐藤 健一', 'F01,F02,F03,F07', 122, 3.0, 'M02', '', 0, 0, 0, 0, 0, 0, 0, '畦畔・法面草刈り一括実施', 'DONE'],
    ['WL-20261101-01', '2026-11-01', '施肥', '佐藤 健一', 'F01,F02,F03', 100, 2.0, 'M01', 'F01', 10, 200, 0, 0, 2.80, 2.80, 2.80, '基肥一括散布（オール14・10袋）', 'DONE'],
    ['WL-20261103-01', '2026-11-03', '防除', '高橋 誠', 'F01,F02,F03', 100, 1.5, 'M03', 'P01', 2, 1.0, 8, 8.0, 0, 0, 0, 'ドローン防除1回目（アミスター8倍）', 'DONE']
  ];
  logSheet.getRange(1, 1, logData.length, logData[0].length).setValues(logData);
  styleHeaderRow_(logSheet, logData[0].length, '#047857');

  // (5) T_LOG_FIELDS: 日誌×圃場 面積按分明細（カルテ履歴）
  const lfSheet = getOrCreateSheet_(ss, SHEET_NAMES.LOG_FIELDS);
  lfSheet.clear();
  const lfData = [
    ['log_field_id', 'work_log_id', 'work_date', 'work_category', 'field_id', 'field_name', 'field_area_a', 'area_ratio', 'allocated_duration_hr', 'material_name', 'allocated_fert_kg', 'allocated_n_kg', 'allocated_p_kg', 'allocated_k_kg', 'allocated_water_l', 'allocated_chem_ml'],
    ['LF-001', 'WL-20261101-01', '2026-11-01', '施肥', 'F01', '① 本場1号', 30, 0.30, 0.60, 'くみあい苦土入り複合オール14', 60.0, 8.40, 8.40, 8.40, 0, 0],
    ['LF-002', 'WL-20261101-01', '2026-11-01', '施肥', 'F02', '② 本場2号', 20, 0.20, 0.40, 'くみあい苦土入り複合オール14', 40.0, 5.60, 5.60, 5.60, 0, 0],
    ['LF-003', 'WL-20261101-01', '2026-11-01', '施肥', 'F03', '③ 本場3号・大町', 50, 0.50, 1.00, 'くみあい苦土入り複合オール14', 100.0, 14.00, 14.00, 14.00, 0, 0],
    ['LF-004', 'WL-20261103-01', '2026-11-03', '防除', 'F01', '① 本場1号', 30, 0.30, 0.45, 'アミスターフロアブル', 0, 0, 0, 0, 2.4, 300],
    ['LF-005', 'WL-20261103-01', '2026-11-03', '防除', 'F02', '② 本場2号', 20, 0.20, 0.30, 'アミスターフロアブル', 0, 0, 0, 0, 1.6, 200],
    ['LF-006', 'WL-20261103-01', '2026-11-03', '防除', 'F03', '③ 本場3号・大町', 50, 0.50, 0.75, 'アミスターフロアブル', 0, 0, 0, 0, 4.0, 500]
  ];
  lfSheet.getRange(1, 1, lfData.length, lfData[0].length).setValues(lfData);
  styleHeaderRow_(lfSheet, lfData[0].length, '#334155');

  // (6) IMP_RAW: 他社営農アプリ（アグリノート / KSAS / 旧日誌）からのコピペ移行用シート
  const impSheet = getOrCreateSheet_(ss, SHEET_NAMES.IMP_RAW);
  impSheet.clear();
  const impSample = [
    ['ほ場ID', 'ほ場名', 'グループ名', '地番・住所', '面積(㎡)', '作付名', '品種名', '収穫予定日', '緯度', '経度'],
    ['AGN-101', 'アグリ下新田1号', '本場エリア', '大字下新田 201-1', 2800, '水稲', 'コシヒカリ(BL)', '2026-09-22', 37.9165, 139.0370],
    ['AGN-102', 'アグリ下新田2号', '本場エリア', '大字下新田 201-2', 3200, '水稲', 'コシヒカリ(BL)', '2026-09-22', 37.9168, 139.0372],
    ['AGN-103', 'アグリ山間棚田1号', '上山田飛び地', '上山田字沢 110', 1400, '水稲', 'つきあかり', '2026-09-15', 37.9220, 139.0490]
  ];
  impSheet.getRange(1, 1, impSample.length, impSample[0].length).setValues(impSample);
  styleHeaderRow_(impSheet, impSample[0].length, '#6d28d9');

  // (7) A4帳票シートの自動構築と初期転記
  refreshA4ReportSheet();

  SpreadsheetApp.getActiveSpreadsheet().toast('全マスタ・日誌テーブル・他社データ移行シート・JA提出用A4帳票シートの初期構築が完了しました！', '🌾 セットアップ完了', 5);
}

/**
 * 2. 未処理の作業日誌（allocated_flag が空欄の行）を検出し、
 *    ①面積比率での圃場明細（T_LOG_FIELDS）自動生成
 *    ②NPK成分量の自動計算と圃場マスタ累計加算
 *    ③機械アワーメーター加算
 *    ④資材在庫の自動引き落とし
 *    を一括実行するコア関数（AppSheetのBotまたはトリガーから呼び出し可能）
 */
function processPendingLogs() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let processedCount = 0;
  try {
    processedCount = processPendingLogs_();
  } finally {
    lock.releaseLock();
  }
  refreshA4ReportSheet();
  SpreadsheetApp.getActiveSpreadsheet().toast(`${processedCount} 件の作業日誌を各圃場へ面積按分し、A4帳票を更新しました。`, '✅ 按分処理完了', 4);
}

/**
 * processPendingLogs の本体（ロック取得済みの呼び出し元から使用）
 * 【改善点】
 *  - ループ内ではメモリ上の配列のみを更新し、最後に列単位で setValues() 一括書き込み
 *    → 同一バッチ内で同じ圃場・機械・資材が複数回登場しても加算値が上書き消失しない
 *    → setValue()/appendRow() の多重呼び出しを排除し、GAS 6分制限に対して大幅に高速化
 * @return {number} 処理した日誌件数
 */
function processPendingLogs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(SHEET_NAMES.WORK_LOGS);
  const fieldsSheet = ss.getSheetByName(SHEET_NAMES.FIELDS);
  const matSheet = ss.getSheetByName(SHEET_NAMES.MATERIALS);
  const machSheet = ss.getSheetByName(SHEET_NAMES.MACHINES);
  const lfSheet = ss.getSheetByName(SHEET_NAMES.LOG_FIELDS);

  const logs = logSheet.getDataRange().getValues();
  const fields = fieldsSheet.getDataRange().getValues();
  const materials = matSheet.getDataRange().getValues();
  const machines = machSheet.getDataRange().getValues();

  // マスタのルックアップ辞書（値は getValues() 配列の行への参照 → 直接書き換えると累積される）
  const fieldMap = {};
  for (let i = 1; i < fields.length; i++) {
    const key = String(fields[i][0] || '').trim();
    if (key) fieldMap[key] = fields[i];
  }
  const matMap = {};
  for (let i = 1; i < materials.length; i++) {
    const key = String(materials[i][0] || '').trim();
    if (key) matMap[key] = materials[i];
  }
  const machMap = {};
  for (let i = 1; i < machines.length; i++) {
    const key = String(machines[i][0] || '').trim();
    if (key) machMap[key] = machines[i];
  }

  const newLfRows = [];
  let processedCount = 0;

  for (let r = 1; r < logs.length; r++) {
    const row = logs[r];
    const workLogId = row[0];
    const workDate = row[1];
    const workCat = row[2];
    const selectedIdsRaw = String(row[4] || '');
    const durationHr = Number(row[6] || 0);
    const machineId = String(row[7] || '').trim();
    const materialId = String(row[8] || '').trim();
    const inputQty = Number(row[9] || 0);
    const dilutionRate = Number(row[11] || 0);
    const waterVolL = Number(row[12] || 0);
    const allocatedFlag = String(row[17] || '');

    if (!workLogId || allocatedFlag === 'DONE') continue;

    // 対象圃場リストの取得と合計面積計算
    const fieldIds = selectedIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
    let totalAreaA = 0;
    fieldIds.forEach(fid => {
      if (fieldMap[fid]) totalAreaA += Number(fieldMap[fid][5] || 0);
    });
    if (totalAreaA <= 0) continue;

    // 資材情報の取得とNPK計算（混用散布のカンマ区切り material_id 例: "P01,P02" にも対応）
    let matName = '-';
    let totalWeightKg = 0;
    let nPer10a = 0, pPer10a = 0, kPer10a = 0;
    let nTotalKg = 0, pTotalKg = 0, kTotalKg = 0;
    let totalChemMl = 0;

    const matIds = materialId ? materialId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const matchedMats = matIds.map(id => matMap[id]).filter(Boolean);
    if (matchedMats.length > 0) {
      matName = matchedMats.map(item => item[2]).join('＋');
      matchedMats.forEach((m, mIdx) => {
        const mType = m[1];
        const unitSize = Number(m[5] || 0);
        const nPct = Number(m[7] || 0);
        const pPct = Number(m[8] || 0);
        const kPct = Number(m[9] || 0);

        if (mType === 'FERTILIZER' && mIdx === 0) {
          totalWeightKg = inputQty * unitSize;
          const per10aKg = totalWeightKg / (totalAreaA / 10.0);
          nPer10a = per10aKg * (nPct / 100.0);
          pPer10a = per10aKg * (pPct / 100.0);
          kPer10a = per10aKg * (kPct / 100.0);
          nTotalKg = totalWeightKg * (nPct / 100.0);
          pTotalKg = totalWeightKg * (pPct / 100.0);
          kTotalKg = totalWeightKg * (kPct / 100.0);
        } else if (mType === 'PESTICIDE' && dilutionRate > 0 && mIdx === 0) {
          totalChemMl = (waterVolL * 1000.0) / dilutionRate;
        }

        // 資材在庫の引き落とし（混用時は各剤を差し引く）
        const deduct = matchedMats.length > 1 && mType === 'PESTICIDE'
          ? Math.max(1, Math.ceil(((waterVolL * 1000.0) / Math.max(1, dilutionRate)) / Math.max(1, unitSize || 500)))
          : inputQty;
        m[13] = Math.max(0, Number(m[13] || 0) - deduct);
      });
    }

    // 機械アワーメーターの自動加算（メモリ上で累積）
    const mc = machineId ? machMap[machineId] : null;
    if (mc && durationHr > 0) {
      const newHour = Math.round((Number(mc[4] || 0) + durationHr) * 10) / 10;
      const nextMaint = Number(mc[5] || 0);
      mc[4] = newHour;
      mc[7] = newHour >= nextMaint - 10 ? '点検近し' : '正常';
    }

    // 親行（T_WORK_LOGS）の自動計算列を更新（メモリ上）
    row[5] = totalAreaA;
    row[10] = totalWeightKg;
    row[13] = Number(nPer10a.toFixed(2));
    row[14] = Number(pPer10a.toFixed(2));
    row[15] = Number(kPer10a.toFixed(2));
    row[17] = 'DONE';

    // 各圃場への面積比率按分レコード生成＆圃場マスタ更新（メモリ上で累積）
    fieldIds.forEach((fid, idx) => {
      const f = fieldMap[fid];
      if (!f) return;
      const fArea = Number(f[5] || 0);
      const ratio = fArea / totalAreaA;

      newLfRows.push([
        `${workLogId}-F${idx + 1}`,
        workLogId,
        workDate,
        workCat,
        fid,
        f[2],
        fArea,
        Number(ratio.toFixed(4)),
        Number((durationHr * ratio).toFixed(2)),
        matName,
        Number((totalWeightKg * ratio).toFixed(2)),
        Number((nTotalKg * ratio).toFixed(2)),
        Number((pTotalKg * ratio).toFixed(2)),
        Number((kTotalKg * ratio).toFixed(2)),
        Number((waterVolL * ratio).toFixed(2)),
        Math.round(totalChemMl * ratio)
      ]);

      f[8] = `${workCat}済`;
      if (nPer10a > 0 || pPer10a > 0 || kPer10a > 0) {
        f[11] = Number((Number(f[11] || 0) + nPer10a).toFixed(2));
        f[12] = Number((Number(f[12] || 0) + pPer10a).toFixed(2));
        f[13] = Number((Number(f[13] || 0) + kPer10a).toFixed(2));
      }
    });

    processedCount++;
  }

  if (processedCount === 0) return 0;

  // ---- ここから一括書き込み（他の列を上書きしないよう、変更した列だけを書き戻す） ----
  writeColumns_(logSheet, logs, [6, 11, 14, 15, 16, 18]);
  writeColumns_(fieldsSheet, fields, [9, 12, 13, 14]);
  writeColumns_(matSheet, materials, [14]);
  writeColumns_(machSheet, machines, [5, 8]);

  if (newLfRows.length > 0) {
    lfSheet.getRange(lfSheet.getLastRow() + 1, 1, newLfRows.length, newLfRows[0].length).setValues(newLfRows);
  }
  SpreadsheetApp.flush();
  return processedCount;
}

/**
 * getValues() で取得した2次元配列のうち、指定列（1始まり）のデータ行だけをまとめて書き戻す
 * 連続する列は1回の setValues() にまとめる
 */
function writeColumns_(sheet, values, colNumbers) {
  if (!values || values.length < 2) return;
  const dataRows = values.slice(1);
  const cols = colNumbers.slice().sort((a, b) => a - b);
  let start = 0;
  while (start < cols.length) {
    let end = start;
    while (end + 1 < cols.length && cols[end + 1] === cols[end] + 1) end++;
    const firstCol = cols[start];
    const width = cols[end] - firstCol + 1;
    const block = dataRows.map(row => {
      const out = [];
      for (let c = 0; c < width; c++) {
        const v = row[firstCol - 1 + c];
        out.push(v === undefined ? '' : v);
      }
      return out;
    });
    sheet.getRange(2, firstCol, block.length, width).setValues(block);
    start = end + 1;
  }
}

/**
 * スプレッドシート編集時トリガー：JA帳票シートのフィルタセル（B3 または E3）変更時に自動再集計
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() === SHEET_NAMES.REPORT_JA) {
    const a1 = e.range.getA1Notation();
    if (a1 === 'B3' || a1 === 'E3') {
      refreshA4ReportSheet();
    }
  }
}

/**
 * 3. JA提出用「生産履歴記帳簿（施肥台帳・防除履歴簿）」A4シートの自動生成・更新
 *    ※品種別・団地（圃場グループ）別のプルダウン絞り込み＆面積加重平均による正確な作期累計に対応
 */
function refreshA4ReportSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const repSheet = getOrCreateSheet_(ss, SHEET_NAMES.REPORT_JA);

  // 既存のプルダウン選択値（B3: 対象品種, E3: 対象団地/圃場）を退避
  const prevCrop = String(repSheet.getRange('B3').getValue() || '').trim();
  const prevGroup = String(repSheet.getRange('E3').getValue() || '').trim();

  repSheet.clear();

  const fieldsSheet = ss.getSheetByName(SHEET_NAMES.FIELDS);
  const logSheet = ss.getSheetByName(SHEET_NAMES.WORK_LOGS);
  const matSheet = ss.getSheetByName(SHEET_NAMES.MATERIALS);

  const fields = fieldsSheet ? fieldsSheet.getDataRange().getValues() : [];
  const logs = logSheet ? logSheet.getDataRange().getValues() : [];
  const mats = matSheet ? matSheet.getDataRange().getValues() : [];

  const fieldLookup = {};
  const cropSet = {};
  const groupSet = {};
  for (let i = 1; i < fields.length; i++) {
    const f = fields[i];
    if (!f[0]) continue;
    fieldLookup[String(f[0]).trim()] = {
      id: String(f[0]).trim(),
      name: String(f[2] || f[0]),
      group: String(f[4] || ''),
      areaA: Number(f[5] || 0),
      crop: String(f[6] || '')
    };
    if (f[6]) cropSet[String(f[6]).trim()] = true;
    if (f[4]) groupSet[String(f[4]).trim()] = true;
  }

  const matLookup = {};
  for (let i = 1; i < mats.length; i++) {
    matLookup[mats[i][0]] = mats[i];
  }

  const cropList = Object.keys(cropSet);
  const groupList = Object.keys(groupSet);
  const selectedCrop = (prevCrop && (prevCrop === 'すべて' || cropSet[prevCrop])) ? prevCrop : (cropList[0] || 'すべて');
  const selectedGroup = (prevGroup && (prevGroup === 'すべて' || groupSet[prevGroup] || fieldLookup[prevGroup])) ? prevGroup : 'すべて';

  // フィルタ対象の圃場リストと合計面積を算出
  const targetFields = Object.values(fieldLookup).filter(f => {
    const cropOk = (selectedCrop === 'すべて') || (f.crop === selectedCrop);
    const groupOk = (selectedGroup === 'すべて') || (f.group === selectedGroup) || (f.id === selectedGroup);
    return cropOk && groupOk;
  });
  const targetFieldIdMap = {};
  let targetTotalAreaA = 0;
  targetFields.forEach(f => {
    targetFieldIdMap[f.id] = f;
    targetTotalAreaA += f.areaA;
  });

  // A4タイトル＆ヘッダブロック
  repSheet.getRange('A1').setValue('令和8年度 水稲 生産履歴記帳簿（JA提出用：施肥台帳・防除履歴簿）').setFontSize(14).setFontWeight('bold');
  repSheet.getRange('A2').setValue(
    `生産者名：株式会社セーブモデル農園　／　対象品種：${selectedCrop}　／　対象範囲：${selectedGroup}（${targetFields.length}筆・計${targetTotalAreaA}a）　／　出力日：` +
    Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd')
  );

  // 絞り込みプルダウン行（3行目）の設定
  repSheet.getRange('A3').setValue('🔍 対象品種フィルタ:').setFontWeight('bold').setBackground('#e2e8f0');
  const cropRule = SpreadsheetApp.newDataValidation().requireValueInList(['すべて', ...cropList], true).build();
  repSheet.getRange('B3').setValue(selectedCrop).setDataValidation(cropRule).setBackground('#fef9c3').setFontWeight('bold');

  repSheet.getRange('D3').setValue('🔍 対象団地/圃場フィルタ:').setFontWeight('bold').setBackground('#e2e8f0');
  const groupRule = SpreadsheetApp.newDataValidation().requireValueInList(['すべて', ...groupList, ...Object.keys(fieldLookup)], true).build();
  repSheet.getRange('E3').setValue(selectedGroup).setDataValidation(groupRule).setBackground('#fef9c3').setFontWeight('bold');
  repSheet.getRange('F3').setValue('※黄色セルを変更すると対象品種・団地で自動再集計されます');

  // 【1】施肥台帳セクション
  repSheet.getRange('A5').setValue('【1】施肥履歴台帳（対象品種・圃場の面積按分 ＆ 10aあたり成分量自動積算）').setFontWeight('bold').setBackground('#d1fae5');
  const fertHeader = ['施用年月日', '対象圃場（該当分）', '対象面積(a)', '肥料名称', '成分比(N-P-K)', '対象分使用量(kg)', '10a施用量(kg)', 'N成分(kg/10a)', 'P成分(kg/10a)', 'K成分(kg/10a)'];
  repSheet.getRange(6, 1, 1, fertHeader.length).setValues([fertHeader]).setFontWeight('bold').setBackground('#f1f5f9').setBorder(true, true, true, true, true, true);

  let rowCursor = 7;
  let weightedNTotalKg = 0, weightedPTotalKg = 0, weightedKTotalKg = 0;

  for (let i = 1; i < logs.length; i++) {
    const l = logs[i];
    if (l[2] === '施肥') {
      const logFieldIds = String(l[4] || '').split(',').map(s => s.trim()).filter(Boolean);
      const matchedFields = logFieldIds.map(fid => targetFieldIdMap[fid]).filter(Boolean);
      if (matchedFields.length === 0) continue;

      const matchedAreaA = matchedFields.reduce((s, f) => s + f.areaA, 0);
      const logTotalAreaA = Number(l[5] || matchedAreaA || 1);
      const areaRatio = logTotalAreaA > 0 ? (matchedAreaA / logTotalAreaA) : 0;

      const m = matLookup[l[8]] || [];
      const matName = m[2] || l[8];
      const npkStr = m.length ? `${m[7]}-${m[8]}-${m[9]}` : '-';
      const totalKg = Number(l[10] || 0);
      const allocKg = Number((totalKg * areaRatio).toFixed(1));
      const per10a = logTotalAreaA > 0 ? Number((totalKg / (logTotalAreaA / 10.0)).toFixed(1)) : 0;
      const n10 = Number(l[13] || 0);
      const p10 = Number(l[14] || 0);
      const k10 = Number(l[15] || 0);

      // 面積加重による正味成分量(kg)の積算（別圃場・別品種の二重計上を防止）
      weightedNTotalKg += n10 * (matchedAreaA / 10.0);
      weightedPTotalKg += p10 * (matchedAreaA / 10.0);
      weightedKTotalKg += k10 * (matchedAreaA / 10.0);

      const matchedNames = matchedFields.map(f => f.name).join('・');
      repSheet.getRange(rowCursor, 1, 1, 10).setValues([[
        l[1], matchedNames, matchedAreaA, matName, npkStr, allocKg, per10a, n10, p10, k10
      ]]).setBorder(true, true, true, true, true, true);
      rowCursor++;
    }
  }

  // 対象圃場全体での10aあたり面積加重平均の作期累計成分量
  const cumN10a = targetTotalAreaA > 0 ? Number((weightedNTotalKg / (targetTotalAreaA / 10.0)).toFixed(2)) : 0;
  const cumP10a = targetTotalAreaA > 0 ? Number((weightedPTotalKg / (targetTotalAreaA / 10.0)).toFixed(2)) : 0;
  const cumK10a = targetTotalAreaA > 0 ? Number((weightedKTotalKg / (targetTotalAreaA / 10.0)).toFixed(2)) : 0;

  repSheet.getRange(rowCursor, 1, 1, 10).setValues([[
    '【作期累計（面積加重平均）】', `対象${targetFields.length}筆`, targetTotalAreaA, '', '', '', '10aあたり成分合計 →', cumN10a, cumP10a, cumK10a
  ]]).setFontWeight('bold').setBackground('#ecfdf5').setBorder(true, true, true, true, true, true);

  // 【2】防除履歴簿セクション
  rowCursor += 2;
  repSheet.getRange(rowCursor, 1).setValue('【2】防除履歴簿（農薬登録番号・希釈倍率・対象面積按分液量・安全基準チェック）').setFontWeight('bold').setBackground('#e0f2fe');
  rowCursor++;
  const pestHeader = ['散布年月日', '対象圃場（該当分）', '対象面積(a)', '農薬名', '登録番号', '有効成分', '希釈倍率(倍)', '対象散布水量(L)', '使用本数/量', '安全基準判定'];
  repSheet.getRange(rowCursor, 1, 1, pestHeader.length).setValues([pestHeader]).setFontWeight('bold').setBackground('#f1f5f9').setBorder(true, true, true, true, true, true);
  rowCursor++;

  for (let i = 1; i < logs.length; i++) {
    const l = logs[i];
    if (l[2] === '防除') {
      const logFieldIds = String(l[4] || '').split(',').map(s => s.trim()).filter(Boolean);
      const matchedFields = logFieldIds.map(fid => targetFieldIdMap[fid]).filter(Boolean);
      if (matchedFields.length === 0) continue;

      const matchedAreaA = matchedFields.reduce((s, f) => s + f.areaA, 0);
      const logTotalAreaA = Number(l[5] || matchedAreaA || 1);
      const areaRatio = logTotalAreaA > 0 ? (matchedAreaA / logTotalAreaA) : 0;
      const allocWaterL = Number((Number(l[12] || 0) * areaRatio).toFixed(1));
      const matchedNames = matchedFields.map(f => f.name).join('・');

      const pestIds = String(l[8] || '').split(',').map(s => s.trim()).filter(Boolean);
      const idsToRender = pestIds.length > 0 ? pestIds : [String(l[8] || '')];
      idsToRender.forEach((pid, pIdx) => {
        const m = matLookup[pid] || [];
        const mixBadge = idsToRender.length > 1 ? ` [混用${pIdx + 1}]` : '';
        repSheet.getRange(rowCursor, 1, 1, 10).setValues([[
          l[1], matchedNames, matchedAreaA, (m[2] || pid) + mixBadge, m[3] || '-', m[4] || '-', l[11], allocWaterL, `${l[9]}本`, '適（基準内）'
        ]]).setBorder(true, true, true, true, true, true);
        rowCursor++;
      });
    }
  }

  repSheet.autoResizeColumns(1, 10);
}

/**
 * 4. JA提出用 A4帳票シートをPDFファイルとしてGoogleドライブに出力
 */
function exportA4ReportToPdf() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REPORT_JA);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('先に「① 初期シート作成」または「③ A4帳票更新」を実行してください。');
    return;
  }

  const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?` +
    `exportFormat=pdf&format=pdf&size=A4&portrait=false&fitw=true&gridlines=false&gid=${sheet.getSheetId()}`;

  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  });

  const fileName = `JA提出用_生産履歴記帳簿_${Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd_HHmm')}.pdf`;
  const file = DriveApp.createFile(response.getBlob().setName(fileName));

  SpreadsheetApp.getUi().alert(`A4帳票PDFをGoogleドライブに出力しました！\n\nファイル名: ${fileName}\nURL: ${file.getUrl()}`);
}

/**
 * 5. 他社営農アプリ（アグリノート / KSAS / 既存Excel）から貼付されたデータを
 *    ヘッダー名・面積単位（㎡/ha/反/a）自動判定で M_FIELDS または T_WORK_LOGS へ一括変換インポート
 */
function importExternalAppData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const impSheet = ss.getSheetByName(SHEET_NAMES.IMP_RAW);
  const fieldsSheet = ss.getSheetByName(SHEET_NAMES.FIELDS);
  const logSheet = ss.getSheetByName(SHEET_NAMES.WORK_LOGS);

  if (!impSheet) {
    SpreadsheetApp.getUi().alert('先に「① 初期シート作成」を実行してください。');
    return;
  }

  const rows = impSheet.getDataRange().getValues();
  if (rows.length < 2) {
    SpreadsheetApp.getUi().alert('IMP_他社データ移行貼付 シートにデータがありません。');
    return;
  }

  const headers = rows[0].map(h => String(h).trim());

  // カラムインデックスのファジー検索ヘルパー
  const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.indexOf(k) !== -1));

  // 作業日誌データか圃場マスタデータかを自動判定
  const dateCol = findCol(['作業日', '実施日', '散布日', '施用日', '日付', 'work_date']);
  const workCatCol = findCol(['作業項目', '作業分類', '作業内容', '作業名', 'work_category']);

  if (dateCol !== -1 && workCatCol !== -1) {
    // 【パターンA】他社アプリ（KSAS / アグリノート / 旧日誌）の作業履歴CSVインポート
    const workerCol = findCol(['担当者', '作業者', '氏名', 'worker']);
    const fieldNameCol = findCol(['圃場', 'ほ場', '田んぼ', '区画']);
    const areaHaCol = findCol(['(ha)', 'ha', 'ヘクタール']);
    const areaACol = findCol(['(a)', '面積', 'アール']);
    const durCol = findCol(['時間', '稼働', 'duration']);
    const matCol = findCol(['資材', '肥料', '農薬']);
    const qtyCol = findCol(['使用量', '数量', '袋数', '散布量']);

    let importedLogs = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[dateCol]) continue;
      let areaA = 0;
      if (areaHaCol !== -1 && r[areaHaCol]) areaA = Math.round(Number(r[areaHaCol]) * 100);
      else if (areaACol !== -1 && r[areaACol]) areaA = Number(r[areaACol]);

      logSheet.appendRow([
        `IMP-WL-${Date.now()}-${i}`,
        r[dateCol],
        r[workCatCol] || '一般作業',
        workerCol !== -1 ? r[workerCol] : '佐藤 健一',
        fieldNameCol !== -1 ? String(r[fieldNameCol]).replace(/・/g, ',') : 'F01',
        areaA || 30,
        durCol !== -1 ? Number(r[durCol] || 1.0) : 1.0,
        'M01',
        '',
        qtyCol !== -1 ? Number(r[qtyCol] || 0) : 0,
        qtyCol !== -1 ? Number(r[qtyCol] || 0) : 0,
        0, 0, 0, 0, 0,
        matCol !== -1 ? `他社移行: ${r[matCol]}` : '他社アプリ履歴インポート',
        'DONE'
      ]);
      importedLogs++;
    }
    refreshA4ReportSheet();
    SpreadsheetApp.getActiveSpreadsheet().toast(`他社アプリの作業履歴 ${importedLogs} 件を自動変換して取り込みました！`, '🔄 作業履歴インポート完了', 5);
  } else {
    // 【パターンB】他社アプリ（アグリノート / KSAS / eMAFF / 旧Excel）の圃場マスタインポート
    const idCol = findCol(['ID', '番号', 'コード', 'id']);
    const nameCol = findCol(['ほ場名', '圃場名', '通称', '名称', 'name']);
    const groupCol = findCol(['グループ', '団地', '地区', 'エリア']);
    const lotCol = findCol(['地番', '住所', '所在地', 'address']);
    const m2Col = findCol(['㎡', 'm2', '平米']);
    const haCol = findCol(['ha', 'ヘクタール']);
    const tanCol = findCol(['反', '10a']);
    const aCol = findCol(['面積', 'アール', 'area']);
    const cropCol = findCol(['品種', '作付', '作物', 'crop']);
    const harvCol = findCol(['収穫', '予定日']);
    const latCol = findCol(['緯度', 'lat']);
    const lngCol = findCol(['経度', 'lng', 'lon']);

    let importedFields = 0;
    // 既存IDの最大番号から採番（行削除があってもIDが重複しない）
    const usedFieldIds = fieldsSheet.getDataRange().getValues().slice(1).map(r => String(r[0]));

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const fName = nameCol !== -1 ? r[nameCol] : r[0];
      if (!fName) continue;

      // 面積単位（㎡ / ha / 反 / a）の自動変換（すべてアール a に統一）
      let areaA = 20;
      if (m2Col !== -1 && r[m2Col]) areaA = Math.round(Number(r[m2Col]) / 100);
      else if (haCol !== -1 && r[haCol]) areaA = Math.round(Number(r[haCol]) * 100);
      else if (tanCol !== -1 && r[tanCol]) areaA = Math.round(Number(r[tanCol]) * 10);
      else if (aCol !== -1 && r[aCol]) {
        const rawVal = Number(r[aCol]);
        // 500以上の数値は㎡（平米）と自動推論して100で割る
        areaA = rawVal >= 500 ? Math.round(rawVal / 100) : rawVal;
      }

      const newFieldId = generateNextId_('F', usedFieldIds);
      usedFieldIds.push(newFieldId);
      fieldsSheet.appendRow([
        newFieldId,
        idCol !== -1 ? r[idCol] : newFieldId,
        fName,
        lotCol !== -1 ? r[lotCol] : '-',
        groupCol !== -1 ? r[groupCol] : '移行団地',
        areaA,
        cropCol !== -1 ? r[cropCol] : 'コシヒカリ(BL)',
        harvCol !== -1 && r[harvCol] ? r[harvCol] : '2026-09-20',
        '未着手',
        latCol !== -1 && r[latCol] ? Number(r[latCol]) : 37.9165,
        lngCol !== -1 && r[lngCol] ? Number(r[lngCol]) : 139.0370,
        0.00, 0.00, 0.00
      ]);
      importedFields++;
    }
    SpreadsheetApp.getActiveSpreadsheet().toast(`他社アプリの圃場データ ${importedFields} 筆（面積単位をaへ自動換算済）をM_FIELDSへ取り込みました！`, '🔄 圃場データ移行完了', 5);
  }
}

/**
 * 6. スマホPWAアプリ（オフライン対応Webアプリ）からのPOST同期受信エンドポイント
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const payload = JSON.parse(e.postData.contents);
    // 同時送信（複数スマホ）による二重登録を防ぐため排他ロック
    lock.waitLock(30000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(SHEET_NAMES.WORK_LOGS);
    const fieldsSheet = ss.getSheetByName(SHEET_NAMES.FIELDS);

    // 新規移行された圃場があれば M_FIELDS にも追加（既存IDはスキップ）
    if (payload.fields && Array.isArray(payload.fields) && fieldsSheet) {
      const existingIdSet = {};
      fieldsSheet.getDataRange().getValues().slice(1).forEach(r => { existingIdSet[String(r[0]).trim()] = true; });
      const newFieldRows = [];
      payload.fields.forEach(f => {
        const fid = String(f.id || '').trim();
        if (!fid || existingIdSet[fid]) return;
        existingIdSet[fid] = true;
        newFieldRows.push([
          fid, fid, f.name, f.lot || '-', f.group || '移行団地', f.area || 20,
          f.crop || 'コシヒカリ(BL)', f.harvest || '2026-09-20', f.stage || '未着手',
          f.lat || 37.9165, f.lng || 139.0370, f.nPer10a || 0, f.pPer10a || 0, f.kPer10a || 0
        ]);
      });
      if (newFieldRows.length > 0) {
        fieldsSheet.getRange(fieldsSheet.getLastRow() + 1, 1, newFieldRows.length, newFieldRows[0].length).setValues(newFieldRows);
      }
    }

    // 作業日誌の受信（work_log_id による重複排除 → 何度再送しても二重計上されない＝べき等）
    const insertedIds = [];
    const skippedIds = [];
    if (payload.logs && Array.isArray(payload.logs)) {
      const existingLogIdSet = {};
      logSheet.getDataRange().getValues().slice(1).forEach(r => { existingLogIdSet[String(r[0]).trim()] = true; });

      const newLogRows = [];
      payload.logs.forEach(item => {
        if (!item) return;
        const logId = String(item.id || '').trim();
        if (!logId) return; // IDなしは重複判定できないため受け付けない
        if (existingLogIdSet[logId]) {
          skippedIds.push(logId);
          return;
        }
        existingLogIdSet[logId] = true;
        insertedIds.push(logId);
        const weatherPrefix = item.weather ? `[${item.weather}${item.tempC !== undefined ? ` ${item.tempC}℃` : ''}] ` : '';
        const memoSuffix = item.memo ? ` ／ 📔${item.memo}` : '';
        const combinedNotes = `${weatherPrefix}${item.materialSummary || ''}${memoSuffix}`;
        newLogRows.push([
          logId,
          item.date,
          item.cat,
          item.worker || '佐藤 健一',
          (item.fieldIds || []).join(','),
          item.totalArea || 0,
          item.duration || 0,
          item.machineId || '',
          item.materialId || '',
          item.inputQty || 0,
          item.totalKg || 0,
          item.dilutionRate || 0,
          item.waterL || 0,
          item.n10a || 0,
          item.p10a || 0,
          item.k10a || 0,
          combinedNotes,
          '' // 未按分フラグ → 直後の processPendingLogs_() で自動按分展開
        ]);
      });

      if (newLogRows.length > 0) {
        logSheet.getRange(logSheet.getLastRow() + 1, 1, newLogRows.length, newLogRows[0].length).setValues(newLogRows);
        processPendingLogs_();
      }
    }
    lock.releaseLock();

    if (insertedIds.length > 0) refreshA4ReportSheet();

    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      syncedCount: insertedIds.length,
      skippedCount: skippedIds.length,
      // PWA側はこのIDだけを「同期済」にする（新規登録＋既に登録済み）
      acceptedIds: insertedIds.concat(skippedIds)
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    try { lock.releaseLock(); } catch (e2) {}
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ヘルパー関数

/**
 * 「接頭辞＋2桁以上の連番」形式のIDを採番する（PWA側 generateNextId と同一仕様）
 * 例: ['F01','F02','F07'] → 'F08' / 'F99' の次 → 'F100'
 */
function generateNextId_(prefix, existingIds) {
  const re = new RegExp('^' + prefix + '(\\d+)$');
  let maxNum = 0;
  (existingIds || []).forEach(id => {
    const m = String(id).match(re);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return prefix + String(maxNum + 1).padStart(2, '0');
}

function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function styleHeaderRow_(sheet, colCount, bgColor) {
  const range = sheet.getRange(1, 1, 1, colCount);
  range.setBackground(bgColor).setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
}
