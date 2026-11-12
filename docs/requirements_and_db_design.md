# 次世代版「らくらく営農日誌」要件定義書・DB設計書

本ドキュメントは、株式会社セーブ「らくらく営農日誌」の強みである**実用的なA4完成帳票出力**を継承しつつ、**「作業日報（労務・機械）」と「圃場管理記録（施肥・防除・作業履歴）」の1アクション完全統合**、および**中山間地・飛び地での現場ファーストUI（スマホ片手操作・GIS連携・完全オフライン対応）**を実現するための要件定義およびデータベース（データモデル）設計書です。

---

## 1. システム基本方針（3大コアコンセプト）

```mermaid
flowchart LR
    subgraph Input["1. 現場ファーストの1アクション入力"]
        A["スマホ片手操作\n(オフライン対応)"] --> B["1作業 × 複数圃場\n一括選択・登録"]
    end
    subgraph Core["2. 日誌×営農管理 統合DB"]
        B --> C["作業日報\n(労務・機械稼働)"]
        B --> D["圃場カルテ\n(施肥NPK・防除・進捗)"]
        B --> E["在庫・メンテ連動\n(資材引落・アワー集計)"]
    end
    subgraph Output["3. 既存強みの継承（帳票一発出力）"]
        C & D & E --> F["JA提出用\n防除履歴簿・施肥台帳"]
        C & D & E --> G["行政・GAP提出用\nA4完成帳票 / Excel / PDF"]
    end
```

1. **「日誌」と「営農管理」の完全統合（1アクション同時記録）**
   - 作業者の日報（誰が・何時間・どの機械で）と、圃場側の記録（どの田んぼに・何を・どれだけ撒いたか）を別々に入力させず、**1回の作業登録トランザクションから両方のデータを自動生成・按分**します。
2. **現場ファーストなUI/UXの徹底（中山間地・飛び地対応）**
   - 航空写真マップ（GIS）やGPS現在地サジェストから点在する複数の田んぼをまとめてタップ選択し、手袋を外した片手操作・電波圏外（完全オフライン）でも数秒で記録を完了できる設計とします。
3. **既存ツールの強み（A4完成帳票作成）の完全継承**
   - 現場スマホで入力されたデータを、JA（防除履歴簿・施肥台帳）・行政・GAP監査用のA4定型フォーマット（PDF / Excel）へワンクリックで流し込み出力し、帰宅後のPC清書・二重入力をゼロにします。

---

## 2. 機能要件一覧（実装済み全機能 ＋ 次期拡張要件）

### 2.1 現場入力・日誌タイムライン・操作性（UI/UX）
| 要件ID | 状態 | 機能名称 | 要件詳細 |
| :--- | :---: | :--- | :--- |
| **UI-01** | ✅ 実装済 | **日誌×圃場 同時完結フロー** | 「作業内容・作業者・時間・使用機械・使用資材」と「対象圃場（複数可）」を1画面で入力し、作業日報と圃場カルテ履歴へ同時反映する。 |
| **UI-02** | ✅ 実装済 | **1作業・複数圃場の一括登録（面積比率按分）** | 草刈り・耕起・施肥・防除・収穫など、同一作業を複数の田んぼで行った際、選択した全圃場へ一括登録し、作業時間・資材使用量・収量を**各圃場の面積比率（`area_ratio`）で自動按分**する。 |
| **UI-03** | ✅ 実装済 | **「前回と同じ」ワンタップ複製** | 直近の作業内容（基肥散布、ドローン防除、昨日の続きの草刈り等）を1タップで呼び出し、対象圃場や数量だけを変えて即座に登録できる。 |
| **UI-04** | ✅ 実装済 | **片手操作・大画面ボタン設計** | 屋外の直射日光下でも視認性が高い高コントラスト配色と、手袋を外して親指だけで操作できる大型タイルボタン・ステッパーUIを採用する。 |
| **UI-05** | ✅ 実装済 | **営農日誌タイムライン（天候・気温・観察メモ・検索）** | 当日の天候・気温・生育観察メモ・引き継ぎ事項を記録し、フリーワード検索や作業分類フィルタで過去の日誌を即座に振り返ることができる。 |
| **UI-06** | ✅ 実装済 | **日誌のインライン編集・取消（自動ロールバック）** | 誤登録した作業日誌を後から編集またはワンタップで取消・削除でき、連動して引き落とされた資材在庫・加算された機械アワー・圃場累計NPKを自動で元に戻す（再計算する）。 |
| **UI-07** | ✅ 実装済 | **収穫・刈取モード（反収・等級・水分量自動按分）** | 収穫した30kg紙袋数・玄米水分量(%)・検査等級（1〜3等）を入力するだけで、総収穫量(kg)と**10aあたり反収（俵/kg）**を自動算出し、複数圃場へ面積按分する。 |

### 2.2 圃場・マップ管理・生育予測（GIS / GPS / Googleマップ連動）
| 要件ID | 状態 | 機能名称 | 要件詳細 |
| :--- | :---: | :--- | :--- |
| **GIS-01** | ✅ 実装済 | **航空写真×動的ポリゴン圃場マップ** | 航空写真・GISキャンバス上に各圃場の区画ポリゴン（新規追加・他社移行圃場を含む全筆）を動的描画し、飛び地や中山間地の田んぼも直感的に識別できるようにする。 |
| **GIS-02** | ✅ 実装済 | **作業進捗ヒートマップ表示** | 選択した作業工程（全体進捗・耕起・草刈り・施肥・防除・収穫）ごとに、各圃場を「未着手（灰）」「一部作業中（黄）」「完了（緑）」で色分け表示する。 |
| **GIS-03** | ✅ 実装済 | **実GPS現在地からの近隣圃場自動サジェスト** | スマホのGPS座標から各圃場までの直線距離(m)を算出し、現在地周辺（半径250m以内または同一団地）の田んぼを動的に自動選択する。 |
| **GIS-04** | ✅ 実装済 | **マップ連動・圃場カルテ表示** | 地図上の圃場をタップすると、地番・面積・作付品種・出穂日・収穫予定日・累計NPK投入量・過去の作業履歴を即座に確認できる。 |
| **GIS-05** | ✅ 実装済 | **航空写真（国土地理院）圃場ピッカー＆Googleマップ経路ナビ** | 国土地理院の航空写真タイル上で区画ポリゴンをタップして対象圃場を選択・解除でき、選択した複数圃場を回るGoogleマップ経路案内（ナビ）をワンタップで起動できる。 |
| **GIS-06** | ✅ 実装済 | **航空写真囲み作図 ＆ 面積自動測量（`㎡`→`a`）** | 新規圃場登録時に航空写真上で田んぼの四隅をタップして囲むだけで、平面直角近似＋座標法（Shoelace公式）により面積（`㎡`およびアール`a`）と中心緯度経度を自動測量・入力する。GoogleマップURL貼り付けからの座標抽出にも対応する。 |
| **GIS-07** | ✅ 実装済 | **水稲「出穂後積算温度（1,000℃）」＆刈取適期予測** | 各圃場の出穂日と日平均気温から積算温度（℃）をトラッキングし、1,000℃到達による刈取適期予測日と進捗バーをヒートマップ・カルテに表示する。 |
| **GIS-08** | ✅ 実装済 | **現地見回りメモ＆被害アラート（獣害・水漏れ・雑草）** | 見回り時に発見したイノシシ等の獣害・畦畔水漏れ・雑草・病害虫を1タップでピン留めし、マップや圃場選択タイルに `⚠️` 警告バッジを表示・解決消込できる。 |

### 2.3 農薬・肥料・安全管理（自動計算・混用防除）
| 要件ID | 状態 | 機能名称 | 要件詳細 |
| :--- | :---: | :--- | :--- |
| **SAF-01** | ✅ 実装済 | **希釈倍率・必要薬量の自動逆算電卓** | 対象圃場の合計面積（a）と、10aあたり散布水量・希釈倍率（例：1000倍、ドローン8倍）から、「必要な総水量（L）」と「必要な農薬原液量（mL/g）」を自動逆算する。 |
| **SAF-02** | ✅ 実装済 | **成分量（N・P・K）の自動積算** | 投入した肥料の「袋数」を入力するだけで、肥料マスタの成分含有率（N-P-K %）から**10aあたりおよび圃場全体の正味成分量（kg）**を自動計算し、作期累計を合算する。 |
| **SAF-03** | ✅ 実装済 | **農薬安全基準（使用回数・収穫前日数PHI）チェック** | 農薬マスタの総使用回数上限および収穫前日数制限（`収穫予定日 - 作業日 < phiDays`）をリアルタイム判定し、超過時は警告表示とともに誤登録をブロックする。 |
| **SAF-04** | ✅ 実装済 | **2剤タンクミックス（混用防除）同時計算・在庫連動** | 殺菌剤＋殺虫剤など2種類の農薬を同時に混合散布する際、第1農薬・第2農薬それぞれの必要原液量算出・安全基準判定・在庫引き落としを1回の防除記録で同時処理する。 |
| **SAF-05** | ✅ 実装済 | **有効成分（RAC/成分名）別の延べ使用回数カウント** | 商品名が異なっても同一の有効成分を含む農薬が散布された場合、成分単位での延べ使用回数を合算して上限超過をチェックする。 |

### 2.4 機械・資材・マスタ管理・圃場別採算分析
| 要件ID | 状態 | 機能名称 | 要件詳細 |
| :--- | :---: | :--- | :--- |
| **RES-01** | ✅ 実装済 | **機械稼働時間集計・点検アラート・整備リセット** | 日誌の作業時間から各農機の累計稼働時間を自動集計し、点検閾値（残り10h以内）で警告を表示。「オイル交換・点検完了」ボタンで次回点検目安をワンタップ更新する。 |
| **RES-02** | ✅ 実装済 | **資材（肥料・農薬）の在庫自動引落・入庫補充** | 作業日誌で記録した農薬・肥料の使用量を現在庫から自動引き落とし、発注点割れを警告。追加購入時は「＋入庫」ボタンで即座に在庫補充できる。 |
| **RES-03** | ✅ 実装済 | **作業者別の労務・作業時間集計** | 作業者ごとの日別・作業分類別の労働時間および圃場別の面積按分労働時間を自動集計する。 |
| **RES-04** | ✅ 実装済 | **農機具・肥料・農薬・圃場マスタの追加・削除（CRUD）** | 現場画面（タブ3・タブ5）からいつでも新しい農機具、肥料銘柄（NPK比率・単価）、農薬（登録番号・有効成分・PHI・単価）、圃場を追加・削除できる。 |
| **RES-05** | ✅ 実装済 | **圃場別「10aあたり原価・粗利・採算ランク（S〜C）」試算** | 各圃場に投入した肥料費・農薬費・労務費・機械償却燃料費と収穫反収から、10aあたりの売上・原価・粗利益・採算ランク（S/A/B/C）を自動試算する（米価・時給シミュレーション対応）。 |

### 2.5 帳票・データ移行・システム環境・バックアップ
| 要件ID | 状態 | 機能名称 | 要件詳細 |
| :--- | :---: | :--- | :--- |
| **OUT-01** | ✅ 実装済 | **JA・行政・GAP提出用 A4完成帳票出力（3様式）** | ①JA提出用「生産履歴記帳簿（施肥・防除台帳）」、②行政・法人用「作業日報・面積按分表」、③経営・GAP用「圃場別 反収×NPK×労働時間×10a原価・粗利 総括分析表」をA4横レイアウトで一発印刷・PDF保存・CSV出力する。 |
| **OUT-02** | ✅ 実装済 | **品種別・団地別フィルタ ＆ 面積加重平均NPK集計** | JA提出帳票において対象品種・団地・個別圃場での絞り込みに対応し、複数回に分けて施肥した場合も面積加重平均により正確な10aあたり累計NPK成分量を算出する。 |
| **OUT-03** | ✅ 実装済 | **Googleスプレッドシート×GAS ＆ Excel VBA 双方向連携** | GASによる1クリック初期シート構築・未処理ログ自動按分・A4 PDF出力、およびデスクトップExcel VBAマクロ（`M_圃場マスタ`連動按分）による既存Excel環境との完全互換を提供する。 |
| **SYS-01** | ✅ 実装済 | **完全オフライン駆動（PWA）＆ クラウド同期** | Service WorkerとLocalStorage永続化により電波圏外の山間部でも100%動作し、オンライン復帰時にGASウェブアプリへ未同期日誌・新規圃場を一括送信する。 |
| **SYS-02** | ✅ 実装済 | **他社営農アプリ・eMAFF筆ポリゴン スマートデータ移行** | アグリノート、クボタKSAS、農水省eMAFF農地ナビ（GeoJSON）、既存Excel台帳のファイルを読み込み、列名の違いや面積単位（`㎡`・`ha`・`反` → `a`）を自動判別・換算して一括インポートする。 |
| **SYS-03** | ✅ 実装済 | **JSONフルバックアップ＆1クリック復元・アプリ内説明書** | 端末内の全データをJSONファイルとして出力・復元できるほか、オフラインでも閲覧可能な「📖 使い方・説明書」モーダルを内蔵する。 |

### 2.6 【Phase 2 拡張要件】高度データ解析・気象連携・AI診断（`TSK-036`〜`TSK-040`）
| 要件ID | 状態 | 機能名称 | 要件詳細 |
| :--- | :---: | :--- | :--- |
| **ANA-01** | 🚀 計画中 | **チッソ(N)施肥量×反収の二次曲線回帰（最適施肥算出）** | 最小二乗法による二次関数回帰（$y = ax^2 + bx + c$）で収穫逓減カーブを描画し、反収・粗利が最大となるピークの最適チッソ施肥量を自動算出する（`TSK-036`）。 |
| **ANA-02** | 🚀 計画中 | **全圃場4象限ポートフォリオ解析（バブルチャート）** | 「10aあたり作業時間」×「10aあたり粗利益」×「面積バブル」の4象限マトリクスにより、全圃場を「🌟優良主力田 / 🔧改善余地田 / 💦労力過多田 / ⚠️要見直し田」に自動分類する（`TSK-037`）。 |
| **ANA-03** | 🚀 計画中 | **気象API自動連携 ＆ 高温障害・病害虫予察アラート** | Open-Meteo APIから気温・雨量・風速を取得し、出穂後20日間の高温登熟障害リスク、いもち病・カメムシ予察、ドローン防除可否（風速4m/s判定）を自動通知する（`TSK-038`）。 |
| **ANA-04** | 🚀 計画中 | **AI営農アドバイザー ＆ 次週優先ToDo提案・音声入力** | 日誌メモ・見回りアラート・積算温度から次週優先すべき作業を自動提案し、Web Speech APIによる音声入力文字起こしを支援する（`TSK-039`）。 |
| **ANA-05** | 🚀 計画中 | **月別・旬別「労働時間＆コスト構造」パレート分析** | 作業分類別の工数・コストを累積構成比（パレート図）で可視化し、経営を圧迫している上位ボトルネック作業の削減インパクトを試算する（`TSK-040`）。 |

---

## 3. 基本設計①：システム全体アーキテクチャ・モジュール構成設計

本システムは、**「山間部・圏外の現場でも100%即応するオフラインファーストPWA」** を中核とし、**「Googleスプレッドシート / GASクラウド基盤（トークン認証付）」** および **「事務PC用Excelマクロ版」** のハイブリッド三層構成を採用しています。

```mermaid
flowchart TB
    subgraph Frontend["📱 フロントエンド層（PWA / スマホ・タブレット・PCブラウザ）"]
        UI["index.html + css/styles.css<br/>(5タブUI + 操作マニュアルモーダル / ダークモード / A4印刷CSS)"]
        APP["js/app.js<br/>(業務ロジック・面積按分・安全チェック・GIS・帳票・データ移行)"]
        DATA["js/data.js<br/>(マスタ定義・LocalStorage永続化・自動ロールバック再計算)"]
        SW["sw.js + manifest.json<br/>(Service Worker オフラインキャッシュ・タイル上限600件管理)"]
        MAP["Leaflet.js + 国土地理院 航空写真タイル<br/>(GIS進捗ヒートマップ・航空写真ポリゴン面積測量・Googleマップ外部ナビ連携)"]
        UI --> APP
        APP --> DATA
        APP --> MAP
        SW -.-> UI
    end

    subgraph Storage["💾 ローカル永続化＆入出力"]
        LS[("Browser LocalStorage<br/>STORAGE_KEY: rakuraku_einou_next_pwa_state_v1")]
        JSON["JSONフルバックアップ / CSV出力"]
        EXT["他社データ移行インポート<br/>(アグリノート / KSAS / eMAFF GeoJSON / Excel)"]
        DATA <--> LS
        APP --> JSON
        EXT --> APP
    end

    subgraph Cloud["☁️ クラウド＆事務PC連携層（任意連携）"]
        GAS["gas/Code.gs<br/>(Google Apps Script API / doPost + SYNC_TOKEN認証)"]
        GS[("Google スプレッドシート<br/>M_FIELDS / T_WORK_LOGS / T_LOG_FIELDS 等")]
        VBA["excel_vba/RakurakuEinouMacro.bas<br/>(デスクトップExcel 一括按分＆A4 PDF出力)"]
        APP -- "オンライン復帰時 POST同期 (SYNC_TOKEN照合)" --> GAS
        GAS <--> GS
        JSON -- "CSV取込" --> VBA
    end
```

### 3.1 ファイル・モジュール構成一覧

| レイヤー | ファイルパス | 役割・主な責務 |
| :--- | :--- | :--- |
| **View (HTML)** | `index.html` | 全5タブ（現場一括入力・GISマップ・機械/資材・A4帳票・設定/データ移行）およびアプリ内操作マニュアルモーダルのDOM構造定義 |
| **Style (CSS)** | `css/styles.css` | ライト/ダークテーマ変数定義、スマホ片手操作UI、GISポリゴン描画スタイル、A4横向き印刷専用 `@media print` 制御 |
| **Model / State** | `js/data.js` | 初期マスタ定義、`localStorage` 保存・読込（`saveStateToStorage` / `loadStateFromStorage`）、日誌編集・削除時の全圃場ステータス＆NPK累計自動ロールバック再計算（`recalculateFieldStats`）、積算温度・採算性試算 |
| **Controller / Logic** | `js/app.js` | 1アクション複数圃場按分、2剤タンクミックス逆算、農薬回数・PHIチェック、積算温度予測、見回りアラート、10a採算ランク試算、A4帳票3様式描画、他社データ自動マッピング移行 |
| **PWA基盤** | `sw.js`, `manifest.json` | オフライン時のHTML/CSS/JS/アセットキャッシュ応答、国土地理院航空写真タイルのキャッシュ上限（最大600タイル）管理、ホーム画面インストール定義 |
| **Cloud Backend** | `gas/Code.gs` | Googleスプレッドシート自動構築（`setupAllSheets`）、未処理日誌の面積按分展開（`processPendingLogs_`）、A4帳票生成・PDF出力、Webアプリ `doPost(e)` 受信（スクリプトプロパティ `SYNC_TOKEN` による定数時間トークン認証＆べき等チェック） |
| **Desktop Excel** | `excel_vba/RakurakuEinouMacro.bas` | RFC4180準拠CSVパーサー、`M_圃場マスタ` 連携による複数圃場自動按分転記（`AllocateMultiFieldLogs`）、A4横1ページPDF出力 |

---

## 4. 基本設計②：画面構成・画面遷移設計（全5タブ＋操作マニュアルモーダル）

現場作業者の「親指1本での即入力」と、事務・経営者の「一発帳票出力・採算分析」を両立するため、**5画面切り替え＋インライン地図作図ピッカー＋操作マニュアルモーダル構成**としています。

| 画面ID | 画面名 | 主な機能・UIコンポーネント | 主要関数（`js/app.js`） |
| :--- | :--- | :--- | :--- |
| **`tab-input`** | **① 現場一括入力＆営農日誌** | ・作業分類選択（耕起/代かき/田植え/草刈り/施肥/防除/収穫）<br/>・「⚡前回と同じ」ワンタップ履歴プリセット呼出<br/>・天候・気温・生育観察メモ（ワンタップ定型句タグ付）入力<br/>・団地別選択＆実GPS近接自動セレクト＆航空写真連動ピッカー（その場での新規区画囲み作図登録対応）<br/>・施肥NPK自動計算 / 防除2剤混用希釈逆算＆PHI・有効成分回数チェック / 収穫水分・等級・反収自動換算<br/>・作業日誌タイムライン（キーワード検索・その場修正・取消ロールバック） | `selectWorkCat()`, `applyPreset()`, `detectGpsNearestFields()`, `recalculatePreview()`, `submitUnifiedWorkLog()`, `editWorkLog()`, `deleteWorkLog()`, `renderDiaryTimeline()` |
| **`tab-gis`** | **② GIS圃場マップ・積算温度・カルテ** | ・6種ヒートマップ切替（全体進捗 / 耕起 / 草刈り / 施肥 / 防除 / 🌡️積算温度・刈取適期）<br/>・圏外対応SVGブロック図（GeoJSON形状正規化投影対応）＆国土地理院航空写真マップ切替<br/>・右側：圃場詳細カルテ（基本情報・累計NPKバー・出穂後積算温度1,000℃予測・見回りアラートピン留め/解決・作業履歴一覧） | `setHeatmapLayer()`, `switchGisMapMode()`, `renderGisHeatmap()`, `renderDynamicGisPolygons_()`, `inspectField()`, `updateFieldHeadingDate()`, `addFieldAlert()`, `resolveFieldAlert()` |
| **`tab-resource`** | **③ 機械アワー・資材在庫・マスタ管理** | ・農機具稼働時間＆次回オイル交換までの残り時間プログレスバー<br/>・「🔧 点検完了」ワンタップ更新<br/>・肥料・農薬の現在庫数一覧＆ワンタップ入庫補充（＋10袋／＋5本）<br/>・農機具・肥料・農薬マスタのクイック新規追加フォーム＆削除機能 | `renderResourcesTab()`, `completeMachineMaintenance()`, `restockMaterial()`, `addNewMachineMaster()`, `addNewFertilizerMaster()`, `addNewPesticideMaster()`, `deleteMachineMaster()`, `deleteMaterialMaster()` |
| **`tab-report`** | **④ A4完成帳票出力（全3様式）** | ・**様式1 (`ja`)**: JA提出用 生産履歴記帳簿（品種・団地・個別圃場フィルタ、面積加重平均NPK、散布時点の有効成分回数・PHI動的判定付防除履歴簿）<br/>・**様式2 (`daily`)**: 行政・法人用 営農作業日報 兼 機械稼働・圃場別按分実績表<br/>・**様式3 (`yield`)**: 経営・GAP用 圃場別「反収×投入NPK×労働時間×10a原価・粗利・採算ランク（S/A/B/C）」総括分析表（想定米価・時給シミュレータ付）<br/>・A4印刷/PDF出力、Excel/CSVダウンロード | `switchReportType()`, `renderReportsTab()`, `updateCostSettingsFromUi()`, `exportCsvData()` |
| **`tab-settings`** | **⑤ 他社データ移行・設定・圃場登録** | ・他社データ移行ウィザード（アグリノート / クボタKSAS / 農水省eMAFF農地ナビGeoJSON / 既存Excel）<br/>・新規圃場マスタ登録フォーム（GoogleマップURL座標抽出＋インライン航空写真ポリゴン作図・面積自動測量）<br/>・GASクラウド同期URL＆同期用トークン（`SYNC_TOKEN`）設定・同期送信<br/>・JSONフルバックアップ保存・復元・初期データリセット | `loadMigrationSample()`, `parseAndPreviewMigrationText()`, `executeMigrationImport()`, `addNewFieldMaster()`, `syncWithGasBackend()`, `exportFullBackupJson()`, `importFullBackupJson()` |
| **`userManualModal`** | **モーダル：アプリ内操作マニュアル** | ・ヘッダーの「📖 使い方・説明書」ボタンからいつでも参照できる現場・事務向けクイックガイド | `toggleUserManualModal()` |

---

## 5. 基本設計③：統合データモデル設計（ER図・実装スキーマ）

**「1回の入力で、作業日報と複数圃場の履歴・NPK計算・2剤防除・収穫反収・在庫引落・機械稼働を同時に完結させる」** ため、作業日誌オブジェクト `workLogs` に対象圃場ID配列 `fieldIds` を保持し、**面積比率（`area_ratio = field.area / log.totalArea`）によって作業時間や資材投入量を各圃場へ自動按分する**構造を採ります。

```mermaid
erDiagram
    FIELDS ||--o{ WORK_LOGS : "fieldIds(複数圃場按分)"
    FIELDS ||--o{ FIELD_ALERTS : "alerts(見回りアラート)"
    MACHINES ||--o{ WORK_LOGS : "machineId(稼働加算)"
    FERTILIZERS ||--o{ WORK_LOGS : "materialId(施肥)"
    PESTICIDES ||--o{ WORK_LOGS : "materialIds(主剤/混用剤)"

    FIELDS {
        string id PK "圃場ID(F01等)"
        string name "圃場名(① 本場1号等)"
        string lot "地番・所在地"
        string group "団地コード(gps:本場 / yama:上山田 / river:川向)"
        int area "面積(a:アール)"
        string crop "作付品種名(コシヒカリ(BL) / つきあかり等)"
        string stage "現在進捗ステータス(未着手/耕起済/施肥済等)"
        string harvest "収穫予定日(YYYY/MM/DD：PHI安全チェック用)"
        string headingDate "出穂日(YYYY/MM/DD：積算温度計算用)"
        int targetTempC "目標積算温度(コシヒカリ1000℃ / つきあかり950℃)"
        decimal dailyMeanTempC "日平均気温(平場25.5℃ / 山間23.2℃)"
        decimal nPer10a "10aあたり累計チッソ量(kg/10a)"
        decimal pPer10a "10aあたり累計リン酸量(kg/10a)"
        decimal kPer10a "10aあたり累計カリ量(kg/10a)"
        int harvestKg "累計収穫量(kg)"
        decimal yieldTawara10a "10aあたり反収(俵/10a)"
        string grade "検査等級(1等/2等/3等)"
        decimal lat "中心緯度(GPS距離ソート用)"
        decimal lng "中心経度(GPS距離ソート用)"
        json polygonCoords "GISポリゴン頂点座標配列([[lng,lat],...])"
        json pestCount "製品ID別累積使用回数マップ"
        json ingredientCount "有効成分名別累積使用回数マップ"
        json alerts "見回りアラート配列({id, date, text})"
    }

    WORK_LOGS {
        string id PK "作業日誌ID(WL-xxxxx)"
        string date "作業日(YYYY/MM/DD)"
        string cat "作業分類(耕起/代かき/田植え/草刈り/施肥/防除/収穫)"
        string type "ログ種別(general / fertilizer / pesticide / harvest)"
        string worker "作業者名"
        string weather "天候(☀️ 晴れ / ⛅ 曇り / 🌧️ 雨 / 💨 強風)"
        int tempC "気温(℃)"
        string memo "営農日誌・生育観察・引き継ぎメモ"
        json fieldIds "対象圃場ID配列(['F01','F02',...])"
        int totalArea "対象圃場 合計面積(a)"
        decimal duration "総作業時間(h)"
        string machineId FK "使用機械ID"
        string machineName "使用機械名"
        string materialId "使用資材ID(混用時はカンマ区切り)"
        json materialIds "防除時の使用農薬ID配列(['P01','P02'])"
        int inputQty "投入数量(肥料袋数 / 農薬使用本数)"
        int dilutionRate "希釈倍率(倍：1000 / 500 / 8)"
        decimal waterL "総散布液量(L)"
        string chemAmount "総使用薬量表記(mL)"
        decimal totalKg "総施肥量または総収穫量(kg)"
        decimal per10aKg "10aあたり施肥量(kg/10a)"
        decimal n10a "10aあたりチッソ量(kg/10a)"
        decimal p10a "10aあたりリン酸量(kg/10a)"
        decimal k10a "10aあたりカリ量(kg/10a)"
        int harvestBags "収穫袋数(30kg紙袋換算)"
        decimal yieldTawara10a "10aあたり反収(俵/10a)"
        string grade "収穫検査等級(1等/2等/3等)"
        string moisture "玄米水分(%)"
        boolean safetyOk "防除登録時の安全基準判定結果"
        boolean synced "GASクラウド同期済フラグ"
    }

    FERTILIZERS {
        string id PK "肥料ID(F01等)"
        string name "肥料名称"
        int unitKg "1袋あたり重量(kg)"
        decimal n "チッソ(N)含有率(%)"
        decimal p "リン酸(P)含有率(%)"
        decimal k "カリ(K)含有率(%)"
        int stock "現在庫数(袋)"
        int minStock "発注点在庫数(袋)"
        int priceYen "1袋あたり単価(円)"
    }

    PESTICIDES {
        string id PK "農薬ID(P01等)"
        string name "農薬名称"
        string regNo "農薬登録番号"
        string activeIngredient "有効成分名(回数名寄せ集計キー)"
        int maxUse "総使用回数上限(回)"
        int phiDays "収穫前日数制限(PHI：日)"
        int stock "現在庫数(本/袋)"
        string unit "規格単位表記"
        int priceYen "1本/1袋あたり単価(円)"
    }

    MACHINES {
        string id PK "機械ID(M01等)"
        string name "機械名・型式"
        string cat "分類(トラクター/乗用モア/ドローン/田植機等)"
        decimal currentHour "現在累計アワーメーター(h)"
        decimal nextMaint "次回点検目安アワー(h)"
        decimal interval "点検周期(h)"
        int hourlyCostYen "1時間あたり稼働単価(円/h)"
    }
```

---

## 6. 基本設計④：コア計算・業務アルゴリズム仕様

### 6.1 面積比率按分（`area_ratio`）と面積加重平均NPK計算ロジック
現場で複数圃場 $F_1, F_2, \dots, F_k$（各面積 $A_i\text{ [a]}$）を選択して一括登録した場合、以下の数式で各圃場へ自動按分します。

1. **選択圃場の合計面積**:
   $$A_{\text{total}} = \sum_{i=1}^{k} A_i \quad [\text{a}]$$
2. **各圃場の面積按分比率（`area_ratio`）**:
   $$r_i = \frac{A_i}{A_{\text{total}}}$$
3. **10aあたり施用量・成分量（JA提出用・各圃場への加算値）**:
   - 肥料1袋あたり重量 $W_{\text{bag}}\text{ [kg]}$、使用合計袋数 $B\text{ [袋]}$、成分含有率 $N_{\%}, P_{\%}, K_{\%}$ のとき：
   $$\text{総施肥重量 } W_{\text{total}} = B \times W_{\text{bag}} \quad [\text{kg}]$$
   $$\text{10aあたり施肥量 } w_{10\text{a}} = \frac{W_{\text{total}}}{A_{\text{total}} / 10} \quad [\text{kg/10a}]$$
   $$\Delta N_{10\text{a}} = w_{10\text{a}} \times \frac{N_{\%}}{100}, \quad \Delta P_{10\text{a}} = w_{10\text{a}} \times \frac{P_{\%}}{100}, \quad \Delta K_{10\text{a}} = w_{10\text{a}} \times \frac{K_{\%}}{100} \quad [\text{kg/10a}]$$
4. **複数圃場選択時の「面積加重平均」表示（JA帳票フッター等）**:
   $$N_{\text{weighted}} = \frac{\sum_{i=1}^{k} \left( N_{10\text{a}, i} \times (A_i / 10) \right)}{A_{\text{total}} / 10}$$

---

### 6.2 防除2剤タンクミックス逆算 ＆ 有効成分回数・PHI安全基準判定ロジック
1. **総散布水量（L）**:
   $$V_{\text{water}} = \frac{A_{\text{total}}}{10} \times v_{10\text{a}} \quad [\text{L}] \quad (\text{※ドローン防除時は } v_{10\text{a}} = 0.8\text{ L/10a (8倍)}, \text{ ブーム・動噴は } 100\text{ L/10a (1000倍/500倍)})$$
2. **主剤（第1農薬）および混用剤（第2農薬）の必要原液量（mL）**:
   - タンクミックス時は選択した希釈倍率 $D$ を共通適用し、各剤それぞれの必要原液量を算出します：
   $$Q_{\text{pest}} = \frac{V_{\text{water}} \times 1000}{D} \quad [\text{mL}] \quad (\text{2剤混用時は各剤とも } Q_{\text{pest}}\text{ mL})$$
3. **リアルタイム安全基準チェック（主剤・第2剤それぞれに対して検証＋ハードブロック）**:
   - **製品別および有効成分別（`activeIngredient`）累積回数チェック**:
     選択された各圃場 $F_i$ について、過去の防除履歴での同一製品使用回数 $C_{\text{prod}}(F_i)$ および同一有効成分使用回数 $C_{\text{ai}}(F_i)$（今回同時に混用する2剤が同一有効成分の場合の加算分 $a_{\text{batch}}$ を含む）を集計し、
     $$\left(C_{\text{prod}}(F_i) + 1 > \text{maxUse}\right) \lor \left(C_{\text{ai}}(F_i) + a_{\text{batch}} > \text{maxUse}\right) \implies \text{🚨 使用回数超過エラー（登録ブロック）}$$
   - **収穫前日数（PHI: Pre-Harvest Interval）チェック**:
     $$\text{harvest}(F_i) - \text{workDate} < \text{phiDays} \implies \text{🚨 収穫前日数(PHI)違反エラー（登録ブロック）}$$

---

### 6.3 日誌編集・取消時の自動ロールバック再計算アルゴリズム（`recalculateFieldStats`）
日誌の事後修正（`editWorkLog`）や削除（`deleteWorkLog`）を行ってもデータの整合性が崩れないよう、更新時は全圃場の集計値を初期ベースライン（`f.baseline`）にリセットした上で、時系列順（古い順）に全作業日誌を再評価します。また、修正登録の途中で万が一例外が発生した場合は `try / catch` により自動的に変更前のログを復元（`abort()`）します。

1. 全圃場の `nPer10a`, `pPer10a`, `kPer10a`, `pestCount`, `doneCats`, `stage`, `harvestKg`, `yieldTawara10a`, `grade` をベースライン値へ初期化。
2. `workLogs` を日付昇順（`YYYY/MM/DD`）で走査し、対象圃場ごとに：
   - `type === 'fertilizer'` の場合、$\Delta N_{10\text{a}}, \Delta P_{10\text{a}}, \Delta K_{10\text{a}}$ を再加算。
   - `type === 'pesticide'` の場合、主剤および混用第2剤の使用回数を `pestCount` に加算し、さらに農薬マスタの `activeIngredient` で名寄せして `ingredientCount` を再構築。
   - `type === 'harvest'` の場合、面積比率 $r_i$ で按分した収穫量 $\text{harvestKg}_i$ と反収 $\text{yieldTawara10a}_i$、検査等級 `grade` を反映。
   - 作業分類 `cat` を `doneCats` に追加し、最新作業分類から `stage = "${cat}済"` を更新。

---

### 6.4 航空写真マップ上のポリゴン面積自動測量アルゴリズム（平面直角近似・座標法）
入力タブおよび設定タブの航空写真ポリゴン作図では、頂点列 $(\lambda_i, \phi_i)$ の重心 $(\bar{\lambda}, \bar{\phi})$ を基準に、緯度1度あたり $111,320\text{ m}$・経度1度あたり $111,320 \times \cos(\bar{\phi})\text{ m}$ の平面直角座標 $(x_i, y_i)$ へ投影し、**座標法（Shoelace公式）** により面積 $S\text{ [m}^2\text{]}$ とアール面積 $A\text{ [a]}$ を自動算出します（`calcPolygonAreaStats`）。

$$S = \frac{1}{2} \left| \sum_{i=0}^{n-1} (x_i y_{i+1} - x_{i+1} y_i) \right| \quad [\text{m}^2], \qquad A = \max\left(1, \text{round}\left( \frac{S}{100} \right)\right) \quad [\text{a}]$$

---

### 6.5 水稲「出穂後積算温度（1,000℃）」刈取適期予測ロジック（`calcAccumulatedTempStats`）
圃場ごとの目標積算温度 $T_{\text{target}}$（コシヒカリ等：$1,000\text{ ℃}$、早生品種つきあかり：$950\text{ ℃}$）と日平均気温 $\bar{T}_{\text{daily}}$（平場：$25.5\text{ ℃}$、山間：$23.2\text{ ℃}$）から、出穂日（`headingDate`）以降の経過日数 $d$ に基づく積算温度 $T_{\text{accum}} = \text{round}(d \times \bar{T}_{\text{daily}})$ および予測残日数 $D_{\text{remain}}$ を算出します。

$$D_{\text{remain}} = \max\left(0, \left\lceil \frac{T_{\text{target}} - T_{\text{accum}}}{\bar{T}_{\text{daily}}} \right\rceil \right)$$
- $T_{\text{accum}} < 400\text{ ℃}$: **🔵 出穂・登熟初期**
- $400\text{ ℃} \le T_{\text{accum}} < T_{\text{target}} - 50\text{ ℃}$: **🟠 登熟中**
- $T_{\text{target}} - 50\text{ ℃} \le T_{\text{accum}} < T_{\text{target}} + 100\text{ ℃}$: **🟢 刈取適期**
- $T_{\text{accum}} \ge T_{\text{target}} + 100\text{ ℃}$: **🔴 刈遅れ注意（胴割れリスク）**

---

### 6.6 圃場別「10aあたり原価・粗利・採算ランク（S/A/B/C）」算出ロジック（`calcFieldProfitability`）
A4帳票の様式3（`yield`：圃場別「反収×投入NPK×労働時間×10a原価・粗利」総括分析表）では、各圃場 $F_i$ への面積按分実績から収益性を自動評価します。

1. **圃場別売上高**: $\text{Rev}_i = \frac{\text{harvestKg}_i}{60} \times \text{想定米価(円/60kg俵)}$（既定 18,500円/俵、UI上で変更可）
2. **圃場別生産原価**:
   $$\text{Cost}_i = \underbrace{\sum (\text{袋数}\times\text{肥料単価}\times r_i)}_{\text{按分肥料費}} + \underbrace{\sum (\text{本数}\times\text{農薬単価}\times r_i)}_{\text{按分農薬費}} + \underbrace{\left(\sum t_{\text{alloc}}\right) \times \text{時給単価}}_{\text{按分労務費(既定1,500円/h)}} + \underbrace{\sum \left(t_{\text{alloc}} \times \text{機械時間単価}\right)}_{\text{按分機械費(機材別設定)}}$$
3. **10aあたり粗利益および採算ランク判定**:
   $$\text{Profit}_{10\text{a}, i} = \text{round}\left( \frac{\text{Rev}_i - \text{Cost}_i}{A_i / 10} \right)$$
   - **S (高収益)**: $\text{Profit}_{10\text{a}, i} \ge 120,000\text{ 円/10a}$
   - **A (優良)**: $95,000 \le \text{Profit}_{10\text{a}, i} < 120,000\text{ 円/10a}$
   - **B (標準)**: $70,000 \le \text{Profit}_{10\text{a}, i} < 95,000\text{ 円/10a}$
   - **C (要改善)**: $\text{Profit}_{10\text{a}, i} < 70,000\text{ 円/10a}$

---

## 7. 基本設計⑤：外部インターフェース・帳票出力マッピング仕様

### 7.1 A4完成帳票出力（全3様式）マッピング仕様

| 様式コード | 帳票タイトル | 提出先・用途 | 主な自動印字項目 |
| :--- | :--- | :--- | :--- |
| **`ja`** | **JA提出用：生産履歴記帳簿（施肥台帳・防除履歴簿）** | JA（農協）・特別栽培米検査・JGAP審査 | 生産者情報、対象品種・対象団地/圃場フィルタ、**施肥履歴台帳**（施用日・対象圃場・面積・肥料名・成分比・総使用量・10a施用量・10aあたりN/P/K成分量・**作期累計の面積加重平均10a成分量**）、**防除履歴簿**（散布日・対象圃場・面積・農薬名/登録番号/有効成分・希釈倍率・総散布液量・総薬量・**散布時点の有効成分回数/上限**・**安全基準動的判定［適／⚠️要確認／未判定］**） |
| **`daily`** | **行政・法人用：営農作業日報 兼 機械稼働・圃場別按分実績表** | 農業法人労務管理・税務申告・補助金実績報告 | 作業日、天候・気温、作業分類、作業者名、対象圃場（一括登録表記）、合計面積(a)、作業時間(h)、使用機械名、使用資材・収穫量・日誌メモ摘要、インライン修正・取消ボタン（印刷時非表示） |
| **`yield`** | **経営・GAP用：圃場別「反収×投入NPK×労働時間×10a原価・粗利」総括分析表** | 経営改善・不採算圃場の条件見直し・次年度施肥設計 | 想定米価・時給単価シミュレータ（印刷時非表示）、圃場名（地番）、品種・面積(a)、累計労働時間(h)、累計NPK(10a)、収穫量・反収(俵/10a)・等級、資材費（肥料＋農薬）、労務・機械費、見込売上、**粗利益（および10a粗利）**、**採算判定ランク（S/A/B/C）**、全筆合計・平均フッター |

### 7.2 他社営農アプリ・行政データ移行インターフェース仕様

| 移行元システム | 取込フォーマット | 自動認識・正規化変換ルール（`parseAndPreviewMigrationText` / `executeMigrationImport`） |
| :--- | :--- | :--- |
| **アグリノート (AgriNote)** | ほ場台帳 CSV / TSV | `ほ場名`, `地番・住所`, `面積(㎡)`, `品種名`, `収穫予定日`, `緯度`, `経度` を自動検出し、面積を `㎡ → a（÷100）` へ自動換算して圃場マスタへ一括追加 |
| **クボタ KSAS** | 作業日誌・施肥履歴 CSV / TSV | `作業日`, `作業項目`, `作業担当者`, `圃場名称`, `登録面積(ha)`, `作業時間(h)`, `使用資材名`, `使用量(kg)`, `成分N/P/K(%)` を自動検出し、面積を `ha → a（×100）` へ換算、10aあたりNPK成分量を逆算して作業日誌へ一括取込 |
| **農水省 eMAFF農地ナビ / Z-GIS** | 筆ポリゴン GeoJSON (`FeatureCollection`) | `features[].geometry.coordinates`（経度・緯度配列）から全頂点座標 `polygonCoords` と重心座標を算出し、`properties.area_m2` を `㎡ → a` へ換算してGISマップへ実形状ポリゴンとして登録 |
| **既存らくらく営農日誌 / Excel** | CSV / TSV（直接コピペ対応） | カンマ区切りまたはタブ区切りを自動判別し、圃場台帳または作業履歴として自動マッピング・プレビュー表示後に一括取込 |
| **Googleスプレッドシート (GAS)** | JSON over HTTPS POST (`doPost`) | ペイロード内の `token` をスクリプトプロパティ `SYNC_TOKEN` と定数時間比較（`timingSafeEqual_`）で認証後、`LockService` 排他制御下で未登録圃場・未同期日誌を追記し、`acceptedIds` に含まれるIDのみをクライアント側で `synced = true` に更新 |

| 移行元システム | 取込フォーマット | 自動認識・正規化変換ルール（`executeMigrationImport`） |
| :--- | :--- | :--- |
| **アグリノート (AgriNote)** | CSV / TSV | `圃場名`, `面積(a)`, `作付品種`, `作業日`, `作業項目`, `肥料名/農薬名`, `使用量` カラムを自動検出し、`M_FIELDS` および `T_WORK_LOGS` へ一括変換・面積按分登録 |
| **クボタ KSAS** | CSV / TSV | KSAS特有の `ほ場ID`, `ほ場名`, `面積(㎡またはa)`, `作業時間`, `乾燥前重量/玄米重(kg)`, `水分(%)` を自動検出し、㎡→a換算および圃場別反収データへ自動変換 |
| **農水省 eMAFF農地ナビ** | GeoJSON (`FeatureCollection`) | 筆ポリゴンの `coordinates`（経度・緯度配列）を `[lat, lng]` へ変換し、重心座標の算出および球面面積測量（`㎡` → `a`）を行ってGISマップへ即座に描画登録 |
| **既存らくらく営農日誌 / Excel** | CSV / TSV（コピペ対応） | タブ区切りまたはカンマ区切りの圃場一覧・作業履歴を自動判別し、未登録圃場・未登録資材があればマスタへ自動追加した上で履歴を取り込む |

