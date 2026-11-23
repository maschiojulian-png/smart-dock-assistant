/* ==========================================================================
   Smart Dock & Assistente Pessoal por Voz (PWA — Apple iOS Dark Style)
   Relógio + Clima (Open-Meteo) + Wake Lock + Google Agenda + Gemini 2.5 Flash
   ========================================================================== */

(() => {
  'use strict';

  // --------------------------------------------------------------------------
  // Constantes e Chaves de Armazenamento
  // --------------------------------------------------------------------------
  const STORAGE_KEYS = {
    GEMINI_API_KEY: 'smartdock_gemini_api_key',
    GOOGLE_CLIENT_ID: 'smartdock_google_client_id',
    PREFS: 'smartdock_prefs',
    WEATHER_LOCATION: 'smartdock_weather_location',
    SESSION_TOKEN: 'smartdock_gcal_token_session',
  };

  const GEMINI_MODEL = 'gemini-2.5-flash';
  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const CALENDAR_REFRESH_MS = 5 * 60 * 1000; // 5 minutos
  const WEATHER_REFRESH_MS = 15 * 60 * 1000; // 15 minutos

  const DEFAULT_WEATHER_LOCATION = {
    name: 'São Paulo, SP',
    latitude: -23.5505,
    longitude: -46.6333,
  };

  const DEFAULT_PREFS = {
    format24h: true,
    showSeconds: true,
    voiceURI: '',
    speechRate: 1.05,
    soundChimes: true,
  };

  // --------------------------------------------------------------------------
  // Estado da Aplicação
  // --------------------------------------------------------------------------
  const state = {
    assistantState: 'idle', // 'idle' | 'listening' | 'thinking' | 'speaking'
    audioUnlocked: false,
    audioCtx: null,
    wakeLockSentinel: null,
    wakeLockDesired: false,

    // Clima (Open-Meteo)
    weatherLocation: loadWeatherLocation(),
    weatherData: null,

    // Google Calendar
    tokenClient: null,
    tokenClientIdUsed: null,
    accessToken: null,
    tokenExpiresAt: 0,
    calendarMode: 'disconnected', // 'disconnected' | 'google' | 'demo'
    todayEvents: [],
    calendarRefreshTimer: null,

    // Voz & Gemini
    serverGeminiConfigured: false,
    serverGoogleClientId: '',
    recognition: null,
    finalTranscript: '',
    lastReply: '',
    chatHistory: [],
    availableVoices: [],
    currentAbortController: null,
    speechQueueId: 0,

    // Preferências
    prefs: loadPrefs(),
  };

  // --------------------------------------------------------------------------
  // Referências DOM
  // --------------------------------------------------------------------------
  const el = {
    body: document.body,
    connectionDot: document.getElementById('connectionDot'),
    audioUnlockPill: document.getElementById('audioUnlockPill'),
    wakeLockBtn: document.getElementById('wakeLockBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    configBadge: document.getElementById('configBadge'),

    // Relógio & Data
    greetingText: document.getElementById('greetingText'),
    clockTime: document.getElementById('clockTime'),
    clockSeconds: document.getElementById('clockSeconds'),
    clockAmPm: document.getElementById('clockAmPm'),
    dateDisplay: document.getElementById('dateDisplay'),
    iosCalMonth: document.getElementById('iosCalMonth'),
    iosCalDay: document.getElementById('iosCalDay'),
    nextEventChip: document.getElementById('nextEventChip'),
    nextEventChipText: document.getElementById('nextEventChipText'),

    // Assistente
    micBtn: document.getElementById('micBtn'),
    assistantStatus: document.getElementById('assistantStatus'),
    quickPrompts: document.getElementById('quickPrompts'),
    responseCard: document.getElementById('responseCard'),
    userTranscript: document.getElementById('userTranscript'),
    assistantReply: document.getElementById('assistantReply'),
    replayVoiceBtn: document.getElementById('replayVoiceBtn'),
    clearResponseBtn: document.getElementById('clearResponseBtn'),
    textForm: document.getElementById('textForm'),
    textInput: document.getElementById('textInput'),

    // Clima
    weatherWidget: document.getElementById('weatherWidget'),
    weatherCityBtn: document.getElementById('weatherCityBtn'),
    weatherCityName: document.getElementById('weatherCityName'),
    weatherGpsBtn: document.getElementById('weatherGpsBtn'),
    refreshWeatherBtn: document.getElementById('refreshWeatherBtn'),
    weatherCityForm: document.getElementById('weatherCityForm'),
    weatherCityInput: document.getElementById('weatherCityInput'),
    cancelCitySearchBtn: document.getElementById('cancelCitySearchBtn'),
    weatherTemp: document.getElementById('weatherTemp'),
    weatherCondition: document.getElementById('weatherCondition'),
    weatherHighLow: document.getElementById('weatherHighLow'),
    weatherHeroIcon: document.getElementById('weatherHeroIcon'),
    weatherFeelsLike: document.getElementById('weatherFeelsLike'),
    weatherHumidity: document.getElementById('weatherHumidity'),
    weatherRainChance: document.getElementById('weatherRainChance'),
    weatherWind: document.getElementById('weatherWind'),
    weatherHourlyStrip: document.getElementById('weatherHourlyStrip'),

    // Agenda
    eventCountBadge: document.getElementById('eventCountBadge'),
    refreshCalendarBtn: document.getElementById('refreshCalendarBtn'),
    disconnectCalendarBtn: document.getElementById('disconnectCalendarBtn'),
    agendaConnectState: document.getElementById('agendaConnectState'),
    connectCalendarBtn: document.getElementById('connectCalendarBtn'),
    loadDemoBtn: document.getElementById('loadDemoBtn'),
    agendaLoading: document.getElementById('agendaLoading'),
    eventsList: document.getElementById('eventsList'),
    agendaEmptyToday: document.getElementById('agendaEmptyToday'),
    agendaFooter: document.getElementById('agendaFooter'),
    agendaSyncMeta: document.getElementById('agendaSyncMeta'),

    // Modal de Configurações
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    settingsForm: document.getElementById('settingsForm'),
    geminiKeyInput: document.getElementById('geminiKeyInput'),
    toggleGeminiKeyBtn: document.getElementById('toggleGeminiKeyBtn'),
    googleClientIdInput: document.getElementById('googleClientIdInput'),
    settingsCityInput: document.getElementById('settingsCityInput'),
    voiceSelect: document.getElementById('voiceSelect'),
    speechRateInput: document.getElementById('speechRateInput'),
    speechRateValue: document.getElementById('speechRateValue'),
    format24hToggle: document.getElementById('format24hToggle'),
    showSecondsToggle: document.getElementById('showSecondsToggle'),
    soundChimesToggle: document.getElementById('soundChimesToggle'),
    currentOriginCode: document.getElementById('currentOriginCode'),
    copyOriginBtn: document.getElementById('copyOriginBtn'),
    clearKeysBtn: document.getElementById('clearKeysBtn'),

    // Modal Guia Tela Cheia iOS
    iosFullscreenModal: document.getElementById('iosFullscreenModal'),
    closeIosGuideBtn: document.getElementById('closeIosGuideBtn'),
    okIosGuideBtn: document.getElementById('okIosGuideBtn'),

    toastContainer: document.getElementById('toastContainer'),
  };

  // --------------------------------------------------------------------------
  // Utilitários de Armazenamento & UI
  // --------------------------------------------------------------------------
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PREFS);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePrefs(prefs) {
    state.prefs = { ...DEFAULT_PREFS, ...prefs };
    try {
      localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(state.prefs));
    } catch (err) {
      console.warn('Falha ao salvar preferências:', err);
    }
  }

  function loadWeatherLocation() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.WEATHER_LOCATION);
      if (!raw) return { ...DEFAULT_WEATHER_LOCATION };
      const parsed = JSON.parse(raw);
      if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
        return parsed;
      }
      return { ...DEFAULT_WEATHER_LOCATION };
    } catch {
      return { ...DEFAULT_WEATHER_LOCATION };
    }
  }

  function saveWeatherLocation(loc) {
    state.weatherLocation = loc;
    try {
      localStorage.setItem(STORAGE_KEYS.WEATHER_LOCATION, JSON.stringify(loc));
    } catch {
      // Ignora erro
    }
  }

  function getGeminiKey() {
    return (localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY) || '').trim();
  }

  function hasGeminiAccess() {
    return Boolean(getGeminiKey() || state.serverGeminiConfigured);
  }

  function getGoogleClientId() {
    return (
      localStorage.getItem(STORAGE_KEYS.GOOGLE_CLIENT_ID) ||
      state.serverGoogleClientId ||
      ''
    ).trim();
  }

  function updateConfigBadge() {
    el.configBadge.classList.toggle('hidden', hasGeminiAccess());
  }

  async function checkServerConfig() {
    if (!/^https?:$/.test(window.location.protocol)) return;
    try {
      const res = await fetch('./api/gemini', { cache: 'no-store' });
      if (!res.ok) return;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return;
      const data = await res.json();
      state.serverGeminiConfigured = Boolean(data.configured);
      if (data.googleClientId) {
        state.serverGoogleClientId = String(data.googleClientId).trim();
      }
      updateConfigBadge();
    } catch {
      // Rodando localmente sem serverless functions — segue normalmente com localStorage
    }
  }

  function showToast(message, type = 'info', duration = 3600) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity 220ms ease, transform 220ms ease';
      setTimeout(() => toast.remove(), 240);
    }, duration);
  }

  function setAssistantState(newState, statusMessage) {
    state.assistantState = newState;
    el.body.dataset.state = newState;
    if (statusMessage !== undefined) {
      el.assistantStatus.textContent = statusMessage;
    } else {
      const defaultLabels = {
        idle: 'Toque no microfone para falar com o Gemini',
        listening: 'Ouvindo você em português... toque para encerrar',
        thinking: 'Consultando Gemini 2.5 Flash...',
        speaking: 'Falando — toque no botão para parar',
      };
      el.assistantStatus.textContent = defaultLabels[newState] || '';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --------------------------------------------------------------------------
  // Compatibilidade iOS: Desbloqueio de Áudio e TTS no Primeiro Toque
  // --------------------------------------------------------------------------
  function unlockAudioOnFirstGesture() {
    if (state.audioUnlocked) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!state.audioCtx) {
          state.audioCtx = new AudioCtx();
        }
        if (state.audioCtx.state === 'suspended') {
          state.audioCtx.resume().catch(() => {});
        }
        const buffer = state.audioCtx.createBuffer(1, 1, 22050);
        const source = state.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(state.audioCtx.destination);
        source.start(0);
      }

      if ('speechSynthesis' in window) {
        const primer = new SpeechSynthesisUtterance(' ');
        primer.lang = 'pt-BR';
        primer.volume = 0;
        primer.rate = 10;
        window.speechSynthesis.speak(primer);
      }

      state.audioUnlocked = true;
      el.audioUnlockPill.classList.add('unlocked');
    } catch (err) {
      console.warn('Erro ao desbloquear áudio:', err);
    }
  }

  function setupAudioUnlockListeners() {
    const events = ['touchstart', 'pointerdown', 'click'];
    const handler = () => {
      unlockAudioOnFirstGesture();
      events.forEach((evt) => window.removeEventListener(evt, handler, true));
    };
    events.forEach((evt) => window.addEventListener(evt, handler, { capture: true, passive: true }));

    el.audioUnlockPill.addEventListener('click', () => {
      unlockAudioOnFirstGesture();
      playChime('start');
      showToast('Áudio e voz ativados!', 'success', 2000);
    });
  }

  function playChime(kind = 'start') {
    if (!state.prefs.soundChimes || !state.audioCtx) return;
    try {
      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume().catch(() => {});
      }
      const now = state.audioCtx.currentTime;
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = 'sine';

      if (kind === 'start') {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.11);
      } else if (kind === 'end') {
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.11);
      } else {
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(state.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      // Ignora
    }
  }

  // --------------------------------------------------------------------------
  // 1. Relógio Digital, Data e Ícone do Calendário iOS
  // --------------------------------------------------------------------------
  function updateClock() {
    const now = new Date();
    const hours24 = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    if (state.prefs.format24h) {
      el.clockTime.textContent = `${String(hours24).padStart(2, '0')}:${minutes}`;
      el.clockAmPm.classList.add('hidden');
    } else {
      const ampm = hours24 >= 12 ? 'PM' : 'AM';
      const hours12 = hours24 % 12 || 12;
      el.clockTime.textContent = `${String(hours12).padStart(2, '0')}:${minutes}`;
      el.clockAmPm.textContent = ampm;
      el.clockAmPm.classList.remove('hidden');
    }

    el.clockSeconds.textContent = seconds;
    el.clockSeconds.classList.toggle('hidden', !state.prefs.showSeconds);

    let greeting = 'Boa noite';
    if (hours24 >= 5 && hours24 < 12) greeting = 'Bom dia';
    else if (hours24 >= 12 && hours24 < 18) greeting = 'Boa tarde';
    el.greetingText.textContent = greeting;

    const rawDate = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    }).format(now);
    el.dateDisplay.textContent = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

    const shortMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
      .format(now)
      .replace('.', '')
      .toUpperCase();
    el.iosCalMonth.textContent = shortMonth;
    el.iosCalDay.textContent = String(now.getDate());
  }

  function startClock() {
    updateClock();
    setInterval(updateClock, 500);
    setInterval(() => {
      if (state.todayEvents.length > 0) {
        renderEventsList();
      }
    }, 30000);
  }

  // --------------------------------------------------------------------------
  // Clima Estilo Apple iOS Weather (Open-Meteo — 100% Gratuito sem API Key)
  // --------------------------------------------------------------------------
  function getWeatherVisual(code, isDay = 1) {
    const day = Boolean(isDay);
    if (code === 0) {
      return {
        label: day ? 'Ensolarado' : 'Céu limpo',
        theme: day ? 'clear-day' : 'clear-night',
        icon: day ? 'sun' : 'moon',
      };
    }
    if (code === 1 || code === 2) {
      return {
        label: code === 1 ? 'Poucas nuvens' : 'Parcialmente nublado',
        theme: day ? 'clear-day' : 'clear-night',
        icon: day ? 'partly-day' : 'partly-night',
      };
    }
    if (code === 3) {
      return { label: 'Nublado', theme: 'cloudy', icon: 'cloud' };
    }
    if (code === 45 || code === 48) {
      return { label: 'Neblina', theme: 'fog', icon: 'fog' };
    }
    if ([51, 53, 55, 56, 57].includes(code)) {
      return { label: 'Garoa', theme: 'rain', icon: 'rain' };
    }
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
      return {
        label: [65, 82].includes(code) ? 'Chuva forte' : 'Chuva',
        theme: 'rain',
        icon: 'rain',
      };
    }
    if ([71, 73, 75, 77, 85, 86].includes(code)) {
      return { label: 'Neve', theme: 'cloudy', icon: 'snow' };
    }
    if ([95, 96, 99].includes(code)) {
      return { label: 'Tempestade', theme: 'storm', icon: 'storm' };
    }
    return {
      label: 'Tempo variável',
      theme: day ? 'clear-day' : 'clear-night',
      icon: day ? 'partly-day' : 'partly-night',
    };
  }

  function renderWeatherSvg(iconType, size = 56) {
    const svgs = {
      sun: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <radialGradient id="sunG" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#FFF29C"/>
            <stop offset="55%" stop-color="#FFD60A"/>
            <stop offset="100%" stop-color="#FF9F0A"/>
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="16" fill="url(#sunG)"/>
        <g stroke="#FFD60A" stroke-width="3.2" stroke-linecap="round">
          <line x1="32" y1="6" x2="32" y2="11"/><line x1="32" y1="53" x2="32" y2="58"/>
          <line x1="6" y1="32" x2="11" y2="32"/><line x1="53" y1="32" x2="58" y2="32"/>
          <line x1="13.6" y1="13.6" x2="17.2" y2="17.2"/><line x1="46.8" y1="46.8" x2="50.4" y2="50.4"/>
          <line x1="50.4" y1="13.6" x2="46.8" y2="17.2"/><line x1="17.2" y1="46.8" x2="13.6" y2="50.4"/>
        </g>
      </svg>`,
      moon: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="moonG" x1="12" y1="10" x2="50" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#F5F7FF"/>
            <stop offset="100%" stop-color="#9BB7FF"/>
          </linearGradient>
        </defs>
        <path d="M45.5 39.2A18.5 18.5 0 0 1 24.8 18.5a18.6 18.6 0 0 1 1.6-7.5A19.5 19.5 0 1 0 53 37.6a18.5 18.5 0 0 1-7.5 1.6Z" fill="url(#moonG)"/>
        <circle cx="46" cy="18" r="2.2" fill="#FFD60A"/>
        <circle cx="52" cy="25" r="1.4" fill="#E0ECFF"/>
      </svg>`,
      'partly-day': `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <circle cx="25" cy="24" r="11" fill="#FFD60A"/>
        <path d="M21 48h25a11 11 0 0 0 1.4-21.9A14 14 0 0 0 20.5 29 9.5 9.5 0 0 0 21 48Z" fill="#F2F6FF" fill-opacity="0.95"/>
      </svg>`,
      'partly-night': `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M28 24a10 10 0 0 1-8-14A11 11 0 1 0 34 24a9.6 9.6 0 0 1-6 0Z" fill="#B8CEFF"/>
        <path d="M21 49h25a11 11 0 0 0 1.4-21.9A14 14 0 0 0 20.5 30 9.5 9.5 0 0 0 21 49Z" fill="#DCE6F8" fill-opacity="0.92"/>
      </svg>`,
      cloud: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 48h28a12 12 0 0 0 1.5-23.9A15.5 15.5 0 0 0 17.8 27 10.5 10.5 0 0 0 18 48Z" fill="#E5ECF8" fill-opacity="0.92"/>
      </svg>`,
      rain: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 40h28a11 11 0 0 0 1.4-21.9A14.5 14.5 0 0 0 18 21a9.5 9.5 0 0 0 0 19Z" fill="#DCE7F7" fill-opacity="0.92"/>
        <g stroke="#64D2FF" stroke-width="3.2" stroke-linecap="round">
          <line x1="22" y1="46" x2="19" y2="54"/>
          <line x1="33" y1="46" x2="30" y2="56"/>
          <line x1="44" y1="46" x2="41" y2="54"/>
        </g>
      </svg>`,
      storm: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 39h28a11 11 0 0 0 1.4-21.9A14.5 14.5 0 0 0 18 20a9.5 9.5 0 0 0 0 19Z" fill="#CFD8EA" fill-opacity="0.92"/>
        <path d="M35 39 27 50h6l-2 9 10-12h-6l2-8Z" fill="#FFD60A"/>
      </svg>`,
      fog: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M19 36h26a9.5 9.5 0 0 0 1.2-18.9A12.5 12.5 0 0 0 19 20a8 8 0 0 0 0 16Z" fill="#D6DCE8" fill-opacity="0.88"/>
        <g stroke="#CBD5E1" stroke-width="3.2" stroke-linecap="round" opacity="0.8">
          <line x1="15" y1="44" x2="49" y2="44"/>
          <line x1="20" y1="52" x2="44" y2="52"/>
        </g>
      </svg>`,
      snow: `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
        <path d="M18 40h28a11 11 0 0 0 1.4-21.9A14.5 14.5 0 0 0 18 21a9.5 9.5 0 0 0 0 19Z" fill="#EEF4FF"/>
        <g fill="#7DD3FC">
          <circle cx="22" cy="49" r="2.6"/><circle cx="32" cy="53" r="2.6"/><circle cx="42" cy="49" r="2.6"/>
        </g>
      </svg>`,
    };
    return svgs[iconType] || svgs.cloud;
  }

  async function fetchWeather(silent = false) {
    const loc = state.weatherLocation || DEFAULT_WEATHER_LOCATION;
    el.refreshWeatherBtn.classList.add('spinning');
    el.weatherCityName.textContent = loc.name;

    try {
      const params = new URLSearchParams({
        latitude: String(loc.latitude),
        longitude: String(loc.longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
        hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: '2',
      });

      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const cur = data.current;
      const visual = getWeatherVisual(cur.weather_code, cur.is_day);

      const nowHourPrefix = cur.time ? cur.time.slice(0, 13) : '';
      let startIdx = (data.hourly?.time || []).findIndex((t) => t.startsWith(nowHourPrefix));
      if (startIdx < 0) startIdx = 0;

      const hourlySlots = [0, 3, 6, 9]
        .map((offset, idx) => {
          const i = startIdx + offset;
          if (!data.hourly?.time?.[i]) return null;
          const timeStr = data.hourly.time[i];
          const hourLabel = idx === 0 ? 'Agora' : `${timeStr.slice(11, 13)}h`;
          const code = data.hourly.weather_code[i];
          const isDaySlot = data.hourly.is_day ? data.hourly.is_day[i] : cur.is_day;
          const slotVisual = getWeatherVisual(code, isDaySlot);
          return {
            label: hourLabel,
            temp: Math.round(data.hourly.temperature_2m[i]),
            rainProb: data.hourly.precipitation_probability?.[i] ?? 0,
            icon: slotVisual.icon,
            condition: slotVisual.label,
          };
        })
        .filter(Boolean);

      const rainChanceNow =
        data.daily?.precipitation_probability_max?.[0] ??
        hourlySlots[0]?.rainProb ??
        0;

      state.weatherData = {
        city: loc.name,
        temp: Math.round(cur.temperature_2m),
        feelsLike: Math.round(cur.apparent_temperature),
        humidity: Math.round(cur.relative_humidity_2m),
        wind: Math.round(cur.wind_speed_10m),
        maxTemp: Math.round(data.daily?.temperature_2m_max?.[0] ?? cur.temperature_2m),
        minTemp: Math.round(data.daily?.temperature_2m_min?.[0] ?? cur.temperature_2m),
        rainChance: Math.round(rainChanceNow),
        condition: visual.label,
        theme: visual.theme,
        icon: visual.icon,
        hourly: hourlySlots,
      };

      renderWeatherWidget();
    } catch (err) {
      console.warn('Erro ao buscar clima:', err);
      el.weatherCondition.textContent = 'Clima indisponível';
      if (!silent) {
        showToast('Não foi possível atualizar o clima agora.', 'error', 3200);
      }
    } finally {
      el.refreshWeatherBtn.classList.remove('spinning');
    }
  }

  function renderWeatherWidget() {
    const w = state.weatherData;
    if (!w) return;

    el.weatherWidget.dataset.weatherTheme = w.theme;
    el.weatherCityName.textContent = w.city;
    el.weatherTemp.textContent = `${w.temp}°`;
    el.weatherCondition.textContent = w.condition;
    el.weatherHighLow.textContent = `Máx ${w.maxTemp}° · Mín ${w.minTemp}°`;
    el.weatherHeroIcon.innerHTML = renderWeatherSvg(w.icon, 58);

    el.weatherFeelsLike.textContent = `${w.feelsLike}°`;
    el.weatherHumidity.textContent = `${w.humidity}%`;
    el.weatherRainChance.textContent = `${w.rainChance}%`;
    el.weatherWind.textContent = `${w.wind} km/h`;

    el.weatherHourlyStrip.innerHTML = w.hourly
      .map(
        (slot) => `
          <div class="hourly-slot">
            <span class="hourly-time">${escapeHtml(slot.label)}</span>
            <span class="hourly-icon">${renderWeatherSvg(slot.icon, 24)}</span>
            <span class="hourly-temp">${slot.temp}°</span>
          </div>
        `
      )
      .join('');
  }

  async function searchAndSetCity(cityQuery) {
    const query = cityQuery.trim();
    if (!query) return false;

    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=pt&format=json`;
      const res = await fetch(url);
      const data = await res.json();
      const hit = data?.results?.[0];
      if (!hit) {
        showToast(`Cidade "${query}" não encontrada.`, 'error', 3400);
        return false;
      }

      const region = hit.admin1 ? `, ${hit.admin1}` : hit.country_code ? `, ${hit.country_code}` : '';
      const displayName = `${hit.name}${region}`;
      saveWeatherLocation({
        name: displayName,
        latitude: hit.latitude,
        longitude: hit.longitude,
      });

      el.weatherCityForm.classList.add('hidden');
      el.weatherCityInput.value = '';
      await fetchWeather(false);
      showToast(`Clima atualizado para ${displayName}!`, 'success', 2400);
      return true;
    } catch (err) {
      console.warn('Erro geocoding cidade:', err);
      showToast('Erro ao buscar cidade. Verifique sua internet.', 'error', 3400);
      return false;
    }
  }

  function detectWeatherByGPS() {
    if (!('geolocation' in navigator)) {
      showToast('Geolocalização não suportada neste navegador.', 'error', 3500);
      return;
    }

    el.refreshWeatherBtn.classList.add('spinning');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let cityName = 'Sua localização';

        try {
          const revRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=pt-BR`
          );
          if (revRes.ok) {
            const revData = await revRes.json();
            const addr = revData.address || {};
            const town = addr.city || addr.town || addr.municipality || addr.village;
            const stateCode = addr.state;
            if (town) {
              cityName = stateCode ? `${town}, ${stateCode}` : town;
            }
          }
        } catch {
          // Usa fallback amigável
        }

        saveWeatherLocation({ name: cityName, latitude, longitude });
        await fetchWeather(false);
        showToast(`Localização definida: ${cityName}`, 'success', 2500);
      },
      (err) => {
        el.refreshWeatherBtn.classList.remove('spinning');
        console.warn('Geolocation error:', err);
        showToast(
          'GPS indisponível (no iPhone exige HTTPS). Toque no nome da cidade para escolher manualmente.',
          'info',
          4600
        );
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  }

  function buildWeatherContextForGemini() {
    const w = state.weatherData;
    if (!w) return 'Dados de clima não disponíveis no momento.';
    const hourlySummary = w.hourly
      .map((s) => `${s.label}: ${s.temp}°C (${s.condition})`)
      .join(', ');
    return `Clima atual em ${w.city}: ${w.temp}°C (sensação de ${w.feelsLike}°C), ${w.condition}. Máxima de ${w.maxTemp}°C e mínima de ${w.minTemp}°C. Umidade ${w.humidity}%, chance de chuva ${w.rainChance}%, vento ${w.wind} km/h. Próximas horas: ${hourlySummary}.`;
  }

  // --------------------------------------------------------------------------
  // Wake Lock API ("Manter Tela Ligada")
  // --------------------------------------------------------------------------
  function updateWakeLockUI(active) {
    el.wakeLockBtn.setAttribute('aria-pressed', String(active));
  }

  async function requestWakeLock(silent = false) {
    if (!('wakeLock' in navigator)) {
      if (!silent) {
        showToast('Wake Lock não suportado neste navegador/contexto (use HTTPS).', 'error', 4200);
      }
      return false;
    }

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      state.wakeLockSentinel = sentinel;
      state.wakeLockDesired = true;
      updateWakeLockUI(true);

      sentinel.addEventListener('release', () => {
        state.wakeLockSentinel = null;
        if (!state.wakeLockDesired) {
          updateWakeLockUI(false);
        }
      });

      if (!silent) {
        showToast('Tela mantida ligada (Wake Lock ativo).', 'success', 2400);
      }
      return true;
    } catch (err) {
      console.warn('Falha ao ativar Wake Lock:', err);
      state.wakeLockDesired = false;
      updateWakeLockUI(false);
      if (!silent) {
        showToast('Não foi possível manter a tela ligada (verifique bateria/HTTPS).', 'error', 4000);
      }
      return false;
    }
  }

  async function releaseWakeLock(silent = false) {
    state.wakeLockDesired = false;
    if (state.wakeLockSentinel) {
      try {
        await state.wakeLockSentinel.release();
      } catch {
        // Ignora
      }
      state.wakeLockSentinel = null;
    }
    updateWakeLockUI(false);
    if (!silent) {
      showToast('Bloqueio automático da tela restaurado.', 'info', 2200);
    }
  }

  async function toggleWakeLock() {
    if (state.wakeLockDesired || state.wakeLockSentinel) {
      await releaseWakeLock();
    } else {
      await requestWakeLock();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.wakeLockDesired && !state.wakeLockSentinel) {
      requestWakeLock(true);
    }
  });

  // --------------------------------------------------------------------------
  // Tela Cheia (Desktop, Safari macOS/iPadOS e Guia PWA no iPhone Safari)
  // --------------------------------------------------------------------------
  function openIosFullscreenGuide() {
    el.iosFullscreenModal.classList.remove('hidden');
  }

  function closeIosFullscreenGuide() {
    el.iosFullscreenModal.classList.add('hidden');
  }

  function setupFullscreenButton() {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    // Se já estiver aberto como App na Tela de Início (tela cheia real no iOS), oculta o botão
    if (isStandalone) {
      el.fullscreenBtn.classList.add('hidden');
      return;
    }

    const docEl = document.documentElement;
    const reqFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
    const isFsSupported = Boolean(
      (document.fullscreenEnabled || document.webkitFullscreenEnabled) && reqFs
    );

    const getFsElement = () =>
      document.fullscreenElement || document.webkitFullscreenElement || null;

    el.fullscreenBtn.addEventListener('click', async () => {
      if (!isFsSupported) {
        // iPhone Safari não implementa Fullscreen API em abas comuns -> mostra guia de Tela de Início
        openIosFullscreenGuide();
        return;
      }

      try {
        if (!getFsElement()) {
          const result = reqFs.call(docEl);
          if (result && typeof result.catch === 'function') {
            await result;
          }
        } else if (exitFs) {
          const result = exitFs.call(document);
          if (result && typeof result.catch === 'function') {
            await result;
          }
        }
      } catch (err) {
        console.warn('Erro ao alternar tela cheia:', err);
        openIosFullscreenGuide();
      }
    });

    el.closeIosGuideBtn.addEventListener('click', closeIosFullscreenGuide);
    el.okIosGuideBtn.addEventListener('click', closeIosFullscreenGuide);
    el.iosFullscreenModal.addEventListener('click', (e) => {
      if (e.target === el.iosFullscreenModal) closeIosFullscreenGuide();
    });
  }

  // --------------------------------------------------------------------------
  // 2. Integração com Google Agenda (Google Identity Services OAuth)
  // --------------------------------------------------------------------------
  function saveSessionToken(token, expiresInSeconds) {
    const expiresAt = Date.now() + Math.max(60, (expiresInSeconds || 3500) - 60) * 1000;
    state.accessToken = token;
    state.tokenExpiresAt = expiresAt;
    try {
      sessionStorage.setItem(
        STORAGE_KEYS.SESSION_TOKEN,
        JSON.stringify({ token, expiresAt })
      );
    } catch {
      // Ignora
    }
  }

  function restoreSessionToken() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt) {
        state.accessToken = parsed.token;
        state.tokenExpiresAt = parsed.expiresAt;
        return true;
      }
      sessionStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    } catch {
      // Ignora
    }
    return false;
  }

  function clearSessionToken() {
    state.accessToken = null;
    state.tokenExpiresAt = 0;
    try {
      sessionStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    } catch {
      // Ignora
    }
  }

  function ensureGoogleTokenClient(clientId) {
    if (!window.google?.accounts?.oauth2) {
      throw new Error('Biblioteca Google Identity Services ainda não carregou. Verifique sua conexão.');
    }

    if (state.tokenClient && state.tokenClientIdUsed === clientId) {
      return state.tokenClient;
    }

    state.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: CALENDAR_SCOPE,
      callback: async (tokenResponse) => {
        if (tokenResponse.error) {
          showToast(`Erro OAuth Google: ${tokenResponse.error}`, 'error', 4500);
          return;
        }
        saveSessionToken(tokenResponse.access_token, Number(tokenResponse.expires_in));
        state.calendarMode = 'google';
        showToast('Google Agenda conectada!', 'success', 2500);
        await fetchTodayEvents();
        startCalendarAutoRefresh();
      },
      error_callback: (err) => {
        console.warn('GIS error_callback:', err);
        if (err?.type === 'popup_closed') {
          showToast('Login com Google cancelado.', 'info', 2500);
        } else {
          showToast('Não foi possível abrir o login do Google. Permita pop-ups para este site.', 'error', 4500);
        }
      },
    });
    state.tokenClientIdUsed = clientId;
    return state.tokenClient;
  }

  function connectGoogleCalendar() {
    const clientId = getGoogleClientId();
    if (!clientId) {
      showToast('Cole seu Google OAuth Client ID nos Ajustes primeiro.', 'error', 4000);
      openSettingsModal('googleClientIdInput');
      return;
    }

    if (window.location.protocol === 'file:') {
      showToast('O Google OAuth exige http://localhost ou HTTPS.', 'error', 5000);
      return;
    }

    try {
      const client = ensureGoogleTokenClient(clientId);
      client.requestAccessToken({ prompt: state.accessToken ? '' : 'consent' });
    } catch (err) {
      showToast(err.message, 'error', 4500);
    }
  }

  function setAgendaView(view) {
    el.agendaConnectState.classList.toggle('hidden', view !== 'connect');
    el.agendaLoading.classList.toggle('hidden', view !== 'loading');
    el.eventsList.classList.toggle('hidden', view !== 'list');
    el.agendaEmptyToday.classList.toggle('hidden', view !== 'empty');

    const isConnected = state.calendarMode !== 'disconnected';
    el.refreshCalendarBtn.classList.toggle('hidden', !isConnected);
    el.disconnectCalendarBtn.classList.toggle('hidden', !isConnected);
    el.eventCountBadge.classList.toggle('hidden', !isConnected);
    el.agendaFooter.classList.toggle('hidden', !isConnected);
  }

  async function fetchTodayEvents() {
    if (state.calendarMode === 'demo') {
      loadDemoEvents(true);
      return;
    }

    if (!state.accessToken || Date.now() >= state.tokenExpiresAt) {
      clearSessionToken();
      state.calendarMode = 'disconnected';
      setAgendaView('connect');
      showToast('Sessão do Google expirou. Conecte novamente.', 'info', 3500);
      return;
    }

    el.refreshCalendarBtn.classList.add('spinning');
    if (state.todayEvents.length === 0) {
      setAgendaView('loading');
    }

    try {
      const now = new Date();
      const endOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999
      );

      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: endOfToday.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '5',
      });

      const response = await fetch(`${CALENDAR_EVENTS_URL}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
        },
      });

      if (response.status === 401) {
        clearSessionToken();
        state.calendarMode = 'disconnected';
        setAgendaView('connect');
        showToast('Token expirado. Clique em Conectar Google Agenda novamente.', 'error', 4200);
        return;
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      state.todayEvents = (data.items || []).slice(0, 5).map(normalizeCalendarEvent);
      renderEventsList();

      const timeStr = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());
      el.agendaSyncMeta.textContent = `Google Agenda • Atualizado às ${timeStr}`;
    } catch (err) {
      console.error('Erro ao buscar eventos:', err);
      showToast(`Erro na Google Agenda: ${err.message}`, 'error', 4500);
      if (state.todayEvents.length === 0) {
        setAgendaView('connect');
      }
    } finally {
      el.refreshCalendarBtn.classList.remove('spinning');
    }
  }

  function parseLocalAllDayDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  function normalizeCalendarEvent(raw) {
    const isAllDay = Boolean(raw.start?.date && !raw.start?.dateTime);
    const startDate = isAllDay
      ? parseLocalAllDayDate(raw.start.date)
      : new Date(raw.start?.dateTime);
    const endDate = isAllDay
      ? parseLocalAllDayDate(raw.end?.date || raw.start.date)
      : new Date(raw.end?.dateTime || raw.start?.dateTime);

    return {
      id: raw.id || Math.random().toString(36).slice(2),
      title: raw.summary || '(Sem título)',
      isAllDay,
      startDate,
      endDate,
      location: raw.location || '',
      description: raw.description || '',
    };
  }

  function formatTimeShort(date) {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !state.prefs.format24h,
    }).format(date);
  }

  function renderEventsList() {
    const now = new Date();
    const events = state.todayEvents;
    el.eventCountBadge.textContent = String(events.length);

    if (!events.length) {
      setAgendaView('empty');
      el.nextEventChip.classList.add('hidden');
      return;
    }

    setAgendaView('list');
    el.eventsList.innerHTML = events
      .map((evt) => {
        const isNow = !evt.isAllDay && now >= evt.startDate && now <= evt.endDate;
        const minsUntil = !evt.isAllDay
          ? Math.round((evt.startDate.getTime() - now.getTime()) / 60000)
          : null;

        let badgeHtml = '';
        if (isNow) {
          badgeHtml = '<span class="event-status-tag now">Agora</span>';
        } else if (minsUntil !== null && minsUntil > 0 && minsUntil <= 60) {
          badgeHtml = `<span class="event-status-tag soon">em ${minsUntil} min</span>`;
        }

        const startLabel = evt.isAllDay ? 'Dia todo' : formatTimeShort(evt.startDate);
        const endLabel = evt.isAllDay ? '' : formatTimeShort(evt.endDate);

        return `
          <li class="event-item ${isNow ? 'is-now' : ''}">
            <span class="event-accent-bar" aria-hidden="true"></span>
            <div class="event-time-col">
              <span class="event-start">${escapeHtml(startLabel)}</span>
              ${endLabel ? `<span class="event-end">${escapeHtml(endLabel)}</span>` : ''}
            </div>
            <div class="event-info-col">
              <div class="event-title-row">
                <span class="event-title" title="${escapeHtml(evt.title)}">${escapeHtml(evt.title)}</span>
                ${badgeHtml}
              </div>
              ${evt.location ? `<span class="event-location" title="${escapeHtml(evt.location)}">${escapeHtml(evt.location)}</span>` : ''}
            </div>
          </li>
        `;
      })
      .join('');

    const nextEvt = events[0];
    if (nextEvt) {
      const when = nextEvt.isAllDay ? 'hoje' : `às ${formatTimeShort(nextEvt.startDate)}`;
      el.nextEventChipText.textContent = `Próximo: ${nextEvt.title} (${when})`;
      el.nextEventChip.classList.remove('hidden');
    }
  }

  function startCalendarAutoRefresh() {
    stopCalendarAutoRefresh();
    state.calendarRefreshTimer = setInterval(() => {
      if (state.calendarMode === 'google') {
        fetchTodayEvents();
      }
    }, CALENDAR_REFRESH_MS);
  }

  function stopCalendarAutoRefresh() {
    if (state.calendarRefreshTimer) {
      clearInterval(state.calendarRefreshTimer);
      state.calendarRefreshTimer = null;
    }
  }

  function disconnectCalendar() {
    if (state.accessToken && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(state.accessToken, () => {});
      } catch {
        // Ignora
      }
    }
    stopCalendarAutoRefresh();
    clearSessionToken();
    state.calendarMode = 'disconnected';
    state.todayEvents = [];
    el.nextEventChip.classList.add('hidden');
    setAgendaView('connect');
    showToast('Agenda desconectada.', 'info', 2200);
  }

  function loadDemoEvents(silent = false) {
    const now = new Date();
    const mk = (offsetMin, durationMin, title, location) => {
      const startDate = new Date(now.getTime() + offsetMin * 60000);
      const endDate = new Date(startDate.getTime() + durationMin * 60000);
      return {
        id: `demo-${offsetMin}`,
        title,
        isAllDay: false,
        startDate,
        endDate,
        location,
        description: '',
      };
    };

    state.calendarMode = 'demo';
    state.todayEvents = [
      mk(-10, 40, 'Daily de Produto & Design', 'Google Meet'),
      mk(45, 60, 'Revisão de Arquitetura PWA', 'Sala Vidro 2'),
      mk(135, 45, 'Almoço com Mariana', 'Bistrô Paulista'),
      mk(220, 60, 'Call de Alinhamento com Cliente', 'Zoom'),
      mk(330, 50, 'Treino / Academia', 'Smart Fit'),
    ];
    renderEventsList();
    el.agendaSyncMeta.textContent = 'Modo demonstração • 5 eventos fictícios de hoje';
    if (!silent) {
      showToast('Agenda de exemplo carregada!', 'success', 2600);
    }
  }

  function buildCalendarContextForGemini() {
    if (state.calendarMode === 'disconnected') {
      return 'A Google Agenda ainda não está conectada pelo usuário.';
    }
    if (!state.todayEvents.length) {
      return 'A Google Agenda está conectada, mas não há mais eventos agendados para hoje.';
    }
    const header =
      state.calendarMode === 'demo'
        ? 'Eventos de hoje (modo demonstração):'
        : 'Próximos eventos de hoje na Google Agenda do usuário:';
    const lines = state.todayEvents.map((evt, idx) => {
      const timeRange = evt.isAllDay
        ? 'Dia todo'
        : `${formatTimeShort(evt.startDate)} às ${formatTimeShort(evt.endDate)}`;
      const loc = evt.location ? ` | Local: ${evt.location}` : '';
      return `${idx + 1}. ${timeRange} — ${evt.title}${loc}`;
    });
    return `${header}\n${lines.join('\n')}`;
  }

  // --------------------------------------------------------------------------
  // 3. Assistente de Voz: SpeechRecognition + Gemini 2.5 Flash + SpeechSynthesis
  // --------------------------------------------------------------------------
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const allVoices = window.speechSynthesis.getVoices() || [];
    const ptVoices = allVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('pt'));
    state.availableVoices = ptVoices.length ? ptVoices : allVoices;

    const currentSelected = state.prefs.voiceURI;
    el.voiceSelect.innerHTML = '<option value="">Automática (melhor voz pt-BR)</option>';
    state.availableVoices.forEach((voice) => {
      const opt = document.createElement('option');
      opt.value = voice.voiceURI;
      opt.textContent = `${voice.name} (${voice.lang})`;
      if (voice.voiceURI === currentSelected) opt.selected = true;
      el.voiceSelect.appendChild(opt);
    });
  }

  function pickBestPortugueseVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;

    if (state.prefs.voiceURI) {
      const saved = voices.find((v) => v.voiceURI === state.prefs.voiceURI);
      if (saved) return saved;
    }

    const ptBr = voices.filter((v) => v.lang && v.lang.toLowerCase() === 'pt-br');
    const preferredPatterns = [
      /luciana/i,
      /google português/i,
      /francisca/i,
      /antonio/i,
      /enhanced|premium|natural/i,
    ];
    for (const pattern of preferredPatterns) {
      const match = ptBr.find((v) => pattern.test(v.name));
      if (match) return match;
    }

    return ptBr[0] || voices.find((v) => v.lang?.toLowerCase().startsWith('pt')) || null;
  }

  function sanitizeTextForSpeech(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_`#~>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitIntoSpeechChunks(text, maxLen = 190) {
    const clean = sanitizeTextForSpeech(text);
    if (!clean) return [];
    const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
    const chunks = [];
    let buffer = '';

    for (const s of sentences) {
      if ((buffer + s).length <= maxLen) {
        buffer += s;
      } else {
        if (buffer.trim()) chunks.push(buffer.trim());
        if (s.length <= maxLen) {
          buffer = s;
        } else {
          const parts = s.match(new RegExp(`.{1,${maxLen}}(\\s|$)`, 'g')) || [s];
          parts.forEach((p) => {
            if (p.trim()) chunks.push(p.trim());
          });
          buffer = '';
        }
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks;
  }

  function stopSpeaking() {
    state.speechQueueId += 1;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (state.assistantState === 'speaking') {
      setAssistantState('idle');
    }
  }

  function speakText(text) {
    if (!('speechSynthesis' in window)) {
      setAssistantState('idle');
      return;
    }

    const chunks = splitIntoSpeechChunks(text);
    if (!chunks.length) {
      setAssistantState('idle');
      return;
    }

    window.speechSynthesis.cancel();
    const queueId = ++state.speechQueueId;
    const voice = pickBestPortugueseVoice();
    const rate = Number(state.prefs.speechRate) || 1.05;

    setAssistantState('speaking');

    const speakNext = (index) => {
      if (queueId !== state.speechQueueId) return;
      if (index >= chunks.length) {
        setAssistantState('idle');
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = voice?.lang || 'pt-BR';
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.pitch = 1.0;

      utterance.onend = () => speakNext(index + 1);
      utterance.onerror = (evt) => {
        if (evt.error !== 'interrupted' && evt.error !== 'canceled') {
          console.warn('Erro SpeechSynthesis:', evt.error);
        }
        if (queueId === state.speechQueueId) {
          setAssistantState('idle');
        }
      };

      window.speechSynthesis.speak(utterance);
    };

    speakNext(0);
  }

  function startVoiceRecognition() {
    unlockAudioOnFirstGesture();

    if (state.assistantState === 'speaking') {
      stopSpeaking();
      return;
    }

    if (state.assistantState === 'listening' && state.recognition) {
      state.recognition.stop();
      return;
    }

    if (state.assistantState === 'thinking' && state.currentAbortController) {
      state.currentAbortController.abort();
      state.currentAbortController = null;
      setAssistantState('idle');
      showToast('Consulta cancelada.', 'info', 2000);
      return;
    }

    if (!hasGeminiAccess()) {
      showToast('Configure sua GEMINI_API_KEY antes de usar o assistente.', 'error', 4000);
      openSettingsModal('geminiKeyInput');
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast('Reconhecimento de voz não suportado neste navegador. Use o campo de texto abaixo.', 'error', 4500);
      el.textInput.focus();
      return;
    }

    stopSpeaking();

    const recognition = new SpeechRec();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    state.recognition = recognition;
    state.finalTranscript = '';
    let latestTranscript = '';

    recognition.onstart = () => {
      playChime('start');
      setAssistantState('listening');
      el.responseCard.classList.remove('hidden');
      el.userTranscript.classList.remove('hidden');
      el.userTranscript.textContent = 'Ouvindo...';
      el.assistantReply.textContent = '';
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      if (finalText) {
        state.finalTranscript += finalText;
      }
      latestTranscript = (state.finalTranscript + interim).trim();
      if (latestTranscript) {
        el.userTranscript.textContent = `“${latestTranscript}”`;
      }
    };

    recognition.onerror = (event) => {
      console.warn('SpeechRecognition error:', event.error);
      playChime('error');
      const errorMessages = {
        'not-allowed': 'Permissão de microfone negada (no iPhone exige HTTPS).',
        'service-not-allowed': 'Serviço de voz bloqueado no dispositivo.',
        'no-speech': 'Não ouvi nenhuma fala. Tente novamente falando mais perto.',
        'audio-capture': 'Nenhum microfone encontrado.',
        network: 'Erro de rede no reconhecimento de voz.',
      };
      const msg = errorMessages[event.error];
      if (msg && event.error !== 'aborted') {
        showToast(msg, 'error', 4200);
      }
      if (state.assistantState === 'listening') {
        setAssistantState('idle');
      }
    };

    recognition.onend = () => {
      state.recognition = null;
      const question = (state.finalTranscript || latestTranscript).trim();
      if (question) {
        playChime('end');
        askGemini(question);
      } else if (state.assistantState === 'listening') {
        setAssistantState('idle');
        if (!state.lastReply) {
          el.responseCard.classList.add('hidden');
        }
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error('Erro ao iniciar SpeechRecognition:', err);
      showToast('Não foi possível iniciar o microfone.', 'error', 3500);
      setAssistantState('idle');
    }
  }

  async function askGemini(question) {
    const apiKey = getGeminiKey();
    const useServerProxy = !apiKey && state.serverGeminiConfigured;

    if (!apiKey && !useServerProxy) {
      showToast('Configure sua GEMINI_API_KEY nos Ajustes.', 'error', 4000);
      openSettingsModal('geminiKeyInput');
      return;
    }

    stopSpeaking();
    setAssistantState('thinking');
    el.responseCard.classList.remove('hidden');
    el.userTranscript.classList.remove('hidden');
    el.userTranscript.textContent = `“${question}”`;
    el.assistantReply.textContent = 'Pensando...';

    const now = new Date();
    const formattedNow = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);

    const calendarContext = buildCalendarContextForGemini();
    const weatherContext = buildWeatherContextForGemini();

    const systemPrompt = [
      'Você é o Smart Dock, um assistente pessoal inteligente por voz em português do Brasil.',
      'Suas respostas serão lidas em voz alta por síntese de fala (TTS): escreva de forma natural, clara, amigável e objetiva (1 a 3 frases curtas, salvo se o usuário pedir mais detalhes).',
      'NÃO use formatação markdown como asteriscos, negrito, hashtags, listas com marcadores ou emojis.',
      `Data e hora atuais: ${formattedNow}.`,
      `Clima em tempo real:\n${weatherContext}`,
      `Agenda de hoje do usuário:\n${calendarContext}`,
      'Use os dados reais de agenda e clima sempre que forem relevantes para a pergunta.',
    ].join('\n\n');

    const recentHistory = state.chatHistory.slice(-6);
    const contents = [
      ...recentHistory,
      {
        role: 'user',
        parts: [{ text: question }],
      },
    ];

    const controller = new AbortController();
    state.currentAbortController = controller;

    try {
      const targetUrl = useServerProxy
        ? './api/gemini'
        : `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 512,
          },
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const apiMsg = data?.error?.message || `Erro HTTP ${response.status}`;
        throw new Error(apiMsg);
      }

      const rawReply =
        data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join(' ')
          .trim() || '';

      if (!rawReply) {
        throw new Error('O Gemini retornou uma resposta vazia.');
      }

      const cleanReply = sanitizeTextForSpeech(rawReply);
      state.lastReply = cleanReply;
      state.chatHistory.push(
        { role: 'user', parts: [{ text: question }] },
        { role: 'model', parts: [{ text: cleanReply }] }
      );
      if (state.chatHistory.length > 10) {
        state.chatHistory = state.chatHistory.slice(-10);
      }

      el.assistantReply.textContent = cleanReply;
      speakText(cleanReply);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Erro Gemini API:', err);
      playChime('error');
      const friendlyErr = `Não consegui consultar o Gemini: ${err.message}`;
      el.assistantReply.textContent = friendlyErr;
      showToast(friendlyErr, 'error', 5000);
      setAssistantState('idle');
    } finally {
      state.currentAbortController = null;
    }
  }

  // --------------------------------------------------------------------------
  // 4. Modal de Configurações Seguras (localStorage)
  // --------------------------------------------------------------------------
  function openSettingsModal(focusFieldId = null) {
    el.geminiKeyInput.value = getGeminiKey();
    el.geminiKeyInput.type = 'password';
    el.geminiKeyInput.placeholder = state.serverGeminiConfigured
      ? 'Conectada automaticamente via Vercel (opcional sobrescrever)'
      : 'AIzaSy...';
    el.googleClientIdInput.value = localStorage.getItem(STORAGE_KEYS.GOOGLE_CLIENT_ID) || '';
    el.googleClientIdInput.placeholder = state.serverGoogleClientId
      ? 'Conectado automaticamente via Vercel (opcional sobrescrever)'
      : '1234567890-abcdefg.apps.googleusercontent.com';
    el.settingsCityInput.value = '';
    el.settingsCityInput.placeholder = `Atual: ${state.weatherLocation.name}`;
    el.speechRateInput.value = String(state.prefs.speechRate);
    el.speechRateValue.textContent = `${Number(state.prefs.speechRate).toFixed(2)}x`;
    el.format24hToggle.checked = Boolean(state.prefs.format24h);
    el.showSecondsToggle.checked = Boolean(state.prefs.showSeconds);
    el.soundChimesToggle.checked = Boolean(state.prefs.soundChimes);
    el.currentOriginCode.textContent =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : 'http://localhost:8787';

    loadVoices();
    el.settingsModal.classList.remove('hidden');

    if (focusFieldId && el[focusFieldId]) {
      setTimeout(() => el[focusFieldId].focus(), 80);
    }
  }

  function closeSettingsModal() {
    el.settingsModal.classList.add('hidden');
  }

  async function handleSaveSettings(event) {
    event.preventDefault();
    const geminiKey = el.geminiKeyInput.value.trim();
    const googleClientId = el.googleClientIdInput.value.trim();
    const newCity = el.settingsCityInput.value.trim();

    if (geminiKey) {
      localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, geminiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
    }

    if (googleClientId) {
      localStorage.setItem(STORAGE_KEYS.GOOGLE_CLIENT_ID, googleClientId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.GOOGLE_CLIENT_ID);
    }

    savePrefs({
      voiceURI: el.voiceSelect.value,
      speechRate: Number(el.speechRateInput.value) || 1.05,
      format24h: el.format24hToggle.checked,
      showSeconds: el.showSecondsToggle.checked,
      soundChimes: el.soundChimesToggle.checked,
    });

    updateConfigBadge();
    updateClock();
    if (state.todayEvents.length > 0) {
      renderEventsList();
    }

    closeSettingsModal();
    showToast('Ajustes salvos no navegador!', 'success', 2400);

    if (newCity) {
      await searchAndSetCity(newCity);
    }
  }

  function handleClearKeys() {
    const confirmed = window.confirm(
      'Remover GEMINI_API_KEY e Google OAuth Client ID salvos neste navegador?'
    );
    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
    localStorage.removeItem(STORAGE_KEYS.GOOGLE_CLIENT_ID);
    el.geminiKeyInput.value = '';
    el.googleClientIdInput.value = '';
    disconnectCalendar();
    updateConfigBadge();
    showToast('Chaves removidas do localStorage.', 'info', 2800);
  }

  // --------------------------------------------------------------------------
  // Status Online / Offline & Service Worker (PWA)
  // --------------------------------------------------------------------------
  function updateOnlineStatus() {
    el.connectionDot.classList.toggle('offline', !navigator.onLine);
    el.connectionDot.title = navigator.onLine ? 'Online' : 'Offline';
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
          console.warn('Falha ao registrar Service Worker:', err);
        });
      });
    }
  }

  // --------------------------------------------------------------------------
  // Inicialização e Eventos
  // --------------------------------------------------------------------------
  function bindEvents() {
    el.wakeLockBtn.addEventListener('click', toggleWakeLock);
    el.settingsBtn.addEventListener('click', () => openSettingsModal());
    el.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    el.cancelSettingsBtn.addEventListener('click', closeSettingsModal);
    el.settingsForm.addEventListener('submit', handleSaveSettings);
    el.clearKeysBtn.addEventListener('click', handleClearKeys);

    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) closeSettingsModal();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!el.settingsModal.classList.contains('hidden')) closeSettingsModal();
        if (!el.iosFullscreenModal.classList.contains('hidden')) closeIosFullscreenGuide();
      }
    });

    el.toggleGeminiKeyBtn.addEventListener('click', () => {
      el.geminiKeyInput.type = el.geminiKeyInput.type === 'password' ? 'text' : 'password';
    });

    el.speechRateInput.addEventListener('input', () => {
      el.speechRateValue.textContent = `${Number(el.speechRateInput.value).toFixed(2)}x`;
    });

    el.copyOriginBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el.currentOriginCode.textContent);
        showToast('Origem copiada!', 'success', 1800);
      } catch {
        showToast('Copie o endereço manualmente.', 'info', 2200);
      }
    });

    // Clima
    el.weatherCityBtn.addEventListener('click', () => {
      el.weatherCityForm.classList.toggle('hidden');
      if (!el.weatherCityForm.classList.contains('hidden')) {
        el.weatherCityInput.focus();
      }
    });

    el.cancelCitySearchBtn.addEventListener('click', () => {
      el.weatherCityForm.classList.add('hidden');
    });

    el.weatherCityForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchAndSetCity(el.weatherCityInput.value);
    });

    el.weatherGpsBtn.addEventListener('click', detectWeatherByGPS);
    el.refreshWeatherBtn.addEventListener('click', () => fetchWeather(false));

    // Agenda
    el.connectCalendarBtn.addEventListener('click', connectGoogleCalendar);
    el.loadDemoBtn.addEventListener('click', () => loadDemoEvents(false));
    el.refreshCalendarBtn.addEventListener('click', fetchTodayEvents);
    el.disconnectCalendarBtn.addEventListener('click', disconnectCalendar);

    // Assistente de Voz, Comandos Rápidos e Texto
    el.micBtn.addEventListener('click', startVoiceRecognition);

    el.quickPrompts.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick-chip');
      if (!btn) return;
      unlockAudioOnFirstGesture();
      const prompt = btn.dataset.prompt;
      if (prompt) askGemini(prompt);
    });

    el.replayVoiceBtn.addEventListener('click', () => {
      unlockAudioOnFirstGesture();
      if (state.lastReply) {
        speakText(state.lastReply);
      }
    });

    el.clearResponseBtn.addEventListener('click', () => {
      stopSpeaking();
      state.lastReply = '';
      state.chatHistory = [];
      el.userTranscript.textContent = '';
      el.assistantReply.textContent = '';
      el.responseCard.classList.add('hidden');
    });

    el.textForm.addEventListener('submit', (e) => {
      e.preventDefault();
      unlockAudioOnFirstGesture();
      const q = el.textInput.value.trim();
      if (!q) return;
      el.textInput.value = '';
      el.textInput.blur();
      askGemini(q);
    });

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    if ('speechSynthesis' in window) {
      loadVoices();
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }
  }

  function init() {
    setupAudioUnlockListeners();
    setupFullscreenButton();
    bindEvents();
    startClock();
    updateConfigBadge();
    updateOnlineStatus();
    registerServiceWorker();
    checkServerConfig();

    // Carrega clima imediatamente e atualiza a cada 15 minutos
    fetchWeather(true);
    setInterval(() => fetchWeather(true), WEATHER_REFRESH_MS);

    // Restaura sessão válida do Google Calendar
    if (restoreSessionToken()) {
      state.calendarMode = 'google';
      fetchTodayEvents();
      startCalendarAutoRefresh();
    } else {
      setAgendaView('connect');
    }
  }

  init();
})();
