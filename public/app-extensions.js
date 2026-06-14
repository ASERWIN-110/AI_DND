(() => {
  const GLOBAL_NAME = 'AiDndFrontendExtensions';
  const MOD_INDEX_URL = '/mods/mods.json';
  const SAME_ORIGIN_SCRIPT_PERMISSION = 'frontend:script';

  const knownEvents = Object.freeze([
    'scene:changed',
    'npc:mounted',
    'npc:speech',
    'message:rendered',
    'combat:start',
    'combat:action',
    'persuasion:start',
    'inventory:changed',
    'status:changed',
    'asset:registered',
    'asset:unregistered',
    'renderer:registered',
    'audio:unlocked',
    'audio:error',
    'audio:tts:queued',
    'mod:loaded',
    'mod:script-blocked',
    'mod:error',
    'settings-panel:registered'
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function safeCall(fn, ...args) {
    try {
      return fn(...args);
    } catch (error) {
      console.warn('[AI DND extension]', error);
      return undefined;
    }
  }

  function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalizeId(value, fallback = '') {
    return text(value || fallback).replace(/\s+/g, '_');
  }

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function resolveUrl(value, baseUrl = window.location.href) {
    const raw = text(value);
    if (!raw) return '';
    if (/^javascript:/i.test(raw)) return '';
    if (/^(data:|blob:)/i.test(raw)) return raw;
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
  }

  function isElement(value) {
    return Boolean(value && typeof value === 'object' && value.nodeType === 1);
  }

  function inferAssetType(asset = {}) {
    const explicit = text(asset.type || asset.assetType || asset.kind).toLowerCase();
    if (explicit) return explicit;
    const mime = text(asset.mimeType || asset.mime).toLowerCase();
    const url = text(asset.url || asset.uri || asset.src).toLowerCase();
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/')) return 'image';
    if (/(live2d|model3\.json|moc3)/.test(url)) return 'live2d';
    if (/(spine|\.skel|\.atlas)/.test(url)) return 'spine';
    if (/\.json(\?|#|$)/.test(url) && /lottie/.test(url)) return 'lottie';
    if (/\.(mp3|ogg|wav|flac|m4a)(\?|#|$)/.test(url)) return 'audio';
    if (/\.(mp4|webm|mov)(\?|#|$)/.test(url)) return 'video';
    if (/\.(avif|gif|jpe?g|png|svg|webp)(\?|#|$)/.test(url)) return 'image';
    return 'unknown';
  }

  function rendererForAsset(asset = {}) {
    const metadata = object(asset.metadata);
    const renderer = text(asset.renderer || metadata.renderer || metadata.visualRenderer).toLowerCase();
    if (renderer) return renderer;
    const type = inferAssetType(asset);
    if (type === 'video') return 'video';
    if (type === 'live2d') return 'live2d';
    if (type === 'spine') return 'spine';
    if (type === 'lottie') return 'lottie';
    return 'static-image';
  }

  function createEventBus() {
    const handlers = new Map();

    function on(type, handler, options = {}) {
      const eventType = text(type);
      if (!eventType || typeof handler !== 'function') return () => {};
      if (!handlers.has(eventType)) handlers.set(eventType, new Set());
      const entry = { handler, once: options.once === true, modId: options.modId || '' };
      handlers.get(eventType).add(entry);
      return () => off(eventType, handler);
    }

    function off(type, handler) {
      const entries = handlers.get(text(type));
      if (!entries) return;
      for (const entry of entries) {
        if (entry.handler === handler) entries.delete(entry);
      }
      if (!entries.size) handlers.delete(text(type));
    }

    function emit(type, detail = {}, meta = {}) {
      const event = {
        type: text(type),
        detail,
        meta: object(meta),
        timestamp: nowIso(),
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        }
      };
      for (const eventType of [event.type, '*']) {
        const entries = [...(handlers.get(eventType) || [])];
        for (const entry of entries) {
          safeCall(entry.handler, event);
          if (entry.once) handlers.get(eventType)?.delete(entry);
        }
      }
      safeCall(() => {
        window.dispatchEvent(new CustomEvent(`aidnd:${event.type}`, { detail: event }));
        window.dispatchEvent(new CustomEvent('aidnd:event', { detail: event }));
      });
      return event;
    }

    return {
      knownEvents,
      on,
      off,
      once: (type, handler, options = {}) => on(type, handler, { ...options, once: true }),
      emit,
      listeners: (type = '') => [...(handlers.get(text(type)) || [])].map((entry) => ({ modId: entry.modId, once: entry.once }))
    };
  }

  function createAssetRegistry(eventBus) {
    const assets = new Map();
    const resolvers = [];

    function normalize(asset = {}, sourceUrl = '') {
      const metadata = object(asset.metadata);
      const url = resolveUrl(asset.url || asset.uri || asset.src || asset.path || metadata.url || metadata.uri || metadata.src, sourceUrl || window.location.href);
      const type = inferAssetType({ ...asset, url });
      const targetType = text(asset.targetType || asset.target?.targetType || metadata.targetType).toLowerCase();
      const targetId = text(asset.targetId || asset.target?.targetId || metadata.targetId);
      const slot = text(asset.slot || asset.target?.slot || metadata.slot).toLowerCase();
      const id = normalizeId(asset.id || asset.assetId, [type, targetType, targetId, slot, url].filter(Boolean).join(':'));
      return {
        ...asset,
        id,
        type,
        targetType,
        targetId,
        slot,
        url,
        uri: url,
        src: url,
        renderer: rendererForAsset({ ...asset, type, url, metadata }),
        metadata,
        modId: text(asset.modId || metadata.modId),
        sourceUrl: sourceUrl || asset.sourceUrl || ''
      };
    }

    function register(asset, options = {}) {
      const normalized = normalize({ ...asset, modId: asset.modId || options.modId }, options.sourceUrl || asset.sourceUrl || '');
      if (!normalized.id) return undefined;
      assets.set(normalized.id, normalized);
      eventBus.emit('asset:registered', { asset: normalized });
      return normalized;
    }

    function registerMany(list = [], options = {}) {
      return toArray(list).map((asset) => register(asset, options)).filter(Boolean);
    }

    function unregister(id) {
      const key = text(id);
      const asset = assets.get(key);
      assets.delete(key);
      if (asset) eventBus.emit('asset:unregistered', { asset });
    }

    function matches(asset, filter = {}) {
      for (const [key, expected] of Object.entries(filter)) {
        if (expected === undefined || expected === null || expected === '') continue;
        if (Array.isArray(expected)) {
          if (!expected.map(text).includes(text(asset[key]))) return false;
        } else if (text(asset[key]).toLowerCase() !== text(expected).toLowerCase()) {
          return false;
        }
      }
      return true;
    }

    function query(filter = {}) {
      return [...assets.values()].filter((asset) => matches(asset, filter));
    }

    function find(filter = {}) {
      return query(filter)[0];
    }

    function findForTarget(targetType, targetId, slots = []) {
      const targetIds = toArray(targetId).map(text).filter(Boolean);
      const slotList = toArray(slots).map((slot) => text(slot).toLowerCase()).filter(Boolean);
      return query({ targetType }).find((asset) => {
        const idMatches = !targetIds.length || targetIds.includes(text(asset.targetId));
        const slotMatches = !slotList.length || slotList.includes(text(asset.slot).toLowerCase());
        return idMatches && slotMatches;
      });
    }

    async function resolve(filter = {}, context = {}) {
      const local = find(filter);
      if (local) return local;
      for (const resolver of resolvers) {
        const result = await safeCall(resolver, filter, context);
        if (result) return register(result, { sourceUrl: result.sourceUrl || context.sourceUrl || '', modId: result.modId || context.modId || '' });
      }
      return undefined;
    }

    function registerResolver(resolver) {
      if (typeof resolver !== 'function') return () => {};
      resolvers.push(resolver);
      return () => {
        const index = resolvers.indexOf(resolver);
        if (index >= 0) resolvers.splice(index, 1);
      };
    }

    return {
      normalize,
      register,
      registerMany,
      unregister,
      query,
      find,
      findForTarget,
      resolve,
      registerResolver,
      all: () => [...assets.values()]
    };
  }

  function staticImageRenderer({ asset = {}, npc = {}, onError } = {}) {
    const image = document.createElement('img');
    image.src = asset.url || npc.imageUrl || '';
    image.alt = `${npc.name || asset.targetId || 'NPC'} CG`;
    image.loading = 'lazy';
    image.dataset.renderer = 'static-image';
    image.addEventListener('error', () => {
      if (typeof onError === 'function') onError();
    });
    return image;
  }

  function videoRenderer({ asset = {}, npc = {}, onError } = {}) {
    const video = document.createElement('video');
    video.src = asset.url || npc.imageUrl || '';
    video.autoplay = asset.metadata?.autoplay !== false;
    video.loop = asset.metadata?.loop !== false;
    video.muted = asset.metadata?.muted !== false;
    video.playsInline = true;
    video.dataset.renderer = 'video';
    video.setAttribute('aria-label', `${npc.name || asset.targetId || 'NPC'} video`);
    video.addEventListener('error', () => {
      if (typeof onError === 'function') onError();
    });
    return video;
  }

  function fallbackVisualRenderer(context = {}) {
    return staticImageRenderer(context);
  }

  function createSceneVisualRenderers(assetRegistry, eventBus) {
    const renderers = new Map();

    function register(id, renderer, options = {}) {
      const key = text(id).toLowerCase();
      if (!key || typeof renderer !== 'function') return () => {};
      renderers.set(key, {
        id: key,
        renderer,
        modId: options.modId || '',
        label: options.label || key
      });
      eventBus.emit('renderer:registered', { id: key, modId: options.modId || '' });
      return () => renderers.delete(key);
    }

    function render(context = {}) {
      const npc = object(context.npc);
      const baseAsset = context.asset || {
        type: 'image',
        targetType: 'npc',
        targetId: npc.id,
        slot: 'portrait',
        url: npc.imageUrl,
        renderer: npc.renderer,
        metadata: npc.visual || npc.metadata || {}
      };
      const asset = assetRegistry.normalize(baseAsset);
      const rendererId = text(context.renderer || asset.renderer || rendererForAsset(asset)).toLowerCase();
      const entry = renderers.get(rendererId) || renderers.get('static-image') || { renderer: fallbackVisualRenderer };
      const result = safeCall(entry.renderer, { ...context, npc, asset, rendererId });
      if (isElement(result)) return result;
      return fallbackVisualRenderer({ ...context, npc, asset });
    }

    function renderNpc(context = {}) {
      return render({ targetType: 'npc', ...context });
    }

    function names() {
      return [...renderers.keys()];
    }

    register('static-image', staticImageRenderer, { label: 'Static image' });
    register('fallback', fallbackVisualRenderer, { label: 'Fallback static image' });
    register('video', videoRenderer, { label: 'Video' });
    register('live2d', fallbackVisualRenderer, { label: 'Live2D fallback' });
    register('spine', fallbackVisualRenderer, { label: 'Spine fallback' });
    register('lottie', fallbackVisualRenderer, { label: 'Lottie fallback' });

    return {
      register,
      render,
      renderNpc,
      names,
      has: (id) => renderers.has(text(id).toLowerCase())
    };
  }

  function createAudioManager(assetRegistry, eventBus) {
    const voiceBindings = new Map();
    const ttsProviders = new Map();
    const queue = [];
    const channels = new Map();
    let unlocked = false;
    let running = false;

    function unlock() {
      unlocked = true;
      document.removeEventListener('pointerdown', unlock, true);
      eventBus.emit('audio:unlocked', {});
    }
    document.addEventListener('pointerdown', unlock, true);

    function bindVoice(binding = {}) {
      const normalized = {
        ...binding,
        npcId: text(binding.npcId),
        speakerName: text(binding.speakerName || binding.speaker),
        voiceId: text(binding.voiceId),
        provider: text(binding.provider || binding.ttsProvider),
        fixedAudioAssetId: text(binding.fixedAudioAssetId || binding.audioAssetId)
      };
      const keys = [
        normalized.npcId,
        normalized.speakerName,
        text(binding.speaker),
        text(binding.id)
      ].filter(Boolean);
      if (!keys.length) return undefined;
      for (const key of keys) voiceBindings.set(key, normalized);
      return normalized;
    }

    function findVoiceBinding({ npcId = '', speakerName = '' } = {}) {
      return voiceBindings.get(text(npcId)) || voiceBindings.get(text(speakerName));
    }

    function registerTtsProvider(id, provider) {
      const key = text(id);
      if (!key || typeof provider !== 'function') return () => {};
      ttsProviders.set(key, provider);
      return () => ttsProviders.delete(key);
    }

    function playAudioElement(audio, { channel = 'sfx', loop = false, volume = 1 } = {}) {
      if (!audio) return undefined;
      audio.loop = loop;
      audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
      if (channel !== 'sfx') {
        channels.get(channel)?.pause();
        channels.set(channel, audio);
      }
      const play = () => audio.play().catch((error) => eventBus.emit('audio:error', { error, channel }));
      if (unlocked) play();
      return audio;
    }

    function playAsset(assetOrId, options = {}) {
      const asset = typeof assetOrId === 'string' ? assetRegistry.find({ id: assetOrId }) : assetOrId;
      if (!asset?.url) return undefined;
      const audio = new Audio(asset.url);
      return playAudioElement(audio, options);
    }

    function playBgm(assetOrId, options = {}) {
      return playAsset(assetOrId, { channel: 'bgm', loop: true, volume: 0.8, ...options });
    }

    function playAmbient(assetOrId, options = {}) {
      return playAsset(assetOrId, { channel: 'ambient', loop: true, volume: 0.55, ...options });
    }

    function playSfx(assetOrId, options = {}) {
      return playAsset(assetOrId, { channel: 'sfx', loop: false, volume: 1, ...options });
    }

    function stop(channel = 'bgm') {
      const audio = channels.get(channel);
      if (!audio) return;
      audio.pause();
      channels.delete(channel);
    }

    function stopAll() {
      for (const channel of [...channels.keys()]) stop(channel);
    }

    async function drainQueue() {
      if (running) return;
      running = true;
      while (queue.length) {
        const item = queue.shift();
        const binding = findVoiceBinding(item) || {};
        if (binding.fixedAudioAssetId) {
          playAsset(binding.fixedAudioAssetId, { channel: 'voice', loop: false, volume: binding.volume ?? 1 });
          continue;
        }
        const providerId = item.provider || binding.provider;
        const provider = ttsProviders.get(providerId);
        if (!provider) continue;
        const result = await safeCall(provider, { ...item, binding, unlocked });
        if (result?.url) playAsset(result, { channel: 'voice', loop: false, volume: binding.volume ?? 1 });
      }
      running = false;
    }

    function enqueueTts(item = {}) {
      const normalized = {
        npcId: text(item.npcId),
        speakerName: text(item.speakerName || item.speaker),
        text: text(item.text),
        provider: text(item.provider),
        voiceId: text(item.voiceId),
        metadata: object(item.metadata)
      };
      if (!normalized.text) return undefined;
      queue.push(normalized);
      eventBus.emit('audio:tts:queued', normalized);
      void drainQueue();
      return normalized;
    }

    function enqueueNpcSpeech(item = {}) {
      return enqueueTts(item);
    }

    eventBus.on('npc:speech', (event) => enqueueNpcSpeech(event.detail));

    return {
      bindVoice,
      findVoiceBinding,
      registerTtsProvider,
      enqueueTts,
      enqueueNpcSpeech,
      playAsset,
      playBgm,
      playAmbient,
      playSfx,
      stop,
      stopAll,
      isUnlocked: () => unlocked,
      queue: () => [...queue],
      bindings: () => [...voiceBindings.values()]
    };
  }

  function createSettingsPanelRegistry(eventBus) {
    const panels = new Map();
    function register(panel = {}) {
      const id = text(panel.id);
      if (!id) return undefined;
      panels.set(id, panel);
      eventBus.emit('settings-panel:registered', { panel });
      return panel;
    }
    return {
      register,
      get: (id) => panels.get(text(id)),
      all: () => [...panels.values()]
    };
  }

  function createModManager({ eventBus, assetRegistry, audioManager, settingsPanels }) {
    const manifests = new Map();

    async function loadJson(url) {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }

    function manifestBase(url) {
      try {
        return new URL('.', new URL(url, window.location.href)).href;
      } catch {
        return window.location.href;
      }
    }

    function sameOrigin(url) {
      try {
        return new URL(url, window.location.href).origin === window.location.origin;
      } catch {
        return false;
      }
    }

    async function loadScript(url, manifest, options = {}) {
      const scriptUrl = resolveUrl(url, manifestBase(manifest.sourceUrl));
      const allowScripts = options.allowScripts === true || manifest.allowScripts === true;
      const permissions = toArray(manifest.permissions).map(text);
      if (!allowScripts || !permissions.includes(SAME_ORIGIN_SCRIPT_PERMISSION) || !sameOrigin(scriptUrl)) {
        eventBus.emit('mod:script-blocked', { modId: manifest.id, url: scriptUrl });
        return false;
      }
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.defer = true;
        script.dataset.modId = manifest.id;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      return true;
    }

    async function loadStyle(url, manifest) {
      const href = resolveUrl(url, manifestBase(manifest.sourceUrl));
      await new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.modId = manifest.id;
        link.onload = resolve;
        link.onerror = reject;
        document.head.append(link);
      });
      return true;
    }

    async function applyManifest(raw = {}, sourceUrl = '', options = {}) {
      const manifest = {
        ...raw,
        id: normalizeId(raw.id || raw.name, sourceUrl || `mod:${manifests.size + 1}`),
        sourceUrl
      };
      manifests.set(manifest.id, manifest);
      assetRegistry.registerMany(raw.assets || raw.resources || [], {
        modId: manifest.id,
        sourceUrl: manifestBase(sourceUrl)
      });
      for (const binding of toArray(raw.audio?.voiceBindings || raw.voiceBindings)) {
        audioManager.bindVoice({ ...binding, modId: manifest.id });
      }
      for (const panel of toArray(raw.settingsPanels)) {
        settingsPanels.register({ ...panel, modId: manifest.id });
      }
      for (const css of toArray(raw.styles || raw.css)) {
        await safeCall(loadStyle, css, manifest);
      }
      for (const script of toArray(raw.scripts)) {
        await safeCall(loadScript, script, manifest, options);
      }
      eventBus.emit('mod:loaded', { manifest });
      return manifest;
    }

    async function loadManifest(url, options = {}) {
      const manifestUrl = resolveUrl(url);
      const manifest = await loadJson(manifestUrl);
      return applyManifest(manifest, manifestUrl, options);
    }

    async function loadIndex(url = MOD_INDEX_URL) {
      const indexUrl = resolveUrl(url);
      let index;
      try {
        index = await loadJson(indexUrl);
      } catch {
        return [];
      }
      const entries = Array.isArray(index) ? index : toArray(index.mods || index.manifests);
      const allowScripts = index.allowScripts === true;
      const loaded = [];
      for (const entry of entries) {
        const manifestUrl = typeof entry === 'string' ? entry : entry.url || entry.href || entry.manifest;
        if (!manifestUrl) continue;
        const result = await safeCall(loadManifest, resolveUrl(manifestUrl, indexUrl), { allowScripts });
        if (result) loaded.push(result);
      }
      return loaded;
    }

    return {
      loadIndex,
      loadManifest,
      applyManifest,
      all: () => [...manifests.values()],
      get: (id) => manifests.get(text(id))
    };
  }

  const events = createEventBus();
  const assetRegistry = createAssetRegistry(events);
  const sceneVisualRenderers = createSceneVisualRenderers(assetRegistry, events);
  const settingsPanels = createSettingsPanelRegistry(events);
  const audioManager = createAudioManager(assetRegistry, events);
  const modManager = createModManager({ eventBus: events, assetRegistry, audioManager, settingsPanels });

  const api = {
    version: '0.1.0',
    events,
    assetRegistry,
    sceneVisualRenderers,
    audioManager,
    settingsPanels,
    modManager,
    use: (type, handler, options = {}) => events.on(type, handler, options),
    emit: (type, detail = {}, meta = {}) => events.emit(type, detail, meta),
    registerAssets: (assets, options = {}) => assetRegistry.registerMany(assets, options),
    registerRenderer: (id, renderer, options = {}) => sceneVisualRenderers.register(id, renderer, options),
    registerSettingsPanel: (panel = {}) => settingsPanels.register(panel)
  };

  window[GLOBAL_NAME] = api;
  window.aiDndFrontendExtensions = api;
  document.documentElement.dataset.aiDndFrontendExtensions = api.version;
  document.documentElement.dataset.aiDndFrontendExtensionRenderers = sceneVisualRenderers.names().join(',');
  safeCall(() => window.dispatchEvent(new CustomEvent('aidnd:frontend-ready', { detail: api })));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void modManager.loadIndex();
    }, { once: true });
  } else {
    void modManager.loadIndex();
  }
})();
