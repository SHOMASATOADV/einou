// Constants & Initial State (js/constants.js)
const STORAGE_KEY = 'rakuraku_einou_next_pwa_state_v1';

// 初期デフォルトデータ定義（空の初期状態）
const DEFAULT_STATE = {
  fieldsData: [],
  fertilizers: {},
  pesticides: {},
  machines: {},
  costSettings: {
    hourlyWageYen: 1500,
    ricePricePerTawaraYen: 18500,
    wasteRicePricePerKgYen: 50
  },
  workLogs: [],
  gasWebhookUrl: ''
};

const MIGRATION_SAMPLES = {
  agrinote: `ほ場ID,ほ場名,グループ名,地番・住所,面積(㎡),作付名,品種名,収穫予定日,緯度,経度
AGN-101,⑧ アグリ下新田1号,本場エリア,大字下新田 201-1,2800,水稲,コシヒカリ (BL),2026/09/22,37.9165,139.0370
AGN-102,⑨ アグリ下新田2号,本場エリア,大字下新田 201-2,3200,水稲,コシヒカリ (BL),2026/09/22,37.9168,139.0372
AGN-103,⑩ アグリ山間棚田,上山田飛び地,上山田字沢 110,1400,水稲,つきあかり,2026/09/15,37.9220,139.0490`,
  ksas: `作業日,作業項目,作業担当者,圃場名称,登録面積(ha),作業時間(h),使用機械名,使用資材名,使用量(kg),成分N(%),成分P(%),成分K(%)
2026/10/20,耕起,佐藤 健一,① 本場1号・② 本場2号,0.50,1.5,ヤンマー トラクター YT357,-,0,0,0,0
2026/10/25,施肥,佐藤 健一,④ 川向4号,0.35,1.0,ヤンマー トラクター YT357,くみあい苦土入り複合オール14,70,14,14,14`,
  emaff: JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { polygon_id: 'EMAFF-01', name: '⑪ eMAFF北沢1号', address: '大字北沢 55-1', area_m2: 2400, crop: 'コシヒカリ (BL)' },
        geometry: { type: 'Polygon', coordinates: [[[139.0380, 37.9180], [139.0388, 37.9181], [139.0386, 37.9186], [139.0379, 37.9185]]] }
      },
      {
        type: 'Feature',
        properties: { polygon_id: 'EMAFF-02', name: '⑫ eMAFF北沢2号', address: '大字北沢 56-3', area_m2: 1900, crop: 'つきあかり' },
        geometry: { type: 'Polygon', coordinates: [[[139.0390, 37.9180], [139.0397, 37.9182], [139.0395, 37.9187], [139.0389, 37.9185]]] }
      }
    ]
  }, null, 2)
};

