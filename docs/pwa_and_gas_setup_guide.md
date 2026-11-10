# 本格PWAアプリ ＆ Googleスプレッドシート×GAS 導入・連携ガイド

ご選択いただいた **「1. スマホ実機でそのまま現場テストできる本格PWA化」** と **「2. Googleスプレッドシート＋GAS（自動面積按分＆A4帳票一発生成スクリプト）」** の両方を構築しました。

---

## 1. 本格PWA版 Webアプリ（追加された実運用機能）

[mockup_prototype.html](file:///C:/Users/syoma/.gemini/antigravity/brain/1255fae5-907d-4834-b9ad-53d906e3e4c8/mockup_prototype.html)（およびプロジェクトフォルダ内の [index.html](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/index.html)）をフル機能のPWAへアップグレードしました。

### 主な追加機能
1. **端末内データ自動保存（LocalStorage永続化）＆ JSONバックアップ**
   - 作業日誌の登録、資材の入庫・消費、機械アワーの加算、圃場の追加がすべてブラウザ内（`localStorage`）に即時保存され、**画面を閉じても電波が切れてもデータが消えません**。
2. **🛰️ 実GPS現在地測位による最寄り圃場サジェスト**
   - 「📱 1. 現場一括入力」タブの **『🛰️ 実GPSで現在地周辺を自動選択』** ボタンを押すと、スマホのGPS座標から各圃場までの直線距離（m）を自動計算し、現在いる団地の田んぼをワンタップでまとめて選択します。
3. **🔧 機械の「点検・オイル交換完了」記録 ＆ 📦 資材の「＋入庫」補充**
   - 「🚜 3. 機械・資材在庫」タブにて、オイル交換実施時のワンタップ次回目安更新や、肥料・農薬を購入した際のワンタップ在庫補充が可能になりました。
4. **⚙️ 5. マスタ登録・GASクラウド連携タブの新設**
   - 現場で新しい田んぼ（圃場）や新しい肥料銘柄（N-P-K成分比）をその場で追加登録でき、さらにGoogleスプレッドシート（GAS）への一括クラウド同期ボタンを備えています。
5. **オフラインキャッシュ（Service Worker + Manifest）**
   - 同梱の [manifest.json](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/manifest.json) と [sw.js](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/sw.js) により、スマホのホーム画面にアプリアイコンとして追加し、山間部の完全圏外でも起動できます。

---

## 2. Googleスプレッドシート ＋ GAS 自動按分＆A4帳票スクリプトの導入手順

作成した [Code.gs](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/gas/Code.gs) を使うと、**空のGoogleスプレッドシートからわずか1分で全テーブルとJA提出用A4帳票が自動構築**されます。

```mermaid
flowchart LR
    A["1. 空のGoogleスプレッドシートを開く"] --> B["2. 拡張機能 > Apps Script に\nCode.gs を貼り付け"]
    B --> C["3. メニュー『① 初期シート一括作成』\nをクリック"]
    C --> D["全5マスタ/日誌シート ＋\nJA提出A4帳票シートが自動完成！"]
    D --> E["AppSheet接続 または\nPWAアプリから直接データ同期"]
```

### ステップ1：スクリプトの貼り付けと初期構築（所要時間：約1分）
1. Googleドライブで **新規のGoogleスプレッドシート** を作成します。
2. 上部メニューの **「拡張機能」＞「Apps Script」** を開きます。
3. エディタに [Code.gs](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/gas/Code.gs) の中身をすべてコピー＆ペーストして保存（💾）します。
4. スプレッドシートの画面に戻ってページを再読み込みすると、上部メニューに **『🌾 らくらく営農日誌』** が表示されます。
5. **『🌾 らくらく営農日誌』＞『① 初期シート＆A4帳票テンプレートを一括作成』** をクリックします。
   - これだけで、`M_FIELDS`（圃場）、`M_MATERIALS`（資材）、`M_MACHINES`（機械）、`T_WORK_LOGS`（作業日誌）、`T_LOG_FIELDS`（面積按分明細）、『**A4帳票_JA生産履歴記帳簿**』の6シートが色分け・罫線付きで自動生成されます。

### ステップ2：自動面積按分・A4帳票PDF出力の使い方
- **面積按分・在庫・アワーの一括計算**：
  - `T_WORK_LOGS` シート（またはAppSheetフォーム）に「対象圃場（例：`F01,F02,F03`）」と「作業時間・袋数」を入力し、メニューの **『② 未処理の作業日誌を「面積按分・在庫・アワー」へ一括反映』** を押すと（トリガーで自動化も可能）、各田んぼの面積比率で `T_LOG_FIELDS` に明細行が自動展開され、累計NPK・機械アワー・資材在庫が同時更新されます。
- **JA提出用A4帳票のPDF出力**：
  - メニューの **『④ JA提出用 A4帳票をPDFファイル出力』** をクリックすると、A4横・罫線付きの完成フォーマットでGoogleドライブに提出用PDFファイルが一発出力されます。

### ステップ3：本格PWAアプリとスプレッドシートの直接同期（任意）
1. Apps Script画面の右上 **「デプロイ」＞「新しいデプロイ」** を選択します。
2. 種類で **「ウェブアプリ」** を選び、アクセスできるユーザーを **「全員」** にしてデプロイします。
3. 発行された **ウェブアプリURL（`https://script.google.com/macros/s/.../exec`）** をコピーし、PWAアプリの **「🔄 5. 他社データ移行・設定」タブ** にある「GAS ウェブアプリ URL」欄に貼り付けます。
4. これで、山間部のオフライン環境でスマホ入力した作業日誌や新規移行した圃場データが、**「☁️ スプレッドシート同期」ボタン1つでGoogleスプレッドシートへ直接飛んでいき、自動で面積按分とJA帳票更新まで完了**します。

---

## 3. 他社営農アプリ・既存Excel・eMAFF筆ポリゴンからのデータ移行仕様

農家が他社システムや既存のExcel台帳から乗り換える際の最大の壁である**「列名の違い」「面積単位の違い（㎡ / ha / 反 / a）」**を自動吸収するスマート移行エンジンを、**PWAアプリ側**と**Googleスプレッドシート（GAS）側**の双方に搭載しました。

| 移行元システム・フォーマット | 自動認識される主な項目 | 自動変換・正規化処理 |
| :--- | :--- | :--- |
| **📗 アグリノート (AgriNote)**<br>([sample_agrinote_fields.csv](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/migration_samples/sample_agrinote_fields.csv)) | `ほ場ID`, `ほ場名`, `地番・住所`, `面積(㎡)`, `品種名`, `収穫予定日`, `緯度`, `経度` | **面積単位の自動換算**：`2800㎡` → `28a` へ自動変換し `M_FIELDS` へ一括登録 |
| **📘 クボタ KSAS**<br>([sample_ksas_logs.csv](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/migration_samples/sample_ksas_logs.csv)) | `作業日`, `作業項目`, `圃場名称`, `登録面積(ha)`, `作業時間(h)`, `使用資材名`, `成分N/P/K(%)` | **面積単位＆NPKの自動換算**：`0.50ha` → `50a` へ変換、複数圃場名（`・`区切り）を自動紐付けし、NPK成分量とJA帳票へ即時反映 |
| **🗺️ 農水省 eMAFF農地ナビ / Z-GIS**<br>([sample_emaff_polygons.geojson](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/migration_samples/sample_emaff_polygons.geojson)) | GeoJSON `FeatureCollection`（`polygon_id`, `address`, `area_m2`, `coordinates`） | ポリゴン座標から中心緯度・経度を抽出し、平米面積をアール(`a`)に換算して圃場マスタへ一括登録 |
| **📊 既存「らくらく営農日誌」Excel / 汎用CSV** | 任意のExcel表コピー（タブ区切りTSV）またはCSV | ヘッダー行から「田んぼ名・地番・面積・品種」または「日付・作業・時間・資材」をファジー推論して自動マッピング |

---

## 4. 収穫・反収（10a収量）自動按分 ＆ 経営分析A4帳票（第3様式）

春の耕起・施肥から秋の収穫・経営振り返りまで一気通貫で完結できるよう、以下の機能を追加しました。

1. **🌾 収穫・刈取モード（複数圃場の面積按分・反収自動計算）**
   - 「📱 1. 現場一括入力」タブの作業種別で **`🌾 収穫・刈取`** を選ぶと、**「収穫袋数（30kg紙袋換算）」「玄米水分量(%)」「検査等級（1等〜3等）」** の入力パネルに切り替わります。
   - 複数の田んぼをまとめて刈り取った場合でも、袋数を入れるだけで **総収穫重量(kg)**・**10aあたり反収（俵 / kg）**・**各圃場への面積按分収量** がリアルタイムに算出されます。
2. **📊 A4帳票 第3様式：『圃場別「反収×NPK成分×労働時間」総括分析表』**
   - 「🖨️ 4. JA・行政 A4帳票」タブに3つ目の帳票を追加しました。
   - 各田んぼの **「累計チッソ(N)・リン酸(P)・カリ(K)投入量」「累計労働時間」「収穫量・10aあたり反収（俵）・検査等級」** が1枚のA4表に自動集計され、次年度の施肥設計（チッソ増減判断）や法人経営分析にそのまま活用できます。

---

## 5. デスクトップExcel派のための VBA自動流し込みマクロ

既存のExcel版「らくらく営農日誌」や手元のExcelブックで管理を続けたいケース向けに、**[RakurakuEinouMacro.bas](file:///C:/Users/syoma/.gemini/antigravity/scratch/rakuraku-einou-next/excel_vba/RakurakuEinouMacro.bas)** を作成しました。

- **`ImportPwaOrExternalCsv()`**：スマホPWAから出力したCSVや、他社アプリ（アグリノート・KSAS）のCSVを1クリックでExcelシートへ取り込みます。
- **`AllocateMultiFieldLogs()`**：「1作業×複数圃場」の一括記録行を、自動で圃場別のカルテ明細シート（`T_圃場別カルテ明細`）へ按分展開します。
- **`ExportJaReportToA4Pdf()`**：シートをA4横1ページ幅に自動整形し、ワンクリックで提出用PDFファイルを出力します。


