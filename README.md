# 🌾 次世代版「らくらく営農日誌 Next」プロジェクト

「らくらく営農日誌」をベースに、**「作業日報（労務・機械）」と「圃場管理記録（施肥・防除・収穫）」の1アクション完全統合**、**中山間地・飛び地での現場ファーストUI（完全オフライン・GPS連動・片手操作）**、および**JA・行政・GAP提出用A4完成帳票への一発出力**を実現する統合営農管理システムプロジェクトです。

---

## 📁 プロジェクトディレクトリ構成

```text
rakuraku-einou-next/
├── README.md                           # プロジェクト総合ガイド（本ファイル）
├── index.html                          # 本格PWA版 Webアプリ本体（オフライン永続化・GIS・面積按分・A4帳票・他社データ移行搭載）
├── manifest.json                       # PWA スマホホーム画面インストール用マニフェスト
├── sw.js                               # 完全オフライン動作用 Service Worker
├── docs/                               # 設計書・仕様書・ロードマップ一式
│   ├── requirements_and_db_design.md   # 1. 要件定義書・統合DB設計書（ER図・面積按分・NPK計算仕様）
│   ├── prototype_and_report_spec.md    # 2. プロトタイプ検証選定（AppSheet/Glide比較）＆ A4帳票出力仕様書
│   ├── pwa_and_gas_setup_guide.md      # 3. 本格PWA ＆ Googleスプレッドシート×GAS・他社データ移行 導入ガイド
│   └── task_roadmap.md                 # 4. 今後のタスク一覧・開発ロードマップ（Phase 0〜Phase 3）
├── gas/                                # Googleスプレッドシート × GAS 自動化バックエンド
│   └── Code.gs                         # 1クリック初期シート構築・面積按分・JA提出A4帳票生成・PWA同期APIスクリプト
├── excel_vba/                          # デスクトップExcel環境向けマクロ
│   └── RakurakuEinouMacro.bas          # CSV自動取込・複数圃場按分展開・A4横PDF一発出力VBAモジュール
├── templates/                          # AppSheet / Glide / スプレッドシート初期投入用CSVテンプレート
│   ├── 01_M_FIELDS.csv                 # 圃場マスタ
│   ├── 02_M_MATERIALS.csv              # 資材（肥料・農薬）マスタ
│   ├── 03_M_MACHINES.csv               # 機械アワーメーターマスタ
│   ├── 04_T_WORK_LOGS.csv              # 作業日誌ヘッダ（1作業×複数圃場トランザクション）
│   └── 05_T_LOG_FIELDS.csv             # 日誌×圃場 面積按分明細（カルテ履歴）
└── migration_samples/                  # 他社営農アプリ・行政データからの移行テスト用サンプル
    ├── sample_agrinote_fields.csv      # アグリノート (AgriNote) 形式 ほ場台帳サンプル（㎡→a自動換算）
    ├── sample_ksas_logs.csv            # クボタ KSAS 形式 作業日誌・施肥履歴サンプル（ha→a自動換算）
    └── sample_emaff_polygons.geojson   # 農林水産省 eMAFF農地ナビ / Z-GIS 筆ポリゴン (GeoJSON) サンプル
```

---

## 🚀 クイックスタート

1. **スマホ・ブラウザでPWAプロトタイプを動かす**
   - `index.html` をブラウザで開くと、現場一括入力・GIS進捗ヒートマップ・機械アワー・JA提出A4帳票出力・他社アプリデータ移行の全機能がその場で動作し、データは端末内（`localStorage`）に自動保存されます。
2. **Googleスプレッドシート ＋ GAS で自動按分＆A4帳票環境を作る**
   - 空のGoogleスプレッドシートを開き、「拡張機能 ＞ Apps Script」に `gas/Code.gs` を貼り付けてメニュー『🌾 らくらく営農日誌 ＞ ① 初期シート＆A4帳票テンプレートを一括作成』を実行してください（詳細は `docs/pwa_and_gas_setup_guide.md` 参照）。
3. **既存Excelで動かす**
   - ExcelのVBE（`Alt + F11`）に `excel_vba/RakurakuEinouMacro.bas` をインポートすると、CSV取込・面積按分・A4 PDF出力がワンクリックで実行できます。
