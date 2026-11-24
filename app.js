/* ==========================================================================
   Smart Dock & Assistente Pessoal por Voz (PWA — Apple iOS Dark Style)
   Relógio + Clima (Open-Meteo) + Wake Lock + Google Agenda + Gemini API
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

  const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
  const GEMINI_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
  const GEMINI_TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
  const GEMINI_REQUEST_TIMEOUT_MS = 16000;
  const GEMINI_TTS_TIMEOUT_MS = 8000;
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
  const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const CALENDAR_REFRESH_MS = 5 * 60 * 1000; // 5 minutos
  const WEATHER_REFRESH_MS = 15 * 60 * 1000; // 15 minutos
  const BRIEFING_PROMPT =
    'Bom dia! Faça um resumo objetivo e natural para ser lido em voz alta com: 1) a previsão do tempo atual e de hoje (manhã, tarde, noite e chance de chuva) mais um breve resumo de amanhã; 2) meus compromissos de hoje; 3) os principais eventos dos próximos dias da semana na minha Google Agenda.';

  const DEFAULT_WEATHER_LOCATION = {
    name: 'São Paulo, SP',
    latitude: -23.5505,
    longitude: -46.6333,
  };

  const DEFAULT_PREFS = {
    format24h: true,
    showSeconds: true,
    voiceEngine: 'gemini', // 'gemini' | 'browser'
    geminiVoiceName: 'Aoede',
    voiceURI: '',
    speechRate: 1.0,
    soundChimes: true,
    continuousVoice: false,
    geminiModel: DEFAULT_GEMINI_MODEL,
  };

  // --------------------------------------------------------------------------
  // Estado da Aplicação
  // --------------------------------------------------------------------------
  const state = {
    assistantState: 'idle', // 'idle' | 'listening' | 'thinking' | 'speaking'
    audioUnlocked: false,
    speechPrimed: false,
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
    hasCalendarWriteScope: false,
    pendingEventToCreate: null,
    calendarMode: 'disconnected', // 'disconnected' | 'google' | 'demo'
    agendaRange: 'week', // 'day' | 'week' (widget)
    modalAgendaRange: 'week', // 'day' | 'week' (modal expandido)
    todayEvents: [],
    weekEvents: [],
    calendarRefreshTimer: null,

    // Voz & Gemini
    serverGeminiConfigured: false,
    serverGoogleClientId: '',
    recognition: null,
    forceStopListening: null,
    continuousMode: false, // Começa DESATIVADO por padrão
    conversationActive: false,
    autoListenTimer: null,
    speechStartTimer: null,
    activeUtterance: null,
    finalTranscript: '',
    lastReply: '',
    chatHistory: [],
    uiMessages: [],
    availableVoices: [],
    currentAbortController: null,
    ttsAbortController: null,
    activeAudioSource: null,
    activeHtmlAudio: null,
    activeAudioUrl: null,
    lastTtsCache: null,
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
    assistantPanel: document.getElementById('assistantPanel'),
    micBtn: document.getElementById('micBtn'),
    summaryBtn: document.getElementById('summaryBtn'),
    continuousModeBtn: document.getElementById('continuousModeBtn'),
    stopVoiceBtn: document.getElementById('stopVoiceBtn'),
    assistantStatus: document.getElementById('assistantStatus'),
    responseModelLabel: document.getElementById('responseModelLabel'),
    chatMessages: document.getElementById('chatMessages'),
    chatEmptyState: document.getElementById('chatEmptyState'),
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
    expandWeatherBtn: document.getElementById('expandWeatherBtn'),
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
    agendaWidget: document.getElementById('agendaWidget'),
    agendaCardTitle: document.getElementById('agendaCardTitle'),
    agendaHeaderSub: document.getElementById('agendaHeaderSub'),
    agendaRangeSwitch: document.getElementById('agendaRangeSwitch'),
    expandAgendaBtn: document.getElementById('expandAgendaBtn'),
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

    // Modal Expandido: Agenda
    agendaExpandedModal: document.getElementById('agendaExpandedModal'),
    modalCalMonth: document.getElementById('modalCalMonth'),
    modalCalDay: document.getElementById('modalCalDay'),
    agendaModalTitle: document.getElementById('agendaModalTitle'),
    agendaModalSubtitle: document.getElementById('agendaModalSubtitle'),
    modalAgendaRangeSwitch: document.getElementById('modalAgendaRangeSwitch'),
    toggleNewEventFormBtn: document.getElementById('toggleNewEventFormBtn'),
    closeAgendaModalBtn: document.getElementById('closeAgendaModalBtn'),
    newEventForm: document.getElementById('newEventForm'),
    newEventTitle: document.getElementById('newEventTitle'),
    newEventLocation: document.getElementById('newEventLocation'),
    newEventDate: document.getElementById('newEventDate'),
    newEventStart: document.getElementById('newEventStart'),
    newEventEnd: document.getElementById('newEventEnd'),
    cancelNewEventBtn: document.getElementById('cancelNewEventBtn'),
    submitNewEventBtn: document.getElementById('submitNewEventBtn'),
    agendaExpandedContent: document.getElementById('agendaExpandedContent'),

    // Modal Expandido: Clima
    weatherExpandedModal: document.getElementById('weatherExpandedModal'),
    weatherModalPanel: document.getElementById('weatherModalPanel'),
    weatherModalTitle: document.getElementById('weatherModalTitle'),
    weatherModalSubtitle: document.getElementById('weatherModalSubtitle'),
    modalRefreshWeatherBtn: document.getElementById('modalRefreshWeatherBtn'),
    closeWeatherModalBtn: document.getElementById('closeWeatherModalBtn'),
    weatherExpandedContent: document.getElementById('weatherExpandedContent'),

    // Modal de Configurações
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    settingsForm: document.getElementById('settingsForm'),
    geminiKeyInput: document.getElementById('geminiKeyInput'),
    geminiModelSelect: document.getElementById('geminiModelSelect'),
    toggleGeminiKeyBtn: document.getElementById('toggleGeminiKeyBtn'),
    googleClientIdInput: document.getElementById('googleClientIdInput'),
    settingsCityInput: document.getElementById('settingsCityInput'),
    voiceEngineSelect: document.getElementById('voiceEngineSelect'),
    geminiVoiceSelect: document.getElementById('geminiVoiceSelect'),
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

  function renderChatMessages() {
    if (!el.chatMessages) return;
    if (!state.uiMessages.length) {
      el.chatMessages.innerHTML = `
        <div class="chat-empty-state" id="chatEmptyState">
          <p class="chat-empty-title">Como posso ajudar hoje?</p>
          <p class="chat-empty-sub">Toque no microfone, clique em <strong>Resumo</strong> ou digite sua pergunta abaixo.</p>
        </div>
      `;
      return;
    }

    el.chatMessages.innerHTML = state.uiMessages
      .map((msg) => {
        const isUser = msg.role === 'user';
        const label = isUser ? 'Você' : 'Smart Dock';
        const classes = ['chat-bubble', isUser ? 'user' : 'assistant', msg.isError ? 'is-error' : '']
          .filter(Boolean)
          .join(' ');
        return `
          <div class="${classes}">
            <div class="chat-bubble-meta">
              <span>${label}</span>
              ${msg.time ? `<span>${escapeHtml(msg.time)}</span>` : ''}
            </div>
            <p class="chat-bubble-text">${escapeHtml(msg.text)}</p>
          </div>
        `;
      })
      .join('');

    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function appendUiMessage(role, text, options = {}) {
    const time = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role,
      text: String(text || ''),
      time,
      isError: Boolean(options.isError),
    };
    state.uiMessages.push(msg);
    if (state.uiMessages.length > 24) {
      state.uiMessages = state.uiMessages.slice(-24);
    }
    renderChatMessages();
    return msg;
  }

  function updateUiMessage(msgRef, newText, isError = false) {
    if (!msgRef) return;
    msgRef.text = String(newText || '');
    msgRef.isError = Boolean(isError);
    renderChatMessages();
  }

  function isAnyModalOpen() {
    return (
      !el.settingsModal.classList.contains('hidden') ||
      !el.iosFullscreenModal.classList.contains('hidden') ||
      !el.agendaExpandedModal.classList.contains('hidden') ||
      !el.weatherExpandedModal.classList.contains('hidden')
    );
  }

  function cancelAutoListenTimer() {
    if (state.autoListenTimer) {
      clearTimeout(state.autoListenTimer);
      state.autoListenTimer = null;
    }
  }

  function updateContinuousModeUI() {
    if (!el.continuousModeBtn) return;
    el.continuousModeBtn.setAttribute('aria-pressed', String(Boolean(state.continuousMode)));
  }

  function setAssistantState(newState, statusMessage, isError = false) {
    state.assistantState = newState;
    el.body.dataset.state = newState;
    if (!el.assistantStatus) return;

    const defaultLabels = {
      idle: 'Pronto para ouvir',
      listening: 'Ouvindo...',
      thinking: 'Consultando Gemini...',
      speaking: 'Falando...',
    };
    el.assistantStatus.textContent =
      statusMessage !== undefined ? statusMessage : defaultLabels[newState] || '';
    el.assistantStatus.classList.toggle('is-error', Boolean(isError));
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
  function unlockAudioOnFirstGesture(options = {}) {
    const primeSpeech = options.primeSpeech !== false;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!state.audioCtx) {
          state.audioCtx = new AudioCtx();
        }
        if (state.audioCtx.state === 'suspended') {
          state.audioCtx.resume().catch(() => {});
        }
        if (!state.audioUnlocked) {
          const buffer = state.audioCtx.createBuffer(1, 1, 22050);
          const source = state.audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(state.audioCtx.destination);
          source.start(0);
        }
      }

      if (primeSpeech && !state.speechPrimed && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const primer = new SpeechSynthesisUtterance(' ');
        primer.lang = 'pt-BR';
        primer.volume = 0;
        primer.rate = 10;
        window.speechSynthesis.speak(primer);
        state.speechPrimed = true;
      }

      state.audioUnlocked = true;
      el.audioUnlockPill?.classList.add('unlocked');
    } catch (err) {
      console.warn('Erro ao desbloquear áudio:', err);
    }
  }

  function setupAudioUnlockListeners() {
    const events = ['touchstart', 'pointerdown', 'click', 'keydown'];
    const handler = (evt) => {
      const isMicTap = Boolean(evt?.target?.closest && evt.target.closest('#micBtn'));
      // No toque direto no microfone, desbloqueia AudioContext mas não dispara speechSynthesis
      // simultaneamente para não disputar a sessão de áudio com o SpeechRecognition no iOS
      unlockAudioOnFirstGesture({ primeSpeech: !isMicTap });
      if (state.audioUnlocked && state.speechPrimed) {
        events.forEach((e) => window.removeEventListener(e, handler, true));
      }
    };
    events.forEach((evt) => window.addEventListener(evt, handler, { capture: true, passive: true }));

    el.audioUnlockPill?.addEventListener('click', () => {
      unlockAudioOnFirstGesture({ primeSpeech: true });
      playChime('start');
      showToast('Áudio e voz ativados!', 'success', 2000);
    });
  }

  function ensureAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!state.audioCtx) {
      state.audioCtx = new AudioCtx();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    return state.audioCtx;
  }

  function playChime(kind = 'start') {
    if (!state.prefs.soundChimes) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';

      if (kind === 'turn') {
        // Toquezinho bem suave e agradável indicando que é a vez do usuário falar
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(840, now + 0.085);
        gain.gain.setValueAtTime(0.0008, now);
        gain.gain.exponentialRampToValueAtTime(0.032, now + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
        return;
      }

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
      gain.connect(ctx.destination);
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
    if (el.modalCalMonth) el.modalCalMonth.textContent = shortMonth;
    if (el.modalCalDay) el.modalCalDay.textContent = String(now.getDate());
  }

  function startClock() {
    updateClock();
    setInterval(updateClock, 500);
    setInterval(() => {
      if (state.weekEvents.length > 0 || state.todayEvents.length > 0) {
        renderEventsList();
        if (!el.agendaExpandedModal.classList.contains('hidden')) {
          renderAgendaExpandedModal();
        }
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
    if (el.modalRefreshWeatherBtn) el.modalRefreshWeatherBtn.classList.add('spinning');
    el.weatherCityName.textContent = loc.name;

    try {
      const params = new URLSearchParams({
        latitude: String(loc.latitude),
        longitude: String(loc.longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
        hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,is_day',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset',
        timezone: 'auto',
        forecast_days: '7',
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

      const buildHourlySlot = (i, idx) => {
        if (!data.hourly?.time?.[i]) return null;
        const timeStr = data.hourly.time[i];
        const hourLabel = idx === 0 ? 'Agora' : `${timeStr.slice(11, 13)}h`;
        const code = data.hourly.weather_code[i];
        const isDaySlot = data.hourly.is_day ? data.hourly.is_day[i] : cur.is_day;
        const slotVisual = getWeatherVisual(code, isDaySlot);
        return {
          label: hourLabel,
          temp: Math.round(data.hourly.temperature_2m[i]),
          rainProb: Math.round(data.hourly.precipitation_probability?.[i] ?? 0),
          precipMm: Number(data.hourly.precipitation?.[i] ?? 0),
          wind: Math.round(data.hourly.wind_speed_10m?.[i] ?? 0),
          icon: slotVisual.icon,
          condition: slotVisual.label,
        };
      };

      const hourlySlots = [0, 3, 6, 9]
        .map((offset, idx) => buildHourlySlot(startIdx + offset, idx))
        .filter(Boolean);

      const hourly24 = [];
      for (let h = 0; h < 24; h++) {
        const slot = buildHourlySlot(startIdx + h, h);
        if (slot) hourly24.push(slot);
      }

      const daily7 = (data.daily?.time || []).slice(0, 7).map((dateStr, idx) => {
        const d = parseLocalAllDayDate(dateStr);
        const dayLabel =
          idx === 0
            ? 'Hoje'
            : idx === 1
              ? 'Amanhã'
              : new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
                  .format(d)
                  .replace('.', '')
                  .replace(/^./, (c) => c.toUpperCase());
        const dVis = getWeatherVisual(data.daily.weather_code?.[idx] ?? 0, 1);
        return {
          dateStr,
          dayLabel,
          icon: dVis.icon,
          condition: dVis.label,
          maxTemp: Math.round(data.daily.temperature_2m_max?.[idx] ?? cur.temperature_2m),
          minTemp: Math.round(data.daily.temperature_2m_min?.[idx] ?? cur.temperature_2m),
          rainProb: Math.round(data.daily.precipitation_probability_max?.[idx] ?? 0),
          uvMax: Math.round(data.daily.uv_index_max?.[idx] ?? 0),
          sunrise: data.daily.sunrise?.[idx]?.slice(11, 16) || '',
          sunset: data.daily.sunset?.[idx]?.slice(11, 16) || '',
        };
      });

      const todayDateStr = cur.time ? cur.time.slice(0, 10) : getLocalDateKey(new Date());
      const summarizeDayPeriods = (targetDateStr) => {
        const periods = [
          { key: 'morning', label: 'Manhã', startH: 6, endH: 11, temps: [], rains: [], codes: [] },
          { key: 'afternoon', label: 'Tarde', startH: 12, endH: 17, temps: [], rains: [], codes: [] },
          { key: 'night', label: 'Noite', startH: 18, endH: 23, temps: [], rains: [], codes: [] },
        ];
        let peakRain = { prob: 0, hour: '' };
        const times = data.hourly?.time || [];

        for (let i = 0; i < times.length; i++) {
          const t = times[i];
          if (!t || !t.startsWith(targetDateStr)) continue;
          const h = Number(t.slice(11, 13));
          const temp = data.hourly.temperature_2m?.[i];
          const rain = Math.round(data.hourly.precipitation_probability?.[i] ?? 0);
          const code = data.hourly.weather_code?.[i] ?? 0;

          if (rain > peakRain.prob) {
            peakRain = { prob: rain, hour: `${String(h).padStart(2, '0')}h` };
          }

          for (const p of periods) {
            if (h >= p.startH && h <= p.endH) {
              if (typeof temp === 'number') p.temps.push(temp);
              p.rains.push(rain);
              p.codes.push(code);
              break;
            }
          }
        }

        const result = {};
        for (const p of periods) {
          if (!p.temps.length) continue;
          const avgTemp = Math.round(p.temps.reduce((a, b) => a + b, 0) / p.temps.length);
          const minTemp = Math.round(Math.min(...p.temps));
          const maxTemp = Math.round(Math.max(...p.temps));
          const maxRain = Math.max(...p.rains, 0);
          const midCode = p.codes[Math.floor(p.codes.length / 2)] ?? 0;
          const isDayPeriod = p.key !== 'night' ? 1 : 0;
          result[p.key] = {
            label: p.label,
            avgTemp,
            minTemp,
            maxTemp,
            rainProb: maxRain,
            condition: getWeatherVisual(midCode, isDayPeriod).label,
          };
        }
        return { periods: result, peakRain };
      };

      const todayPeriodSummary = summarizeDayPeriods(todayDateStr);
      const todayDaily = daily7[0] || null;
      const tomorrowDaily = daily7[1] || null;

      let tomorrowComparison = null;
      if (todayDaily && tomorrowDaily) {
        const todayAvg = Math.round((todayDaily.minTemp + todayDaily.maxTemp) / 2);
        const tomorrowAvg = Math.round((tomorrowDaily.minTemp + tomorrowDaily.maxTemp) / 2);
        const diffAvg = tomorrowAvg - todayAvg;
        const diffRain = tomorrowDaily.rainProb - todayDaily.rainProb;

        const tempTrend =
          diffAvg >= 2
            ? `mais quente que hoje (cerca de ${diffAvg}°C a mais na média)`
            : diffAvg <= -2
              ? `mais frio que hoje (cerca de ${Math.abs(diffAvg)}°C a menos na média)`
              : diffAvg === 1
                ? 'ligeiramente mais quente que hoje (1°C a mais na média)'
                : diffAvg === -1
                  ? 'ligeiramente mais frio que hoje (1°C a menos na média)'
                  : 'com temperatura média parecida com a de hoje';

        const rainTrend =
          diffRain >= 15
            ? `mais chance de chuva que hoje (${tomorrowDaily.rainProb}% contra ${todayDaily.rainProb}% hoje)`
            : diffRain <= -15
              ? `menos chance de chuva que hoje (${tomorrowDaily.rainProb}% contra ${todayDaily.rainProb}% hoje)`
              : `chance de chuva parecida com hoje (${tomorrowDaily.rainProb}% contra ${todayDaily.rainProb}% hoje)`;

        tomorrowComparison = {
          todayAvg,
          tomorrowAvg,
          diffAvg,
          tempTrend,
          rainTrend,
          tomorrowCondition: tomorrowDaily.condition,
          tomorrowMin: tomorrowDaily.minTemp,
          tomorrowMax: tomorrowDaily.maxTemp,
          tomorrowRainProb: tomorrowDaily.rainProb,
        };
      }

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
        uvMax: daily7[0]?.uvMax ?? 0,
        sunrise: daily7[0]?.sunrise || '',
        sunset: daily7[0]?.sunset || '',
        condition: visual.label,
        theme: visual.theme,
        icon: visual.icon,
        hourly: hourlySlots,
        hourly24,
        daily7,
        todayPeriods: todayPeriodSummary.periods,
        todayPeakRain: todayPeriodSummary.peakRain,
        tomorrowComparison,
      };

      renderWeatherWidget();
      if (!el.weatherExpandedModal.classList.contains('hidden')) {
        renderWeatherExpandedModal();
      }
    } catch (err) {
      console.warn('Erro ao buscar clima:', err);
      el.weatherCondition.textContent = 'Clima indisponível';
      if (!silent) {
        showToast('Não foi possível atualizar o clima agora.', 'error', 3200);
      }
    } finally {
      el.refreshWeatherBtn.classList.remove('spinning');
      if (el.modalRefreshWeatherBtn) el.modalRefreshWeatherBtn.classList.remove('spinning');
    }
  }

  function renderWeatherTempChartSvg(hourly24) {
    if (!hourly24 || hourly24.length < 2) return '';
    const W = 420;
    const H = 160;
    const padL = 22;
    const padR = 22;
    const padT = 26;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const temps = hourly24.map((h) => h.temp);
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const span = Math.max(2, maxT - minT);

    const points = hourly24.map((h, i) => {
      const x = padL + (i / (hourly24.length - 1)) * plotW;
      const y = padT + (1 - (h.temp - minT) / span) * plotH;
      return { x, y, ...h, idx: i };
    });

    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(H - padB).toFixed(1)} L${points[0].x.toFixed(1)},${(H - padB).toFixed(1)} Z`;

    const labelIndices = [0, 3, 6, 9, 12, 15, 18, 21];
    const markers = labelIndices
      .filter((i) => points[i])
      .map((i) => {
        const p = points[i];
        return `
          <line x1="${p.x.toFixed(1)}" y1="${padT}" x2="${p.x.toFixed(1)}" y2="${H - padB}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.6" fill="#ffd60a" stroke="#12141a" stroke-width="1.5" />
          <text x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle" fill="#f5f7fa" font-size="11" font-weight="600">${p.temp}°</text>
          <text x="${p.x.toFixed(1)}" y="${H - 7}" text-anchor="middle" fill="rgba(226,232,240,0.62)" font-size="10">${escapeHtml(p.label)}</text>
        `;
      })
      .join('');

    return `
      <svg class="weather-svg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de temperatura nas próximas 24 horas">
        <defs>
          <linearGradient id="tempAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffd60a" stop-opacity="0.34" />
            <stop offset="100%" stop-color="#4c8bf5" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id="tempLineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#64d2ff" />
            <stop offset="50%" stop-color="#ffd60a" />
            <stop offset="100%" stop-color="#ff9f0a" />
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#tempAreaGrad)" />
        <path d="${linePath}" fill="none" stroke="url(#tempLineGrad)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
        ${markers}
      </svg>
    `;
  }

  function renderWeatherRainChartSvg(hourly24) {
    if (!hourly24 || !hourly24.length) return '';
    const W = 420;
    const H = 160;
    const padL = 16;
    const padR = 16;
    const padT = 24;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const samples = hourly24.filter((_, idx) => idx % 2 === 0).slice(0, 12);
    const step = plotW / samples.length;
    const barW = Math.max(12, step * 0.56);

    const bars = samples
      .map((s, idx) => {
        const pct = Math.min(100, Math.max(0, s.rainProb || 0));
        const barH = Math.max(pct > 0 ? 6 : 2, (pct / 100) * plotH);
        const cx = padL + step * idx + step / 2;
        const x = cx - barW / 2;
        const y = H - padB - barH;
        return `
          <rect x="${x.toFixed(1)}" y="${padT}" width="${barW.toFixed(1)}" height="${plotH}" rx="5" fill="rgba(255,255,255,0.04)" />
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="5" fill="${pct > 0 ? 'url(#rainBarGrad)' : 'rgba(100,210,255,0.22)'}" />
          ${pct > 0 ? `<text x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" fill="#8be0ff" font-size="9.5" font-weight="600">${pct}%</text>` : ''}
          ${idx % 2 === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle" fill="rgba(226,232,240,0.62)" font-size="10">${escapeHtml(s.label)}</text>` : ''}
        `;
      })
      .join('');

    return `
      <svg class="weather-svg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de chance de chuva nas próximas 24 horas">
        <defs>
          <linearGradient id="rainBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#64d2ff" />
            <stop offset="100%" stop-color="#2563eb" />
          </linearGradient>
        </defs>
        ${bars}
      </svg>
    `;
  }

  function renderWeatherExpandedModal() {
    const w = state.weatherData;
    if (!w) {
      el.weatherExpandedContent.innerHTML = '<p class="empty-subtitle">Carregando dados detalhados do clima...</p>';
      return;
    }

    el.weatherModalPanel.dataset.weatherTheme = w.theme;
    el.weatherModalTitle.textContent = w.city;
    el.weatherModalSubtitle.textContent = `${w.condition} · Máx ${w.maxTemp}° / Mín ${w.minTemp}°`;

    const hourly24 = w.hourly24 || w.hourly || [];
    const daily7 = w.daily7 || [];
    const maxRain24 = hourly24.reduce((m, h) => Math.max(m, h.rainProb || 0), 0);
    const weekMin = daily7.length ? Math.min(...daily7.map((d) => d.minTemp)) : w.minTemp;
    const weekMax = daily7.length ? Math.max(...daily7.map((d) => d.maxTemp)) : w.maxTemp;
    const weekSpan = Math.max(1, weekMax - weekMin);

    const hourly24Html = hourly24
      .map(
        (slot) => `
          <div class="weather-24h-item">
            <span class="hourly-time">${escapeHtml(slot.label)}</span>
            <span class="hourly-icon">${renderWeatherSvg(slot.icon, 24)}</span>
            <span class="weather-24h-rain">${slot.rainProb > 0 ? `${slot.rainProb}%` : ''}</span>
            <span class="hourly-temp">${slot.temp}°</span>
          </div>
        `
      )
      .join('');

    const daily7Html = daily7
      .map((d) => {
        const leftPct = ((d.minTemp - weekMin) / weekSpan) * 100;
        const widthPct = Math.max(8, ((d.maxTemp - d.minTemp) / weekSpan) * 100);
        return `
          <div class="weather-7d-row">
            <span class="weather-7d-day">${escapeHtml(d.dayLabel)}</span>
            <span class="hourly-icon">${renderWeatherSvg(d.icon, 24)}</span>
            <span class="weather-7d-rain">${d.rainProb > 0 ? `${d.rainProb}%` : '—'}</span>
            <span class="weather-7d-min">${d.minTemp}°</span>
            <div class="weather-7d-bar-track">
              <div class="weather-7d-bar-fill" style="left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;"></div>
            </div>
            <span class="weather-7d-max">${d.maxTemp}°</span>
          </div>
        `;
      })
      .join('');

    el.weatherExpandedContent.innerHTML = `
      <div class="weather-exp-hero">
        <div class="weather-exp-hero-left">
          <div class="weather-hero-icon" style="width:68px;height:68px;">${renderWeatherSvg(w.icon, 68)}</div>
          <div>
            <div class="weather-exp-temp">${w.temp}°</div>
            <div class="weather-exp-cond">${escapeHtml(w.condition)}</div>
            <div class="weather-exp-range">Máxima ${w.maxTemp}° · Mínima ${w.minTemp}° · Sensação ${w.feelsLike}°</div>
          </div>
        </div>
      </div>

      <div class="weather-exp-metrics">
        <div class="weather-exp-metric-card">
          <span class="weather-exp-metric-label">Sensação</span>
          <span class="weather-exp-metric-val">${w.feelsLike}°</span>
        </div>
        <div class="weather-exp-metric-card">
          <span class="weather-exp-metric-label">Umidade</span>
          <span class="weather-exp-metric-val">${w.humidity}%</span>
        </div>
        <div class="weather-exp-metric-card">
          <span class="weather-exp-metric-label">Chuva (Hoje)</span>
          <span class="weather-exp-metric-val">${w.rainChance}%</span>
        </div>
        <div class="weather-exp-metric-card">
          <span class="weather-exp-metric-label">Vento</span>
          <span class="weather-exp-metric-val">${w.wind} km/h</span>
        </div>
        <div class="weather-exp-metric-card">
          <span class="weather-exp-metric-label">Índice UV Máx</span>
          <span class="weather-exp-metric-val">${w.uvMax ?? 0}</span>
        </div>
        ${w.sunrise && w.sunset ? `
        <div class="weather-exp-metric-card">
          <span class="weather-exp-metric-label">Sol</span>
          <span class="weather-exp-metric-val">${escapeHtml(w.sunrise)} · ${escapeHtml(w.sunset)}</span>
        </div>` : ''}
      </div>

      <div class="weather-charts-grid">
        <div class="weather-chart-card">
          <h3 class="weather-chart-title">
            <span>Temperatura por Hora (24h)</span>
            <span class="weather-chart-sub">Curva térmica</span>
          </h3>
          ${renderWeatherTempChartSvg(hourly24)}
        </div>

        <div class="weather-chart-card">
          <h3 class="weather-chart-title">
            <span>Chance de Chuva (24h)</span>
            <span class="weather-chart-sub">Pico: ${maxRain24}%</span>
          </h3>
          ${renderWeatherRainChartSvg(hourly24)}
        </div>
      </div>

      <div class="weather-chart-card">
        <h3 class="weather-chart-title">
          <span>Previsão Hora a Hora (Próximas 24h)</span>
          <span class="weather-chart-sub">Deslize para o lado</span>
        </h3>
        <div class="weather-24h-scroll">${hourly24Html}</div>
      </div>

      ${daily7.length ? `
      <div class="weather-chart-card">
        <h3 class="weather-chart-title">
          <span>Previsão dos Próximos 7 Dias</span>
          <span class="weather-chart-sub">Mínima ↔ Máxima</span>
        </h3>
        <div class="weather-7d-list">${daily7Html}</div>
      </div>` : ''}
    `;
  }

  function openWeatherExpandedModal() {
    renderWeatherExpandedModal();
    el.weatherExpandedModal.classList.remove('hidden');
  }

  function closeWeatherExpandedModal() {
    el.weatherExpandedModal.classList.add('hidden');
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

    const lines = [];
    const todayAvg = Math.round((w.minTemp + w.maxTemp) / 2);
    lines.push(
      `Agora em ${w.city}: ${w.temp}°C (sensação de ${w.feelsLike}°C), ${w.condition}. Hoje: mínima ${w.minTemp}°C, máxima ${w.maxTemp}°C, média de ${todayAvg}°C, umidade ${w.humidity}%, chance máxima de chuva ${w.rainChance}%, vento ${w.wind} km/h.`
    );

    if (w.todayPeriods) {
      const periodParts = ['morning', 'afternoon', 'night']
        .map((k) => w.todayPeriods[k])
        .filter(Boolean)
        .map(
          (p) =>
            `${p.label}: média ${p.avgTemp}°C (${p.minTemp}°C a ${p.maxTemp}°C), ${p.condition}, chance de chuva ${p.rainProb}%`
        );
      if (periodParts.length) {
        lines.push(`Hoje por período: ${periodParts.join(' | ')}.`);
      }
    }

    if (w.todayPeakRain && w.todayPeakRain.prob >= 20 && w.todayPeakRain.hour) {
      lines.push(`Horário com maior chance de chuva hoje: por volta das ${w.todayPeakRain.hour} (${w.todayPeakRain.prob}%).`);
    }

    if (w.tomorrowComparison) {
      const t = w.tomorrowComparison;
      lines.push(
        `Amanhã (comparado a hoje): ${t.tomorrowCondition}, mínima ${t.tomorrowMin}°C, máxima ${t.tomorrowMax}°C, média de ${t.tomorrowAvg}°C — vai ser ${t.tempTrend}, com ${t.rainTrend}.`
      );
    }

    if (w.daily7 && w.daily7.length > 2) {
      const rest = w.daily7
        .slice(2, 6)
        .map((d) => `${d.dayLabel}: ${d.minTemp}°C-${d.maxTemp}°C (${d.condition}, chuva ${d.rainProb}%)`)
        .join('; ');
      lines.push(`Próximos dias: ${rest}.`);
    }

    return lines.join('\n');
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
  // 2. Integração com Google Agenda (Google Identity Services OAuth + Escrita)
  // --------------------------------------------------------------------------
  function saveSessionToken(token, expiresInSeconds, hasWriteScope = true) {
    const expiresAt = Date.now() + Math.max(60, (expiresInSeconds || 3500) - 60) * 1000;
    state.accessToken = token;
    state.tokenExpiresAt = expiresAt;
    state.hasCalendarWriteScope = Boolean(hasWriteScope);
    try {
      sessionStorage.setItem(
        STORAGE_KEYS.SESSION_TOKEN,
        JSON.stringify({ token, expiresAt, hasWriteScope: state.hasCalendarWriteScope })
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
        state.hasCalendarWriteScope = Boolean(parsed.hasWriteScope);
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
    state.hasCalendarWriteScope = false;
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
        saveSessionToken(tokenResponse.access_token, Number(tokenResponse.expires_in), true);
        state.calendarMode = 'google';
        showToast('Google Agenda conectada (leitura e criação)!', 'success', 2600);

        if (state.pendingEventToCreate) {
          const pending = state.pendingEventToCreate;
          state.pendingEventToCreate = null;
          const res = await createCalendarEvent(pending);
          if (res.ok) {
            showToast(`Evento "${pending.title}" criado na Google Agenda!`, 'success', 3500);
          }
        }

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

  function connectGoogleCalendar(forceConsent = false) {
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
      const prompt = forceConsent || !state.accessToken || !state.hasCalendarWriteScope ? 'consent' : '';
      client.requestAccessToken({ prompt });
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

  function getLocalDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDayHeading(date) {
    const todayKey = getLocalDateKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = getLocalDateKey(tomorrow);
    const key = getLocalDateKey(date);

    const formatted = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
      .format(date)
      .replace(/\./g, '');
    const cap = formatted.charAt(0).toUpperCase() + formatted.slice(1);

    if (key === todayKey) return `Hoje · ${cap}`;
    if (key === tomorrowKey) return `Amanhã · ${cap}`;
    return cap;
  }

  function syncTodayFromWeekEvents() {
    const now = new Date();
    const todayKey = getLocalDateKey(now);
    state.todayEvents = state.weekEvents.filter((evt) => {
      const startKey = getLocalDateKey(evt.startDate);
      if (evt.isAllDay) return startKey === todayKey;
      return startKey === todayKey && evt.endDate >= now;
    });
  }

  async function fetchTodayEvents() {
    if (state.calendarMode === 'demo') {
      if (!state.weekEvents.length) {
        loadDemoEvents(true);
      } else {
        syncTodayFromWeekEvents();
        renderEventsList();
        if (!el.agendaExpandedModal.classList.contains('hidden')) {
          renderAgendaExpandedModal();
        }
      }
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
    if (state.weekEvents.length === 0) {
      setAgendaView('loading');
    }

    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfWeek = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 6,
        23,
        59,
        59,
        999
      );

      const params = new URLSearchParams({
        timeMin: startOfToday.toISOString(),
        timeMax: endOfWeek.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
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
      state.weekEvents = (data.items || [])
        .map(normalizeCalendarEvent)
        .filter((evt) => evt.isAllDay || evt.endDate >= now)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      syncTodayFromWeekEvents();
      renderEventsList();
      if (!el.agendaExpandedModal.classList.contains('hidden')) {
        renderAgendaExpandedModal();
      }

      const timeStr = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());
      el.agendaSyncMeta.textContent = `Google Agenda • Atualizado às ${timeStr}`;
    } catch (err) {
      console.error('Erro ao buscar eventos:', err);
      showToast(`Erro na Google Agenda: ${err.message}`, 'error', 4500);
      if (state.weekEvents.length === 0) {
        setAgendaView('connect');
      }
    } finally {
      el.refreshCalendarBtn.classList.remove('spinning');
    }
  }

  function parseLocalDateTimeInput(val) {
    if (!val) return null;
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return parseLocalAllDayDate(str);
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async function createCalendarEvent(evtSpec) {
    const title = String(evtSpec?.title || evtSpec?.summary || '').trim();
    if (!title) return { ok: false, reason: 'invalid', message: 'Título do evento ausente.' };

    const isAllDay = Boolean(evtSpec?.allDay);
    const startDate = parseLocalDateTimeInput(evtSpec?.start);
    if (!startDate) return { ok: false, reason: 'invalid', message: 'Data ou horário do evento inválido.' };

    let endDate = parseLocalDateTimeInput(evtSpec?.end);
    if (!endDate || endDate <= startDate) {
      endDate = new Date(startDate.getTime() + (isAllDay ? 86400000 : 60 * 60000));
    }

    const location = String(evtSpec?.location || '').trim();
    const description = String(evtSpec?.description || '').trim();

    if (state.calendarMode === 'demo') {
      const demoEvent = {
        id: `demo-custom-${Date.now()}`,
        title,
        isAllDay,
        startDate,
        endDate,
        location,
        description,
      };
      state.weekEvents.push(demoEvent);
      state.weekEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      syncTodayFromWeekEvents();
      renderEventsList();
      if (!el.agendaExpandedModal.classList.contains('hidden')) {
        renderAgendaExpandedModal();
      }
      return { ok: true, mode: 'demo', event: demoEvent };
    }

    if (state.calendarMode !== 'google' || !state.accessToken || Date.now() >= state.tokenExpiresAt) {
      return { ok: false, reason: 'disconnected', message: 'Conecte sua Google Agenda primeiro.' };
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
    const body = {
      summary: title,
      location: location || undefined,
      description: description || undefined,
      start: isAllDay
        ? { date: getLocalDateKey(startDate) }
        : { dateTime: startDate.toISOString(), timeZone },
      end: isAllDay
        ? { date: getLocalDateKey(endDate) }
        : { dateTime: endDate.toISOString(), timeZone },
    };

    try {
      const response = await fetch(CALENDAR_EVENTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 401 || response.status === 403) {
        state.pendingEventToCreate = { title, start: startDate, end: endDate, location, description, allDay: isAllDay };
        showToast('Autorize a permissão para criar eventos na Google Agenda.', 'info', 4500);
        connectGoogleCalendar(true);
        return { ok: false, reason: 'needs_auth', message: 'Requer permissão de escrita na Google Agenda.' };
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Erro HTTP ${response.status}`);
      }

      const created = await response.json();
      await fetchTodayEvents();
      return { ok: true, mode: 'google', event: normalizeCalendarEvent(created) };
    } catch (err) {
      console.error('Erro ao criar evento na Google Agenda:', err);
      return { ok: false, reason: 'error', message: err.message };
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

  function renderEventItemHtml(evt, now) {
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
  }

  function updateSegmentedControlUI(container, activeRange) {
    if (!container) return;
    container.querySelectorAll('.seg-btn').forEach((btn) => {
      const isActive = btn.dataset.range === activeRange;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
  }

  function setWidgetAgendaRange(range) {
    state.agendaRange = range === 'week' ? 'week' : 'day';
    updateSegmentedControlUI(el.agendaRangeSwitch, state.agendaRange);
    if (el.agendaCardTitle) {
      el.agendaCardTitle.textContent = state.agendaRange === 'week' ? 'Agenda da Semana' : 'Agenda de Hoje';
    }
    if (el.agendaHeaderSub) {
      el.agendaHeaderSub.textContent =
        state.agendaRange === 'week' ? 'Hoje e próximos 7 dias · toque para expandir' : 'Hoje · toque para expandir';
    }
    if (state.calendarMode !== 'disconnected') {
      renderEventsList();
    }
  }

  function renderEventsList() {
    const now = new Date();
    const isWeek = state.agendaRange === 'week';
    const events = isWeek ? state.weekEvents : state.todayEvents;
    el.eventCountBadge.textContent = String(events.length);

    const nextEvt = state.todayEvents[0] || state.weekEvents[0];
    if (nextEvt) {
      const isNextToday = getLocalDateKey(nextEvt.startDate) === getLocalDateKey(now);
      const when = nextEvt.isAllDay
        ? isNextToday
          ? 'hoje'
          : formatDayHeading(nextEvt.startDate)
        : isNextToday
          ? `às ${formatTimeShort(nextEvt.startDate)}`
          : `${formatDayHeading(nextEvt.startDate).split(' · ')[0]} às ${formatTimeShort(nextEvt.startDate)}`;
      el.nextEventChipText.textContent = `Próximo: ${nextEvt.title} (${when})`;
      el.nextEventChip.classList.remove('hidden');
    } else {
      el.nextEventChip.classList.add('hidden');
    }

    if (!events.length) {
      setAgendaView('empty');
      return;
    }

    setAgendaView('list');

    // Lista estruturada estilo calendário (dia da semana, data, horários de início/fim e título)
    const todayKey = getLocalDateKey(now);
    const grouped = new Map();
    for (const evt of events) {
      const dayKey = getLocalDateKey(evt.startDate);
      if (!grouped.has(dayKey)) {
        grouped.set(dayKey, { date: evt.startDate, items: [] });
      }
      grouped.get(dayKey).items.push(evt);
    }

    const chunks = [];
    for (const [dayKey, group] of grouped.entries()) {
      const isTodayGroup = dayKey === todayKey;
      const countLabel = `${group.items.length} ${group.items.length === 1 ? 'evento' : 'eventos'}`;
      chunks.push(`
        <li class="calendar-day-header ${isTodayGroup ? 'is-today' : ''}">
          <span class="calendar-day-header-left">${escapeHtml(formatDayHeading(group.date))}</span>
          <span class="calendar-day-badge">${countLabel}</span>
        </li>
      `);
      for (const evt of group.items) {
        chunks.push(renderEventItemHtml(evt, now));
      }
    }
    el.eventsList.innerHTML = chunks.join('');
  }

  function renderAgendaExpandedModal() {
    const now = new Date();
    const isWeek = state.modalAgendaRange === 'week';
    updateSegmentedControlUI(el.modalAgendaRangeSwitch, state.modalAgendaRange);
    el.agendaModalTitle.textContent = isWeek ? 'Agenda da Semana' : 'Agenda de Hoje';

    if (state.calendarMode === 'disconnected') {
      el.agendaModalSubtitle.textContent = 'Conecte sua Google Agenda ou carregue a demonstração';
      el.agendaExpandedContent.innerHTML = `
        <div class="agenda-connect-state" style="padding: 28px 12px;">
          <p class="empty-title">Google Agenda não conectada</p>
          <p class="empty-subtitle">Conecte sua conta Google para ver toda a sua semana e criar eventos por voz com o Gemini.</p>
          <button type="button" class="google-connect-btn" id="modalConnectCalBtn">Conectar Google Agenda</button>
          <button type="button" class="demo-link-btn" id="modalLoadDemoBtn">Visualizar semana de exemplo</button>
        </div>
      `;
      document.getElementById('modalConnectCalBtn')?.addEventListener('click', () => connectGoogleCalendar(false));
      document.getElementById('modalLoadDemoBtn')?.addEventListener('click', () => {
        loadDemoEvents(false);
        renderAgendaExpandedModal();
      });
      return;
    }

    el.agendaModalSubtitle.textContent =
      state.calendarMode === 'demo'
        ? 'Modo demonstração · peça ao Gemini para agendar ou clique em + Novo evento'
        : 'Google Agenda · peça ao Gemini para agendar ou clique em + Novo evento';

    if (!isWeek) {
      if (!state.todayEvents.length) {
        el.agendaExpandedContent.innerHTML = '<p class="empty-subtitle" style="text-align:center;padding:24px;">Nenhum compromisso restante para hoje.</p>';
        return;
      }
      el.agendaExpandedContent.innerHTML = `<ul class="events-list">${state.todayEvents.map((e) => renderEventItemHtml(e, now)).join('')}</ul>`;
      return;
    }

    const daysHtml = [];
    for (let offset = 0; offset < 7; offset++) {
      const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const dayKey = getLocalDateKey(dayDate);
      const dayEvents = state.weekEvents.filter((e) => getLocalDateKey(e.startDate) === dayKey);
      const isToday = offset === 0;

      daysHtml.push(`
        <div class="week-day-card ${isToday ? 'is-today' : ''}">
          <div class="week-day-head">
            <span class="week-day-name">${escapeHtml(formatDayHeading(dayDate))}</span>
            <span class="week-day-count">${dayEvents.length} ${dayEvents.length === 1 ? 'evento' : 'eventos'}</span>
          </div>
          ${
            dayEvents.length
              ? `<ul class="events-list">${dayEvents.map((e) => renderEventItemHtml(e, now)).join('')}</ul>`
              : '<p class="week-day-empty">Dia livre</p>'
          }
        </div>
      `);
    }

    el.agendaExpandedContent.innerHTML = `<div class="week-days-grid">${daysHtml.join('')}</div>`;
  }

  function openAgendaExpandedModal(initialRange = 'week') {
    state.modalAgendaRange = initialRange;
    el.newEventForm.classList.add('hidden');
    const now = new Date();
    el.newEventDate.value = getLocalDateKey(now);
    const nextHour = (now.getHours() + 1) % 24;
    const endHour = (nextHour + 1) % 24;
    el.newEventStart.value = `${String(nextHour).padStart(2, '0')}:00`;
    el.newEventEnd.value = `${String(endHour).padStart(2, '0')}:00`;

    renderAgendaExpandedModal();
    el.agendaExpandedModal.classList.remove('hidden');
  }

  function closeAgendaExpandedModal() {
    el.agendaExpandedModal.classList.add('hidden');
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
    state.weekEvents = [];
    el.nextEventChip.classList.add('hidden');
    setAgendaView('connect');
    if (!el.agendaExpandedModal.classList.contains('hidden')) {
      renderAgendaExpandedModal();
    }
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

    const mkDay = (dayOffset, hour, min, durationMin, title, location) => {
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, min, 0, 0);
      const endDate = new Date(startDate.getTime() + durationMin * 60000);
      return {
        id: `demo-d${dayOffset}-${hour}${min}`,
        title,
        isAllDay: false,
        startDate,
        endDate,
        location,
        description: '',
      };
    };

    state.calendarMode = 'demo';
    state.weekEvents = [
      mk(-10, 40, 'Daily de Produto & Design', 'Google Meet'),
      mk(45, 60, 'Revisão de Arquitetura PWA', 'Sala Vidro 2'),
      mk(135, 45, 'Almoço com Mariana', 'Bistrô Paulista'),
      mk(220, 60, 'Call de Alinhamento com Cliente', 'Zoom'),
      mkDay(1, 9, 30, 60, 'Planejamento da Sprint', 'Google Meet'),
      mkDay(1, 15, 0, 45, 'Dentista', 'Clínica Jardins'),
      mkDay(2, 11, 0, 60, 'Apresentação de Resultados', 'Auditório'),
      mkDay(3, 18, 30, 60, 'Treino / Academia', 'Smart Fit'),
      mkDay(4, 14, 0, 90, 'Workshop de Design iOS', 'Online'),
      mkDay(5, 12, 30, 90, 'Almoço em Família', 'Restaurante'),
    ].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    syncTodayFromWeekEvents();
    renderEventsList();
    el.agendaSyncMeta.textContent = 'Modo demonstração • Eventos da semana';
    if (!silent) {
      showToast('Agenda da semana de exemplo carregada!', 'success', 2600);
    }
  }

  function buildCalendarContextForGemini() {
    const now = new Date();
    const weekRefLines = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const wk = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(d);
      weekRefLines.push(`- ${getLocalDateKey(d)} (${wk}${i === 0 ? ' — HOJE' : i === 1 ? ' — AMANHÃ' : ''})`);
    }
    const calendarRef = `Calendário de referência (próximos 7 dias):\n${weekRefLines.join('\n')}`;

    if (state.calendarMode === 'disconnected') {
      return `${calendarRef}\n\nA Google Agenda ainda não está conectada pelo usuário.`;
    }
    if (!state.weekEvents.length) {
      return `${calendarRef}\n\nA agenda está conectada, mas não há eventos agendados para os próximos 7 dias.`;
    }
    const header =
      state.calendarMode === 'demo'
        ? 'Eventos dos próximos 7 dias (modo demonstração):'
        : 'Eventos dos próximos 7 dias na Google Agenda do usuário:';
    const lines = state.weekEvents.slice(0, 25).map((evt, idx) => {
      const dateTag = `${getLocalDateKey(evt.startDate)} (${formatDayHeading(evt.startDate)})`;
      const timeRange = evt.isAllDay
        ? 'Dia todo'
        : `${formatTimeShort(evt.startDate)} às ${formatTimeShort(evt.endDate)}`;
      const loc = evt.location ? ` | Local: ${evt.location}` : '';
      return `${idx + 1}. [${dateTag}] ${timeRange} — ${evt.title}${loc}`;
    });
    return `${calendarRef}\n\n${header}\n${lines.join('\n')}`;
  }

  // --------------------------------------------------------------------------
  // 3. Assistente de Voz: SpeechRecognition + Gemini + SpeechSynthesis
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
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*[-•*+]\s+/gm, '')
      .replace(/[*_`#~>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitIntoSpeechChunks(text, maxLen = 180) {
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

  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function parseSampleRateFromMime(mimeType, fallback = 24000) {
    const match = String(mimeType || '').match(/rate=(\d+)/i);
    const parsed = match ? Number(match[1]) : fallback;
    return Number.isFinite(parsed) && parsed >= 8000 && parsed <= 96000 ? parsed : fallback;
  }

  function buildWavBlobFromPcm16(pcmBytes, sampleRate = 24000, channels = 1) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    const byteRate = sampleRate * channels * 2;
    const blockAlign = channels * 2;
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.byteLength, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, pcmBytes.byteLength, true);
    return new Blob([header, pcmBytes], { type: 'audio/wav' });
  }

  function extractInlineAudio(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        const mimeType = inline.mimeType || inline.mime_type || 'audio/L16;codec=pcm;rate=24000';
        return {
          bytes: base64ToUint8Array(inline.data),
          mimeType,
          sampleRate: parseSampleRateFromMime(mimeType, 24000),
        };
      }
    }
    return null;
  }

  function cleanupActiveAudio() {
    if (state.ttsAbortController) {
      state.ttsAbortController.abort();
      state.ttsAbortController = null;
    }
    if (state.activeAudioSource) {
      try {
        state.activeAudioSource.onended = null;
        state.activeAudioSource.stop();
        state.activeAudioSource.disconnect();
      } catch {
        // Ignora
      }
      state.activeAudioSource = null;
    }
    if (state.activeHtmlAudio) {
      try {
        state.activeHtmlAudio.onended = null;
        state.activeHtmlAudio.onerror = null;
        state.activeHtmlAudio.pause();
        state.activeHtmlAudio.src = '';
      } catch {
        // Ignora
      }
      state.activeHtmlAudio = null;
    }
    if (state.activeAudioUrl) {
      try {
        URL.revokeObjectURL(state.activeAudioUrl);
      } catch {
        // Ignora
      }
      state.activeAudioUrl = null;
    }
  }

  function stopSpeaking(keepConversation = false, customStatus) {
    state.speechQueueId += 1;
    cancelAutoListenTimer();
    if (state.speechStartTimer) {
      clearTimeout(state.speechStartTimer);
      state.speechStartTimer = null;
    }
    state.activeUtterance = null;
    if (!keepConversation) {
      state.conversationActive = false;
    }
    cleanupActiveAudio();
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignora
      }
    }
    if (state.assistantState === 'speaking' || customStatus !== undefined) {
      setAssistantState('idle', customStatus !== undefined ? customStatus : 'Pronto para ouvir');
    }
  }

  function handleSpeechFinished(queueId) {
    if (queueId !== state.speechQueueId) return;
    state.activeUtterance = null;
    setAssistantState('idle', 'Pronto para ouvir');

    // Conversa contínua: SÓ reabre automaticamente se a chave "Conversa Contínua" estiver ATIVADA
    if (state.continuousMode && state.conversationActive && !isAnyModalOpen()) {
      cancelAutoListenTimer();
      state.autoListenTimer = setTimeout(() => {
        if (
          state.assistantState !== 'idle' ||
          !state.continuousMode ||
          !state.conversationActive ||
          isAnyModalOpen()
        ) {
          state.autoListenTimer = null;
          return;
        }
        playChime('turn');
        state.autoListenTimer = setTimeout(() => {
          state.autoListenTimer = null;
          if (
            state.assistantState === 'idle' &&
            state.continuousMode &&
            state.conversationActive &&
            !isAnyModalOpen()
          ) {
            startVoiceRecognition(true, 0);
          }
        }, 240);
      }, 320);
    } else {
      state.conversationActive = false;
    }
  }

  async function requestGeminiTtsAudio(cleanText, voiceName, signal) {
    if (
      state.lastTtsCache &&
      state.lastTtsCache.text === cleanText &&
      state.lastTtsCache.voiceName === voiceName
    ) {
      return state.lastTtsCache.audio;
    }

    const apiKey = getGeminiKey();
    const useServerProxy = !apiKey && state.serverGeminiConfigured;
    if (!apiKey && !useServerProxy) return null;

    if (useServerProxy) {
      const response = await fetchWithTimeout(
        './api/gemini',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'tts',
            text: cleanText,
            voiceName,
          }),
        },
        GEMINI_TTS_TIMEOUT_MS,
        signal
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return null;
      const audio = extractInlineAudio(data);
      if (audio) {
        state.lastTtsCache = { text: cleanText, voiceName, audio };
      }
      return audio;
    }

    const callTtsModel = async (model, useLegacyPrebuilt) => {
      const voiceConfig = useLegacyPrebuilt
        ? { prebuiltVoiceConfig: { voiceName } }
        : { voice: voiceName };
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: cleanText }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig },
        },
      };
      const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        GEMINI_TTS_TIMEOUT_MS,
        signal
      );
      const data = await response.json().catch(() => ({}));
      return { response, data };
    };

    for (const ttsModel of GEMINI_TTS_MODELS) {
      try {
        let { response, data } = await callTtsModel(ttsModel, true);
        if (
          !response.ok &&
          response.status === 400 &&
          /prebuiltVoiceConfig|voiceConfig/i.test(data?.error?.message || '')
        ) {
          ({ response, data } = await callTtsModel(ttsModel, false));
        }
        if (response.ok) {
          const audio = extractInlineAudio(data);
          if (audio) {
            state.lastTtsCache = { text: cleanText, voiceName, audio };
            return audio;
          }
        }
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn(`Falha TTS no modelo ${ttsModel}:`, err?.message || err);
      }
    }
    return null;
  }

  async function playGeminiAudioPayload(audio, queueId) {
    if (queueId !== state.speechQueueId) return true;
    const rate = Math.min(1.4, Math.max(0.8, Number(state.prefs.speechRate) || 1.0));
    const isRawPcm = /pcm|audio\/l16/i.test(audio.mimeType || '');

    // Tenta reproduzir via AudioContext (melhor compatibilidade no iOS Safari após unlock)
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!state.audioCtx) {
          state.audioCtx = new AudioCtx();
        }
        if (state.audioCtx.state === 'suspended') {
          await state.audioCtx.resume();
        }
        if (state.audioCtx.state === 'running' && queueId === state.speechQueueId) {
          let audioBuffer;
          if (isRawPcm) {
            const sampleCount = Math.floor(audio.bytes.byteLength / 2);
            audioBuffer = state.audioCtx.createBuffer(1, sampleCount, audio.sampleRate || 24000);
            const channel = audioBuffer.getChannelData(0);
            const view = new DataView(audio.bytes.buffer, audio.bytes.byteOffset, sampleCount * 2);
            for (let i = 0; i < sampleCount; i++) {
              channel[i] = view.getInt16(i * 2, true) / 32768;
            }
          } else {
            const copy = audio.bytes.slice().buffer;
            audioBuffer = await state.audioCtx.decodeAudioData(copy);
          }

          if (queueId !== state.speechQueueId) return true;

          const source = state.audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = rate;
          source.connect(state.audioCtx.destination);
          state.activeAudioSource = source;
          setAssistantState('speaking', 'Falando...');

          source.onended = () => {
            if (state.activeAudioSource === source) {
              state.activeAudioSource = null;
            }
            handleSpeechFinished(queueId);
          };

          source.start(0);
          return true;
        }
      }
    } catch (err) {
      console.warn('Falha ao tocar áudio via AudioContext, tentando HTML Audio:', err);
    }

    // Fallback via HTMLAudioElement + WAV Blob
    try {
      if (queueId !== state.speechQueueId) return true;
      const blob = isRawPcm
        ? buildWavBlobFromPcm16(audio.bytes, audio.sampleRate || 24000, 1)
        : new Blob([audio.bytes], { type: audio.mimeType || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const htmlAudio = new Audio(url);
      htmlAudio.playbackRate = rate;
      state.activeAudioUrl = url;
      state.activeHtmlAudio = htmlAudio;
      setAssistantState('speaking', 'Falando...');

      htmlAudio.onended = () => {
        cleanupActiveAudio();
        handleSpeechFinished(queueId);
      };
      htmlAudio.onerror = () => {
        cleanupActiveAudio();
        if (queueId === state.speechQueueId) {
          setAssistantState('idle', 'Pronto para ouvir');
        }
      };

      await htmlAudio.play();
      return true;
    } catch (err) {
      cleanupActiveAudio();
      console.warn('Falha ao tocar áudio via HTMLAudioElement:', err);
      return false;
    }
  }

  function speakWithBrowserSynthesis(cleanText, queueId) {
    if (!('speechSynthesis' in window)) {
      handleSpeechFinished(queueId);
      return;
    }

    const chunks = splitIntoSpeechChunks(cleanText, 180);
    if (!chunks.length) {
      handleSpeechFinished(queueId);
      return;
    }

    const synth = window.speechSynthesis;
    const wasBusy = synth.speaking || synth.pending;
    try {
      synth.cancel();
    } catch {
      // Ignora
    }

    const rate = Math.min(1.4, Math.max(0.8, Number(state.prefs.speechRate) || 1.0));
    setAssistantState('speaking', 'Falando...');

    const speakNext = (index) => {
      if (queueId !== state.speechQueueId) return;
      if (index >= chunks.length) {
        handleSpeechFinished(queueId);
        return;
      }

      const voice = pickBestPortugueseVoice();
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = 'pt-BR';
      if (voice) {
        utterance.voice = voice;
        if (voice.lang) utterance.lang = voice.lang;
      }
      utterance.rate = rate;
      utterance.pitch = 1.0;

      // Mantém referência forte para evitar bug de GC no Chrome
      state.activeUtterance = utterance;

      utterance.onend = () => {
        if (state.activeUtterance === utterance) {
          state.activeUtterance = null;
        }
        speakNext(index + 1);
      };

      utterance.onerror = (evt) => {
        if (state.activeUtterance === utterance) {
          state.activeUtterance = null;
        }
        if (evt.error !== 'interrupted' && evt.error !== 'canceled') {
          console.warn('Erro SpeechSynthesis:', evt.error);
          if (evt.error === 'not-allowed') {
            showToast('Toque em "Ativar áudio" ou no botão de ouvir para liberar a fala neste navegador.', 'info', 4000);
          }
        }
        if (queueId === state.speechQueueId) {
          setAssistantState('idle', 'Pronto para ouvir');
        }
      };

      try {
        if (synth.paused) {
          synth.resume();
        }
        synth.speak(utterance);
      } catch (err) {
        console.warn('Falha ao chamar speechSynthesis.speak:', err);
        if (queueId === state.speechQueueId) {
          setAssistantState('idle', 'Pronto para ouvir');
        }
      }
    };

    // Pequeno atraso após cancel() evita bug conhecido do Chrome/Safari que cancela a nova fala
    if (state.speechStartTimer) {
      clearTimeout(state.speechStartTimer);
      state.speechStartTimer = null;
    }
    state.speechStartTimer = setTimeout(() => {
      state.speechStartTimer = null;
      speakNext(0);
    }, wasBusy ? 75 : 35);
  }

  async function speakText(text) {
    const cleanText = sanitizeTextForSpeech(text);
    if (!cleanText) {
      setAssistantState('idle', 'Pronto para ouvir');
      return;
    }

    cleanupActiveAudio();
    if (state.speechStartTimer) {
      clearTimeout(state.speechStartTimer);
      state.speechStartTimer = null;
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignora
      }
    }

    const queueId = ++state.speechQueueId;
    const wantGeminiVoice = (state.prefs.voiceEngine || 'gemini') === 'gemini' && hasGeminiAccess();

    if (wantGeminiVoice) {
      const ttsController = new AbortController();
      state.ttsAbortController = ttsController;
      setAssistantState('speaking', 'Preparando voz...');

      try {
        const voiceName = state.prefs.geminiVoiceName || 'Aoede';
        const audio = await requestGeminiTtsAudio(cleanText, voiceName, ttsController.signal);
        if (state.ttsAbortController === ttsController) {
          state.ttsAbortController = null;
        }
        if (queueId !== state.speechQueueId) return;

        if (audio) {
          const played = await playGeminiAudioPayload(audio, queueId);
          if (played) return;
        }
      } catch (err) {
        if (state.ttsAbortController === ttsController) {
          state.ttsAbortController = null;
        }
        if (queueId !== state.speechQueueId) return;
        console.warn('Gemini TTS indisponível, usando voz local pt-BR:', err?.message || err);
      }
    }

    if (queueId !== state.speechQueueId) return;
    speakWithBrowserSynthesis(cleanText, queueId);
  }

  function startVoiceRecognition(isAutoFollowUp = false, retryCount = 0) {
    const autoFollowUp = isAutoFollowUp === true;
    cancelAutoListenTimer();

    // Se já estiver ouvindo, encerra imediatamente sem travar o estado
    if (state.assistantState === 'listening') {
      if (typeof state.forceStopListening === 'function') {
        state.forceStopListening();
      } else if (state.recognition) {
        try {
          state.recognition.stop();
        } catch {
          setAssistantState('idle', 'Pronto para ouvir');
        }
      } else {
        setAssistantState('idle', 'Pronto para ouvir');
      }
      return;
    }

    // Se estiver consultando o Gemini, cancela a requisição
    if (state.assistantState === 'thinking' && state.currentAbortController) {
      state.conversationActive = false;
      state.currentAbortController._userCancelled = true;
      state.currentAbortController.abort();
      state.currentAbortController = null;
      setAssistantState('idle', 'Consulta cancelada.');
      showToast('Consulta cancelada.', 'info', 2000);
      return;
    }

    // Se estiver falando e o usuário tocar no microfone, interrompe a fala e já começa a ouvir
    if (state.assistantState === 'speaking') {
      stopSpeaking(true);
    }

    if (!hasGeminiAccess()) {
      setAssistantState('idle', 'Configure sua GEMINI_API_KEY nos Ajustes.', true);
      showToast('Configure sua GEMINI_API_KEY antes de usar o assistente.', 'error', 4000);
      openSettingsModal('geminiKeyInput');
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      const unsupportedMsg = 'Reconhecimento de voz não suportado neste navegador. Use o campo de texto.';
      setAssistantState('idle', unsupportedMsg, true);
      showToast(unsupportedMsg, 'error', 4500);
      el.textInput?.focus();
      return;
    }

    // Conversa contínua SÓ fica ativa se a chave estiver ligada
    if (!autoFollowUp) {
      state.conversationActive = Boolean(state.continuousMode);
    }

    // Para síntese ativa e garante AudioContext sem travar SpeechRecognition no iOS
    stopSpeaking(state.conversationActive);
    unlockAudioOnFirstGesture({ primeSpeech: false });

    // Limpa qualquer instância anterior presa
    if (state.recognition) {
      try {
        state.recognition.onstart = null;
        state.recognition.onresult = null;
        state.recognition.onnomatch = null;
        state.recognition.onerror = null;
        state.recognition.onend = null;
        state.recognition.abort();
      } catch {
        // Ignora
      }
      state.recognition = null;
    }

    // Configuração exata por turno para máxima confiabilidade em pt-BR (inclusive frases curtas como "Bom dia")
    const recognition = new SpeechRec();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    state.recognition = recognition;
    state.finalTranscript = '';

    const NO_SPEECH_TIMEOUT_MS = autoFollowUp ? 5500 : 9000;
    const STOP_FALLBACK_MS = 850;
    let capturedTranscript = '';
    let noSpeechTimer = null;
    let stopFallbackTimer = null;
    let isFinalized = false;
    let manualStop = false;
    const startedAt = Date.now();

    const clearAllTimers = () => {
      if (noSpeechTimer) { clearTimeout(noSpeechTimer); noSpeechTimer = null; }
      if (stopFallbackTimer) { clearTimeout(stopFallbackTimer); stopFallbackTimer = null; }
    };

    const detachRecognition = () => {
      try {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onnomatch = null;
        recognition.onerror = null;
        recognition.onend = null;
      } catch {
        // Ignora
      }
      if (state.recognition === recognition) {
        state.recognition = null;
      }
      state.forceStopListening = null;
    };

    const finalizeListening = (skipGemini = false, idleStatus, isError = false) => {
      if (isFinalized) return;
      isFinalized = true;
      clearAllTimers();
      detachRecognition();

      const question = (capturedTranscript || state.finalTranscript || '').trim();
      if (!skipGemini && question) {
        askGemini(question, { fromVoice: true });
      } else {
        if (autoFollowUp) {
          state.conversationActive = false;
        }
        setAssistantState(
          'idle',
          idleStatus !== undefined ? idleStatus : 'Pronto para ouvir',
          isError
        );
      }
    };

    const triggerStop = () => {
      if (isFinalized) return;
      manualStop = true;
      clearAllTimers();
      try {
        recognition.stop();
      } catch {
        finalizeListening(false);
        return;
      }
      stopFallbackTimer = setTimeout(() => {
        try { recognition.abort(); } catch { /* ignora */ }
        finalizeListening(false);
      }, STOP_FALLBACK_MS);
    };

    state.forceStopListening = triggerStop;

    recognition.onstart = () => {
      if (isFinalized) return;
      setAssistantState('listening', autoFollowUp ? 'Sua vez — pode falar...' : 'Ouvindo... fale agora');

      // Se o usuário não falar nada dentro do tempo limite, corta o microfone automaticamente
      noSpeechTimer = setTimeout(() => {
        if (!capturedTranscript.trim() && !isFinalized) {
          if (autoFollowUp) {
            state.conversationActive = false;
          }
          try {
            recognition.abort();
          } catch {
            // Ignora
          }
          finalizeListening(
            true,
            autoFollowUp
              ? 'Silêncio detectado — microfone desligado.'
              : 'Nenhuma fala detectada. Toque no microfone para tentar novamente.',
            false
          );
        }
      }, NO_SPEECH_TIMEOUT_MS);
    };

    recognition.onresult = (event) => {
      if (isFinalized) return;
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        const piece = event.results[i]?.[0]?.transcript || '';
        transcript += (transcript ? ' ' : '') + piece.trim();
      }
      transcript = transcript.trim();
      if (!transcript) return;

      capturedTranscript = transcript;
      state.finalTranscript = transcript;
      clearAllTimers();

      // Envia imediatamente para o Gemini junto com agenda real (hoje/semana) e clima atual
      try {
        recognition.stop();
      } catch {
        // Ignora
      }
      finalizeListening(false);
    };

    recognition.onnomatch = () => {
      if (isFinalized) return;
      state.conversationActive = false;
      finalizeListening(
        true,
        'Não consegui entender. Toque no microfone para falar novamente.',
        true
      );
    };

    recognition.onerror = (event) => {
      if (isFinalized) return;
      const errCode = event?.error || 'unknown';
      console.warn('SpeechRecognition error:', errCode);

      if (capturedTranscript.trim() && (errCode === 'no-speech' || errCode === 'aborted')) {
        finalizeListening(false);
        return;
      }

      // Em modo contínuo, se o navegador abortar logo após o áudio da IA terminar, tenta 1 vez
      if (
        autoFollowUp &&
        state.continuousMode &&
        retryCount < 1 &&
        Date.now() - startedAt < 900 &&
        (errCode === 'aborted' || errCode === 'audio-capture')
      ) {
        isFinalized = true;
        clearAllTimers();
        detachRecognition();
        setAssistantState('idle', 'Preparando microfone...');
        state.autoListenTimer = setTimeout(() => {
          state.autoListenTimer = null;
          if (state.continuousMode && state.conversationActive && !isAnyModalOpen()) {
            startVoiceRecognition(true, retryCount + 1);
          }
        }, 380);
        return;
      }

      if (autoFollowUp && (errCode === 'no-speech' || errCode === 'aborted')) {
        state.conversationActive = false;
        finalizeListening(true, 'Silêncio detectado — microfone desligado.', false);
        return;
      }

      if (manualStop && errCode === 'aborted') {
        finalizeListening(true, 'Microfone pausado.', false);
        return;
      }

      const errorMessages = {
        'not-allowed': 'Permissão de microfone negada. Libere o acesso no navegador e toque para tentar novamente.',
        'service-not-allowed': 'Reconhecimento de voz bloqueado neste dispositivo. Verifique as permissões.',
        'no-speech': 'Nenhuma fala detectada. Toque no microfone e fale mais perto.',
        'audio-capture': 'Microfone não encontrado ou ocupado por outro aplicativo.',
        network: 'Erro de rede no reconhecimento de voz. Verifique a conexão e tente novamente.',
      };

      const msg =
        errorMessages[errCode] ||
        (errCode !== 'aborted'
          ? `Erro no microfone (${errCode}). Toque para tentar novamente.`
          : 'Pronto para ouvir');

      const isRealError = errCode !== 'aborted';
      if (isRealError) {
        showToast(msg, 'error', 4200);
      }
      state.conversationActive = false;
      finalizeListening(true, msg, isRealError);
    };

    recognition.onend = () => {
      if (!isFinalized) {
        finalizeListening(false);
      }
    };

    try {
      setAssistantState('listening', 'Iniciando microfone...');
      recognition.start();
    } catch (err) {
      console.error('Erro ao iniciar SpeechRecognition:', err);
      clearAllTimers();
      detachRecognition();
      if (autoFollowUp && state.continuousMode && retryCount < 1) {
        setAssistantState('idle', 'Preparando microfone...');
        state.autoListenTimer = setTimeout(() => {
          state.autoListenTimer = null;
          if (state.continuousMode && state.conversationActive && !isAnyModalOpen()) {
            startVoiceRecognition(true, retryCount + 1);
          }
        }, 350);
        return;
      }
      state.conversationActive = false;
      const failMsg = 'Não foi possível iniciar o microfone. Toque novamente para tentar.';
      if (!autoFollowUp) {
        showToast(failMsg, 'error', 3800);
      }
      setAssistantState('idle', failMsg, !autoFollowUp);
    }
  }

  function getThinkingConfigForModel(model) {
    if (model === 'gemini-3.5-flash-lite') {
      return { thinkingLevel: 'minimal' };
    }
    if (model === 'gemini-3.8-flash' || model === 'gemini-4-hydrogen') {
      return { thinkingLevel: 'low' };
    }
    return null;
  }

  function extractGeminiReply(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const visibleParts = parts.filter((p) => !p.thought && typeof p.text === 'string' && p.text.trim());
    const sourceParts = visibleParts.length ? visibleParts : parts;
    return sourceParts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join(' ')
      .trim();
  }

  function isRetryableGeminiError(status, message, isTimeout = false) {
    if (isTimeout) return true;
    if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
    const lower = String(message || '').toLowerCase();
    return (
      lower.includes('no longer available') ||
      lower.includes('not found') ||
      lower.includes('deprecated') ||
      lower.includes('not supported') ||
      lower.includes('overloaded') ||
      lower.includes('high demand') ||
      lower.includes('unavailable') ||
      lower.includes('rate limit') ||
      lower.includes('quota')
    );
  }

  async function fetchWithTimeout(url, options, timeoutMs, parentSignal) {
    const attemptController = new AbortController();
    let timedOut = false;

    const onParentAbort = () => attemptController.abort();
    if (parentSignal) {
      if (parentSignal.aborted) {
        attemptController.abort();
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, timeoutMs);

    try {
      return await fetch(url, { ...options, signal: attemptController.signal });
    } catch (err) {
      if (timedOut) {
        const timeoutErr = new Error('Tempo limite excedido ao aguardar resposta do Gemini.');
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  function parseCreateEventActions(rawText) {
    const actions = [];
    const cleaned = String(rawText || '').replace(
      /\[CREATE_EVENT\]([\s\S]*?)\[\/CREATE_EVENT\]/gi,
      (_, jsonStr) => {
        try {
          const parsed = JSON.parse(jsonStr.trim());
          if (parsed && (parsed.title || parsed.summary) && parsed.start) {
            actions.push(parsed);
          }
        } catch (err) {
          console.warn('Falha ao interpretar CREATE_EVENT:', err);
        }
        return '';
      }
    );
    return { cleanedText: cleaned.trim(), actions };
  }

  async function triggerMorningBriefing() {
    unlockAudioOnFirstGesture({ primeSpeech: true });
    if (!hasGeminiAccess()) {
      setAssistantState('idle', 'Configure sua GEMINI_API_KEY nos Ajustes.', true);
      showToast('Configure sua GEMINI_API_KEY nos Ajustes para gerar o resumo.', 'error', 4000);
      openSettingsModal('geminiKeyInput');
      return;
    }

    if (!state.weatherData) {
      setAssistantState('thinking', 'Atualizando clima...');
      await fetchWeather(true);
    }

    askGemini(BRIEFING_PROMPT, {
      fromVoice: false,
      displayQuestion: 'Resumo do dia (Bom dia)',
    });
  }

  async function askGemini(question, options = {}) {
    const fromVoice = Boolean(options.fromVoice);
    const displayQuestion = options.displayQuestion || question;
    const apiKey = getGeminiKey();
    const useServerProxy = !apiKey && state.serverGeminiConfigured;

    if (!apiKey && !useServerProxy) {
      setAssistantState('idle', 'Configure sua GEMINI_API_KEY nos Ajustes.', true);
      showToast('Configure sua GEMINI_API_KEY nos Ajustes.', 'error', 4000);
      openSettingsModal('geminiKeyInput');
      return;
    }

    // Conversa contínua só permanece ativa se a chave estiver ligada e o turno vier da voz
    state.conversationActive = Boolean(fromVoice && state.continuousMode);

    // Cancela qualquer consulta anterior que ainda esteja em andamento
    if (state.currentAbortController) {
      state.currentAbortController._superseded = true;
      state.currentAbortController.abort();
      state.currentAbortController = null;
    }

    stopSpeaking(state.conversationActive);
    setAssistantState('thinking', 'Consultando Gemini...');
    appendUiMessage('user', displayQuestion);
    const pendingMsg = appendUiMessage('assistant', 'Pensando...');

    const now = new Date();
    const formattedNow = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
    const isoNowLocal = `${getLocalDateKey(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;

    const calendarContext = buildCalendarContextForGemini();
    const weatherContext = buildWeatherContextForGemini();

    const systemPrompt = [
      'Você é o Smart Dock, um assistente pessoal inteligente por voz em português do Brasil.',
      'Suas respostas serão lidas em voz alta por síntese de fala (TTS): escreva de forma natural, clara, amigável e objetiva (1 a 3 frases curtas para perguntas rápidas, ou 4 a 6 frases fluidas quando o usuário pedir o resumo do dia ou a previsão do tempo).',
      'NÃO use formatação markdown como asteriscos, negrito, hashtags, listas com marcadores ou emojis.',
      `Data e hora atuais: ${formattedNow} (ISO local: ${isoNowLocal}).`,
      `Clima e previsão do tempo em tempo real:\n${weatherContext}`,
      `Agenda da semana do usuário:\n${calendarContext}`,
      'PREVISÃO DO TEMPO E RESUMO DO DIA: Quando o usuário perguntar sobre o tempo/clima ou pedir o resumo do dia ("o que tem hoje", "bom dia", "como está o tempo"), fale de forma natural e unificada: informe a temperatura de hoje pela manhã, tarde e noite e a possibilidade de chuva (citando o horário de maior chance se houver), e inclua sempre um resumo de amanhã dizendo se vai ser mais quente ou mais frio, a temperatura média em graus e se vai ter mais ou menos chance de chuva em relação a hoje. Se ele perguntar sobre o dia ou a agenda, inclua também os compromissos de hoje e os destaques dos próximos dias da semana.',
      'CRIAÇÃO DE EVENTOS NA AGENDA: Se o usuário pedir para criar, marcar, agendar ou adicionar um evento, reunião ou compromisso na agenda, confirme de forma natural na sua resposta falada e adicione OBRIGATORIAMENTE no final da resposta (em uma linha separada) o bloco JSON exato: [CREATE_EVENT]{"title":"Título curto","start":"YYYY-MM-DDTHH:MM:SS","end":"YYYY-MM-DDTHH:MM:SS","location":"","description":"","allDay":false}[/CREATE_EVENT]. Se o usuário não informar a duração, use 1 hora após o início. Use exatamente as datas do calendário de referência acima. Nunca mencione a tag CREATE_EVENT no texto falado.',
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
      const selectedModel = state.prefs.geminiModel || DEFAULT_GEMINI_MODEL;
      const basePayload = {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      };

      let data = {};
      let rawReply = '';
      let modelUsed = selectedModel;

      if (useServerProxy) {
        const response = await fetchWithTimeout(
          './api/gemini',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...basePayload, model: selectedModel }),
          },
          22000,
          controller.signal
        );
        data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error?.message || `Erro HTTP ${response.status}`);
        }
        modelUsed = data._modelUsed || selectedModel;
        rawReply = extractGeminiReply(data);
      } else {
        const modelsToTry = [
          selectedModel,
          ...GEMINI_FALLBACK_MODELS.filter((m) => m !== selectedModel),
        ];
        let succeeded = false;
        let lastError = 'Erro ao consultar o Gemini.';

        const callDirect = async (candidateModel, includeThinking) => {
          const thinkingConfig = includeThinking ? getThinkingConfigForModel(candidateModel) : null;
          const payload = {
            ...basePayload,
            generationConfig: {
              ...basePayload.generationConfig,
              ...(thinkingConfig ? { thinkingConfig } : {}),
            },
          };
          const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const response = await fetchWithTimeout(
            endpoint,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
            GEMINI_REQUEST_TIMEOUT_MS,
            controller.signal
          );
          const json = await response.json().catch(() => ({}));
          return { response, json };
        };

        for (let idx = 0; idx < modelsToTry.length; idx++) {
          const candidateModel = modelsToTry[idx];
          if (idx > 0 && el.assistantStatus) {
            el.assistantStatus.textContent = `Tentando modelo alternativo (${candidateModel})...`;
          }

          try {
            let { response, json } = await callDirect(candidateModel, true);

            if (
              !response.ok &&
              response.status === 400 &&
              /thinking/i.test(json?.error?.message || '')
            ) {
              ({ response, json } = await callDirect(candidateModel, false));
            }

            data = json;
            if (response.ok) {
              const extracted = extractGeminiReply(data);
              if (extracted) {
                rawReply = extracted;
                modelUsed = candidateModel;
                succeeded = true;
                break;
              }
              lastError = 'O Gemini retornou uma resposta vazia.';
              continue;
            }

            const apiMsg = data?.error?.message || `Erro HTTP ${response.status}`;
            lastError = apiMsg;
            if (!isRetryableGeminiError(response.status, apiMsg, false)) {
              break;
            }
          } catch (attemptErr) {
            if (controller._userCancelled || controller._superseded) {
              throw attemptErr;
            }
            lastError = attemptErr.message || 'Falha de rede ao consultar o Gemini.';
            if (!isRetryableGeminiError(0, lastError, Boolean(attemptErr.isTimeout))) {
              break;
            }
          }
        }

        if (!succeeded) {
          throw new Error(lastError);
        }
      }

      if (el.responseModelLabel) {
        el.responseModelLabel.textContent = modelUsed.replace(/-/g, ' ');
      }

      if (!rawReply) {
        throw new Error('O Gemini retornou uma resposta vazia.');
      }

      const { cleanedText, actions } = parseCreateEventActions(rawReply);
      let finalReplyText = cleanedText;

      if (actions.length > 0) {
        const createdTitles = [];
        let disconnectedNotice = false;
        let authNotice = false;
        let errorMsg = '';

        for (const evtAction of actions) {
          const res = await createCalendarEvent(evtAction);
          if (res.ok) {
            createdTitles.push(evtAction.title || evtAction.summary);
          } else if (res.reason === 'disconnected') {
            disconnectedNotice = true;
          } else if (res.reason === 'needs_auth') {
            authNotice = true;
          } else if (res.message) {
            errorMsg = res.message;
          }
        }

        if (createdTitles.length > 0) {
          showToast(`Evento "${createdTitles[0]}" adicionado à agenda!`, 'success', 3800);
          if (!finalReplyText) {
            finalReplyText = `Pronto, adicionei ${createdTitles[0]} na sua agenda.`;
          }
        } else if (disconnectedNotice) {
          showToast('Conecte sua Google Agenda (ou modo demonstração) para criar eventos.', 'info', 4600);
          finalReplyText = 'Para criar esse evento, conecte sua Google Agenda primeiro no widget ao lado.';
        } else if (authNotice) {
          finalReplyText = 'Autorize a permissão na janela do Google para eu concluir a criação do evento na sua agenda.';
        } else if (errorMsg) {
          showToast(`Erro ao criar evento: ${errorMsg}`, 'error', 4600);
          finalReplyText = `Não consegui salvar o evento na agenda: ${errorMsg}`;
        }
      }

      const cleanReply = sanitizeTextForSpeech(finalReplyText || rawReply);
      state.lastReply = cleanReply;
      state.chatHistory.push(
        { role: 'user', parts: [{ text: question }] },
        { role: 'model', parts: [{ text: cleanReply }] }
      );
      if (state.chatHistory.length > 10) {
        state.chatHistory = state.chatHistory.slice(-10);
      }

      updateUiMessage(pendingMsg, cleanReply, false);
      // Lê TODA resposta em voz alta automaticamente (voz, texto ou botão Resumo)
      speakText(cleanReply);
    } catch (err) {
      if (controller._superseded) return;
      if (controller._userCancelled) {
        updateUiMessage(pendingMsg, 'Consulta cancelada.', false);
        if (state.assistantState === 'thinking') {
          setAssistantState('idle', 'Pronto para ouvir');
        }
        return;
      }
      console.error('Erro Gemini API:', err);
      playChime('error');
      const friendlyErr = `Não consegui consultar o Gemini: ${err.message}`;
      updateUiMessage(pendingMsg, friendlyErr, true);
      showToast(friendlyErr, 'error', 5500);
      setAssistantState('idle', 'Erro ao consultar o Gemini.', true);
    } finally {
      if (state.currentAbortController === controller) {
        state.currentAbortController = null;
        if (state.assistantState === 'thinking') {
          setAssistantState('idle', 'Pronto para ouvir');
        }
      }
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
    if (el.geminiModelSelect) {
      el.geminiModelSelect.value = state.prefs.geminiModel || DEFAULT_GEMINI_MODEL;
    }
    if (el.voiceEngineSelect) {
      el.voiceEngineSelect.value = state.prefs.voiceEngine || 'gemini';
    }
    if (el.geminiVoiceSelect) {
      el.geminiVoiceSelect.value = state.prefs.geminiVoiceName || 'Aoede';
    }
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
      ...state.prefs,
      voiceEngine: el.voiceEngineSelect?.value || 'gemini',
      geminiVoiceName: el.geminiVoiceSelect?.value || 'Aoede',
      voiceURI: el.voiceSelect.value,
      speechRate: Number(el.speechRateInput.value) || 1.0,
      format24h: el.format24hToggle.checked,
      showSeconds: el.showSecondsToggle.checked,
      soundChimes: el.soundChimesToggle.checked,
      geminiModel: el.geminiModelSelect?.value || DEFAULT_GEMINI_MODEL,
    });
    state.lastTtsCache = null;

    updateConfigBadge();
    updateClock();
    if (state.weekEvents.length > 0 || state.todayEvents.length > 0) {
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
        if (!el.agendaExpandedModal.classList.contains('hidden')) closeAgendaExpandedModal();
        if (!el.weatherExpandedModal.classList.contains('hidden')) closeWeatherExpandedModal();
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

    // Clima (widget clicável para abrir tela grande com gráficos)
    el.weatherCityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.weatherCityForm.classList.toggle('hidden');
      if (!el.weatherCityForm.classList.contains('hidden')) {
        el.weatherCityInput.focus();
      }
    });

    el.cancelCitySearchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.weatherCityForm.classList.add('hidden');
    });

    el.weatherCityForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      searchAndSetCity(el.weatherCityInput.value);
    });

    el.weatherGpsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      detectWeatherByGPS();
    });
    el.refreshWeatherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fetchWeather(false);
    });
    el.expandWeatherBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openWeatherExpandedModal();
    });
    el.weatherWidget.addEventListener('click', (e) => {
      if (e.target.closest('button, form, input')) return;
      openWeatherExpandedModal();
    });
    el.closeWeatherModalBtn?.addEventListener('click', closeWeatherExpandedModal);
    el.modalRefreshWeatherBtn?.addEventListener('click', () => fetchWeather(false));
    el.weatherExpandedModal?.addEventListener('click', (e) => {
      if (e.target === el.weatherExpandedModal) closeWeatherExpandedModal();
    });

    // Agenda (alternador Hoje/Semana + widget clicável para abrir semana em tela grande)
    el.connectCalendarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      connectGoogleCalendar(false);
    });
    el.loadDemoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadDemoEvents(false);
    });
    el.refreshCalendarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fetchTodayEvents();
    });
    el.disconnectCalendarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      disconnectCalendar();
    });
    el.agendaRangeSwitch?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      setWidgetAgendaRange(btn.dataset.range);
    });
    el.expandAgendaBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openAgendaExpandedModal('week');
    });
    el.agendaWidget?.addEventListener('click', (e) => {
      if (e.target.closest('button, form, input, a')) return;
      openAgendaExpandedModal('week');
    });

    // Modal Expandido da Agenda
    el.closeAgendaModalBtn?.addEventListener('click', closeAgendaExpandedModal);
    el.agendaExpandedModal?.addEventListener('click', (e) => {
      if (e.target === el.agendaExpandedModal) closeAgendaExpandedModal();
    });
    el.modalAgendaRangeSwitch?.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      state.modalAgendaRange = btn.dataset.range === 'day' ? 'day' : 'week';
      renderAgendaExpandedModal();
    });
    el.toggleNewEventFormBtn?.addEventListener('click', () => {
      el.newEventForm.classList.toggle('hidden');
      if (!el.newEventForm.classList.contains('hidden')) {
        el.newEventTitle.focus();
      }
    });
    el.cancelNewEventBtn?.addEventListener('click', () => {
      el.newEventForm.classList.add('hidden');
    });
    el.newEventForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = el.newEventTitle.value.trim();
      const dateStr = el.newEventDate.value;
      const startTime = el.newEventStart.value;
      const endTime = el.newEventEnd.value;
      const location = el.newEventLocation.value.trim();
      if (!title || !dateStr || !startTime) return;

      const start = `${dateStr}T${startTime}:00`;
      const end = endTime ? `${dateStr}T${endTime}:00` : null;
      const res = await createCalendarEvent({ title, start, end, location, allDay: false });
      if (res.ok) {
        el.newEventForm.reset();
        el.newEventDate.value = dateStr;
        el.newEventStart.value = startTime;
        el.newEventEnd.value = endTime;
        el.newEventForm.classList.add('hidden');
        showToast(`Evento "${title}" criado na agenda!`, 'success', 3200);
      } else if (res.reason === 'disconnected') {
        showToast('Conecte sua Google Agenda (ou modo demonstração) primeiro.', 'error', 4000);
      } else if (res.reason !== 'needs_auth') {
        showToast(`Erro ao criar evento: ${res.message}`, 'error', 4200);
      }
    });

    // Assistente de Voz: Resumo, Microfone, Chave Conversa Contínua, Parar Fala e Texto
    el.micBtn?.addEventListener('click', () => startVoiceRecognition(false));

    el.summaryBtn?.addEventListener('click', () => {
      triggerMorningBriefing();
    });

    el.continuousModeBtn?.addEventListener('click', () => {
      unlockAudioOnFirstGesture({ primeSpeech: true });
      state.continuousMode = !state.continuousMode;
      updateContinuousModeUI();
      if (!state.continuousMode) {
        state.conversationActive = false;
        cancelAutoListenTimer();
        setAssistantState(state.assistantState, 'Conversa contínua desativada.');
      } else {
        setAssistantState(state.assistantState, 'Conversa contínua ativada.');
      }
      showToast(
        state.continuousMode
          ? 'Conversa contínua ativada (microfone reabre automaticamente após a resposta).'
          : 'Conversa contínua desativada (um turno por vez).',
        'info',
        2800
      );
    });

    el.stopVoiceBtn?.addEventListener('click', () => {
      stopSpeaking(false, 'Fala interrompida.');
    });

    el.replayVoiceBtn?.addEventListener('click', () => {
      unlockAudioOnFirstGesture({ primeSpeech: true });
      if (state.lastReply) {
        speakText(state.lastReply);
      } else {
        showToast('Nenhuma resposta anterior para ouvir.', 'info', 2000);
      }
    });

    el.clearResponseBtn?.addEventListener('click', () => {
      stopSpeaking(false, 'Pronto para ouvir');
      state.lastReply = '';
      state.chatHistory = [];
      state.uiMessages = [];
      renderChatMessages();
    });

    el.textForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      unlockAudioOnFirstGesture({ primeSpeech: true });
      const q = el.textInput.value.trim();
      if (!q) return;
      el.textInput.value = '';
      el.textInput.blur();
      askGemini(q, { fromVoice: false });
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
    // Conversa contínua começa SEMPRE desativada por padrão
    state.continuousMode = false;
    updateContinuousModeUI();
    setWidgetAgendaRange('week');
    renderChatMessages();
    setAssistantState('idle', 'Pronto para ouvir');
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
