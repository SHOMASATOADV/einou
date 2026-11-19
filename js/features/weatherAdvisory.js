// =========================================================================
// Feature: TSK-038 気象API自動連携 (Open-Meteo) ＆ 高温障害・病害虫AI予察アラート
//   - TSK-038-1: Open-Meteo 気象API連携＆LocalStorageキャッシュ層
//   - TSK-038-2: 水稲高温登熟障害リスク判定ロジック（出穂後20日間 27℃/35℃）
//   - TSK-038-3: 病害虫予察（いもち病・斑点米カメムシ）＆ ドローン防除可否判定(4m/s)
//   - TSK-038-4: ヘッダー気象ウィジェット＆GIS圃場カルテ警報バッジUI
// =========================================================================

const WEATHER_CACHE_KEY = 'rakuraku_einou_weather_cache_v1';
const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000; // 60分キャッシュ

window._weatherDataState = null;
window._weatherDrawerOpen = false;

function mapWmoWeatherCode_(code) {
  const c = Number(code);
  if (c === 0) return { icon: '☀️', label: '快晴' };
  if (c === 1 || c === 2) return { icon: '🌤️', label: '晴れ' };
  if (c === 3) return { icon: '☁️', label: 'くもり' };
  if (c === 45 || c === 48) return { icon: '🌫️', label: '霧' };
  if (c >= 51 && c <= 67) return { icon: '🌧️', label: '雨' };
  if (c >= 71 && c <= 77) return { icon: '❄️', label: '雪' };
  if (c >= 80 && c <= 82) return { icon: '🌦️', label: 'にわか雨' };
  if (c >= 95) return { icon: '⛈️', label: '雷雨' };
  return { icon: '⛅', label: 'くもり' };
}

function degToWindDirJa_(deg) {
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const idx = Math.round((((Number(deg) || 0) % 360) / 45)) % 8;
  return dirs[idx];
}

function getRepresentativeFarmCoord_() {
  const valid = (fieldsData || []).filter(f => Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng)));
  if (valid.length === 0) return { lat: 37.9161, lng: 139.0364, label: '代表地点(新潟)' };
  const lat = valid.reduce((s, f) => s + Number(f.lat), 0) / valid.length;
  const lng = valid.reduce((s, f) => s + Number(f.lng), 0) / valid.length;
  return {
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    label: valid[0].name || '登録圃場エリア'
  };
}

function buildOfflineFallbackWeather_(coord) {
  const now = new Date();
  const daily = {
    time: [],
    weather_code: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    temperature_2m_mean: [],
    precipitation_sum: [],
    wind_speed_10m_max: [],
    relative_humidity_2m_mean: []
  };
  for (let offset = -7; offset <= 6; offset++) {
    const d = new Date(now.getTime() + offset * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const baseMean = 24.5 + Math.sin(offset * 0.7) * 2.5;
    daily.time.push(iso);
    daily.weather_code.push(offset % 4 === 0 ? 61 : 1);
    daily.temperature_2m_max.push(Math.round((baseMean + 4.5) * 10) / 10);
    daily.temperature_2m_min.push(Math.round((baseMean - 4.2) * 10) / 10);
    daily.temperature_2m_mean.push(Math.round(baseMean * 10) / 10);
    daily.precipitation_sum.push(offset % 4 === 0 ? 6.5 : 0);
    daily.wind_speed_10m_max.push(Math.round((2.6 + Math.abs(Math.cos(offset)) * 1.6) * 10) / 10);
    daily.relative_humidity_2m_mean.push(offset % 4 === 0 ? 84 : 68);
  }
  return {
    source: 'offline-estimate',
    fetchedAt: now.toISOString(),
    coord,
    current: {
      temperature_2m: 25.2,
      relative_humidity_2m: 72,
      precipitation: 0,
      weather_code: 1,
      wind_speed_10m: 2.8,
      wind_direction_10m: 225
    },
    daily
  };
}

function loadWeatherCache_() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.daily || !parsed.current) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveWeatherCache_(data) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
  } catch (e) {}
}

/**
 * TSK-038-1: Open-Meteo 気象API連携＆キャッシュ取得
 */
async function fetchOpenMeteoWeather(forceRefresh = false) {
  const coord = getRepresentativeFarmCoord_();
  const cached = loadWeatherCache_();

  if (!forceRefresh && cached && cached.fetchedAt) {
    const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
    if (ageMs >= 0 && ageMs < WEATHER_CACHE_TTL_MS) {
      window._weatherDataState = cached;
      return cached;
    }
  }

  if (typeof isOfflineMode !== 'undefined' && isOfflineMode) {
    const fallback = cached || buildOfflineFallbackWeather_(coord);
    window._weatherDataState = fallback;
    return fallback;
  }

  const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lng}` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean` +
    `&past_days=14&forecast_days=7&wind_speed_unit=ms&timezone=Asia%2FTokyo`;

  try {
    const res = await fetch(apiUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !json.current || !json.daily) throw new Error('Invalid Open-Meteo response');

    const normalized = {
      source: 'open-meteo',
      fetchedAt: new Date().toISOString(),
      coord,
      current: json.current,
      daily: json.daily
    };
    saveWeatherCache_(normalized);
    window._weatherDataState = normalized;
    return normalized;
  } catch (err) {
    const fallback = cached || buildOfflineFallbackWeather_(coord);
    window._weatherDataState = fallback;
    return fallback;
  }
}

/**
 * TSK-038-2: 水稲高温登熟障害リスク判定ロジック
 *   - 出穂後20日間の日平均気温（27℃以上警戒）および最高気温35℃以上日数を評価
 */
function evaluateHeatRipeningRisk(weatherData, field = null) {
  const daily = weatherData && weatherData.daily ? weatherData.daily : null;
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    return { level: 'safe', badge: '🟢 登熟リスク低', avgMeanTemp: 0, daysOver27: 0, daysOver35: 0, message: '気象データ取得待機中' };
  }

  // 出穂日が指定されている場合は出穂後20日窓との重なりを優先参照、なければ直近・予報の全期間を参照
  let indices = [];
  if (field && field.headingDate) {
    const hDate = new Date(String(field.headingDate).replace(/\//g, '-'));
    if (!isNaN(hDate.getTime())) {
      const hMs = hDate.getTime();
      const endMs = hMs + 20 * 86400000;
      daily.time.forEach((t, idx) => {
        const ms = new Date(t).getTime();
        if (ms >= hMs && ms <= endMs) indices.push(idx);
      });
    }
  }
  if (indices.length === 0) {
    // 直近10日〜予報7日を対象
    const startIdx = Math.max(0, daily.time.length - 14);
    for (let i = startIdx; i < daily.time.length; i++) indices.push(i);
  }

  let sumMean = 0;
  let daysOver27 = 0;
  let daysOver35 = 0;
  indices.forEach(i => {
    const meanT = Number(daily.temperature_2m_mean?.[i] ?? ((Number(daily.temperature_2m_max?.[i] || 0) + Number(daily.temperature_2m_min?.[i] || 0)) / 2));
    const maxT = Number(daily.temperature_2m_max?.[i] || 0);
    sumMean += meanT;
    if (meanT >= 27.0) daysOver27++;
    if (maxT >= 35.0) daysOver35++;
  });

  const avgMeanTemp = Math.round((sumMean / Math.max(1, indices.length)) * 10) / 10;

  if (avgMeanTemp >= 27.0 || daysOver35 >= 2 || daysOver27 >= 5) {
    return {
      level: 'danger',
      badge: '🔴 白未熟粒・胴割れ警報',
      avgMeanTemp,
      daysOver27,
      daysOver35,
      message: `期間平均 ${avgMeanTemp}℃（日平均27℃超: ${daysOver27}日 / 猛暑日35℃超: ${daysOver35}日）。夜間かけ流し灌漑・深水管理による地温低下対策を推奨します。`
    };
  }
  if (avgMeanTemp >= 25.5 || daysOver27 >= 2 || daysOver35 >= 1) {
    return {
      level: 'warning',
      badge: '🟡 高温登熟注意報',
      avgMeanTemp,
      daysOver27,
      daysOver35,
      message: `期間平均 ${avgMeanTemp}℃（27℃超: ${daysOver27}日 / 35℃超: ${daysOver35}日）。出穂後20日間の水切れ防止と早朝入水を心がけてください。`
    };
  }
  return {
    level: 'safe',
    badge: '🟢 高温障害リスク低',
    avgMeanTemp,
    daysOver27,
    daysOver35,
    message: `期間平均 ${avgMeanTemp}℃（27℃超: ${daysOver27}日）。登熟に適した気温推移です。`
  };
}

/**
 * TSK-038-3: 病害虫予察（いもち病・斑点米カメムシ）＆ ドローン防除可否判定
 */
function evaluatePestAndDroneRisk(weatherData) {
  const cur = weatherData && weatherData.current ? weatherData.current : {};
  const daily = weatherData && weatherData.daily ? weatherData.daily : {};

  // 1. ドローン防除可否判定（風速 4.0 m/s 以上はNG）
  const curWind = Math.round(Number(cur.wind_speed_10m || 0) * 10) / 10;
  const windDir = degToWindDirJa_(cur.wind_direction_10m || 0);
  let drone = { ok: true, level: 'safe', badge: `✅ ドローン防除OK (${curWind}m/s)`, windSpeed: curWind, windDir, detail: `風向: ${windDir}・風速 ${curWind}m/s（基準 4.0m/s 未満）` };
  if (curWind >= 4.0) {
    drone = { ok: false, level: 'danger', badge: `🚫 ドローン防除NG (${curWind}m/s)`, windSpeed: curWind, windDir, detail: `風速 ${curWind}m/s（${windDir}風）は基準4.0m/s超過のためドリフト危険。散布延期を推奨。` };
  } else if (curWind >= 3.0) {
    drone = { ok: true, level: 'warning', badge: `⚠️ 風やや強・注意 (${curWind}m/s)`, windSpeed: curWind, windDir, detail: `風速 ${curWind}m/s（${windDir}風）。突風・周辺圃場への飛散に注意してください。` };
  }

  // 2. いもち病予察（連続降雨 ＆ 高湿度80%以上 ＆ 適温20〜28℃）
  const precipArr = daily.precipitation_sum || [];
  const humidArr = daily.relative_humidity_2m_mean || [];
  const meanTempArr = daily.temperature_2m_mean || [];
  const maxTempArr = daily.temperature_2m_max || [];
  const recentStart = Math.max(0, precipArr.length - 10);

  let maxConsecutiveRain = 0;
  let curConsecutive = 0;
  let highHumidBlastDays = 0;
  let hotDryDays = 0;

  for (let i = recentStart; i < precipArr.length; i++) {
    const p = Number(precipArr[i] || 0);
    const h = Number(humidArr[i] ?? cur.relative_humidity_2m ?? 70);
    const mt = Number(meanTempArr[i] || 22);
    const maxT = Number(maxTempArr[i] || 26);

    if (p >= 1.0) {
      curConsecutive++;
      if (curConsecutive > maxConsecutiveRain) maxConsecutiveRain = curConsecutive;
    } else {
      curConsecutive = 0;
    }
    if (h >= 80 && mt >= 18 && mt <= 28) highHumidBlastDays++;
    if (maxT >= 28 && p < 1.0) hotDryDays++;
  }

  let blast = { level: 'safe', badge: '🟢 いもち病リスク低', detail: `連続降雨 ${maxConsecutiveRain}日 ／ 多湿適温日 ${highHumidBlastDays}日` };
  if (maxConsecutiveRain >= 3 || (maxConsecutiveRain >= 2 && highHumidBlastDays >= 3)) {
    blast = { level: 'danger', badge: '🔴 いもち病 感染警戒', detail: `連続降雨 ${maxConsecutiveRain}日・多湿(${highHumidBlastDays}日)により葉いもち/穂いもち発生好適条件。予防散布を検討してください。` };
  } else if (maxConsecutiveRain >= 2 || highHumidBlastDays >= 2) {
    blast = { level: 'warning', badge: '🟡 いもち病 やや注意', detail: `連続降雨 ${maxConsecutiveRain}日・多湿傾向。朝露残存・過繁茂圃場の見回りを推奨。` };
  }

  // 3. 斑点米カメムシ予察（高温少雨傾向）
  let stinkBug = { level: 'safe', badge: '🟢 カメムシ低リスク', detail: `高温少雨日 ${hotDryDays}日` };
  if (hotDryDays >= 5) {
    stinkBug = { level: 'danger', badge: '🔴 カメムシ飛来警戒', detail: `高温少雨（28℃以上無降水 ${hotDryDays}日）が継続。出穂期前後の畦畔草刈り・適期防除を厳守してください。` };
  } else if (hotDryDays >= 3) {
    stinkBug = { level: 'warning', badge: '🟡 カメムシやや注意', detail: `高温傾向（${hotDryDays}日）。イネ科雑草の穂・畦畔周辺への飛来状況を確認してください。` };
  }

  return { drone, blast, stinkBug };
}

function toggleWeatherDetailDrawer() {
  window._weatherDrawerOpen = !window._weatherDrawerOpen;
  renderWeatherHeaderWidget();
}

async function refreshWeatherAdvisory(forceRefresh = true) {
  await fetchOpenMeteoWeather(forceRefresh);
  renderWeatherHeaderWidget();
  if (typeof currentInspectedFieldId === 'string' && currentInspectedFieldId) {
    renderFieldWeatherCard(currentInspectedFieldId);
  }
  if (forceRefresh && typeof showToast === 'function') {
    const src = window._weatherDataState?.source === 'open-meteo' ? 'Open-Meteo 最新気象データ' : 'キャッシュ/オフライン推定データ';
    showToast('🌦️ 気象・AI予察データを更新しました', `${src}に基づき高温登熟・病害虫・ドローン防除可否を再判定しました。`);
  }
}

/**
 * TSK-038-4: ヘッダー気象ウィジェット描画
 */
function renderWeatherHeaderWidget() {
  const host = document.getElementById('weatherHeaderWidget');
  if (!host) return;
  const data = window._weatherDataState;
  if (!data) {
    host.innerHTML = `<div class="text-xs text-[var(--muted-foreground)] px-3 py-2">🌦️ 気象データ取得中...</div>`;
    return;
  }

  const cur = data.current || {};
  const wmo = mapWmoWeatherCode_(cur.weather_code);
  const heat = evaluateHeatRipeningRisk(data);
  const pest = evaluatePestAndDroneRisk(data);

  const badgeTone = (lvl) => {
    if (lvl === 'danger') return 'bg-red-500/15 text-red-700 border-red-500/40';
    if (lvl === 'warning') return 'bg-amber-500/15 text-amber-700 border-amber-500/40';
    return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40';
  };

  // 直近7日間予報の生成（本日以降の最大7日）
  const todayIso = typeof getTodayIsoDate === 'function' ? getTodayIsoDate() : new Date().toISOString().slice(0, 10);
  const daily = data.daily || {};
  const forecastCards = [];
  if (Array.isArray(daily.time)) {
    daily.time.forEach((dStr, i) => {
      if (dStr >= todayIso && forecastCards.length < 7) {
        const dw = mapWmoWeatherCode_(daily.weather_code?.[i]);
        const maxT = Math.round(Number(daily.temperature_2m_max?.[i] || 0));
        const minT = Math.round(Number(daily.temperature_2m_min?.[i] || 0));
        const rain = Math.round(Number(daily.precipitation_sum?.[i] || 0) * 10) / 10;
        const wind = Math.round(Number(daily.wind_speed_10m_max?.[i] || 0) * 10) / 10;
        forecastCards.push(safeHtml`
          <div class="p-2 rounded-xl bg-[var(--background)] border border-[var(--border)] text-center text-[11px]">
            <div class="font-bold text-[var(--muted-foreground)]">${dStr.slice(5)}</div>
            <div class="text-lg my-0.5">${dw.icon}</div>
            <div class="font-bold text-[var(--foreground)]"><span class="text-red-500">${maxT}°</span> / <span class="text-sky-600">${minT}°</span></div>
            <div class="text-[10px] text-sky-600">☔ ${rain}mm</div>
            <div class="text-[10px] ${wind >= 4 ? 'text-red-600 font-bold' : 'text-[var(--muted-foreground)]'}">💨 ${wind}m/s</div>
          </div>
        `);
      }
    });
  }

  const srcLabel = data.source === 'open-meteo'
    ? `Open-Meteo リアルタイム取得 (${String(data.fetchedAt || '').slice(11, 16)}更新)`
    : 'オフライン推定 / ローカルキャッシュ表示中';

  host.innerHTML = safeHtml`
    <div class="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="font-extrabold text-[var(--foreground)]">${wmo.icon} ${wmo.label} ${Number(cur.temperature_2m || 0).toFixed(1)}℃</span>
        <span class="text-[var(--muted-foreground)]">湿度 ${Math.round(Number(cur.relative_humidity_2m || 0))}% ／ 💨 ${pest.drone.windDir} ${pest.drone.windSpeed}m/s</span>
        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeTone(pest.drone.level)}">${pest.drone.badge}</span>
        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeTone(heat.level)}">${heat.badge}</span>
        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeTone(pest.blast.level)}">${pest.blast.badge}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" data-action="refreshWeatherAdvisory" class="px-2.5 py-1 rounded-lg bg-[var(--secondary)] text-[var(--secondary-foreground)] text-[11px] font-bold hover:opacity-80 transition">
          🔄 更新
        </button>
        <button type="button" data-action="toggleWeatherDetailDrawer" class="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[11px] font-bold hover:bg-sky-700 transition">
          ${window._weatherDrawerOpen ? '▲ 週間予報・AI予察を閉じる' : '▼ 7日間予報・AI予察を見る'}
        </button>
      </div>
    </div>
    ${rawHtml(window._weatherDrawerOpen ? safeHtml`
      <div class="border-t border-[var(--border)] px-4 py-3 space-y-3 bg-[var(--secondary)]/40">
        <div class="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
          <span>📍 対象エリア: ${data.coord?.label || '登録圃場'} (${data.coord?.lat}, ${data.coord?.lng})</span>
          <span>${srcLabel}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          <div class="p-3 rounded-xl border ${badgeTone(heat.level)}">
            <div class="font-bold mb-1">🌡️ 高温登熟障害リスク</div>
            <div class="text-[11px] leading-relaxed">${heat.message}</div>
          </div>
          <div class="p-3 rounded-xl border ${badgeTone(pest.blast.level)}">
            <div class="font-bold mb-1">🍄 いもち病・斑点米カメムシ予察</div>
            <div class="text-[11px] leading-relaxed">${pest.blast.detail} ／ ${pest.stinkBug.badge}: ${pest.stinkBug.detail}</div>
          </div>
          <div class="p-3 rounded-xl border ${badgeTone(pest.drone.level)}">
            <div class="font-bold mb-1">🚁 ドローン防除可否判定 (4m/s基準)</div>
            <div class="text-[11px] leading-relaxed">${pest.drone.detail}</div>
          </div>
        </div>
        <div>
          <div class="text-[11px] font-bold text-[var(--muted-foreground)] mb-1.5">📅 7日間 営農気象予報（最高/最低気温・降水量・最大風速）</div>
          <div class="grid grid-cols-3 sm:grid-cols-7 gap-2">
            ${rawHtml(forecastCards.join(''))}
          </div>
        </div>
      </div>
    ` : '')}
  `;
}

/**
 * TSK-038-4: GIS圃場詳細カルテ内の気象・AI予察カード描画
 */
function renderFieldWeatherCard(fieldId) {
  const el = document.getElementById('gisFieldWeatherCard');
  if (!el) return;
  const f = (fieldsData || []).find(item => item.id === fieldId);
  const data = window._weatherDataState;
  if (!f || !data) {
    el.innerHTML = `<div class="text-xs text-[var(--muted-foreground)]">気象予察データを読み込み中...</div>`;
    return;
  }

  const heat = evaluateHeatRipeningRisk(data, f);
  const pest = evaluatePestAndDroneRisk(data);
  const badgeTone = (lvl) => {
    if (lvl === 'danger') return 'bg-red-500/15 text-red-700 border-red-500/40';
    if (lvl === 'warning') return 'bg-amber-500/15 text-amber-700 border-amber-500/40';
    return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40';
  };

  el.innerHTML = safeHtml`
    <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
      <span class="text-xs font-bold text-[var(--foreground)]">🌦️ 気象API自動連携 ＆ 高温・病害虫AI予察</span>
      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${badgeTone(heat.level)}">${heat.badge}</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] mb-2">
      <div class="p-2 rounded-xl border ${badgeTone(heat.level)}">
        <div class="font-bold">高温登熟 (出穂後20日)</div>
        <div>平均 ${heat.avgMeanTemp}℃ / 27℃超:${heat.daysOver27}日</div>
      </div>
      <div class="p-2 rounded-xl border ${badgeTone(pest.blast.level)}">
        <div class="font-bold">${pest.blast.badge}</div>
        <div>${pest.stinkBug.badge}</div>
      </div>
      <div class="p-2 rounded-xl border ${badgeTone(pest.drone.level)}">
        <div class="font-bold">${pest.drone.badge}</div>
        <div>風向 ${pest.drone.windDir} / 基準4.0m/s</div>
      </div>
    </div>
    <div class="text-[11px] text-[var(--muted-foreground)] leading-relaxed">${heat.message}</div>
  `;
}

function initWeatherAdvisory() {
  fetchOpenMeteoWeather(false).then(() => {
    renderWeatherHeaderWidget();
    if (typeof currentInspectedFieldId === 'string' && currentInspectedFieldId) {
      renderFieldWeatherCard(currentInspectedFieldId);
    }
  }).catch(() => {});
}
