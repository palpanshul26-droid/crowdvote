/**
 * ZeroClip — Complete Frontend Studio Controller
 * Vanilla ES Module · Browser-local FFmpeg.wasm · Server-side Gemini via /api/highlights
 */

const STORAGE_MODEL_KEY = 'zeroclip_gemini_model';
const DEFAULT_MODEL = 'gemini-4-hydrogen';
const MAX_LIVE_BUFFER_SEC = 120;

const FFMPEG_CDN_SOURCES = [
  {
    ffmpegScript: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
    worker: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js',
    coreJs: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    coreWasm: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    fontTtf: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
  },
  {
    ffmpegScript: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
    worker: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js',
    coreJs: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    coreWasm: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    fontTtf: 'https://unpkg.com/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
  },
];

// ============================================================================
// Application State
// ============================================================================

const state = {
  activeView: 'studio',

  // Media
  videoFile: null,
  videoUrl: null,
  duration: 0,
  videoWidth: 0,
  videoHeight: 0,

  // Clip Editor
  clipStart: 0,
  clipEnd: 30,
  durationPreset: '30',
  aspectRatio: '9:16',
  framing: 'crop',
  resolution: '1080p',
  burnSubtitles: false,
  previewStopAt: null,
  isExporting: false,

  // AI Highlights
  highlights: [],
  editingHighlightId: null,
  isAnalyzing: false,

  // Subtitles
  subtitles: [],
  subStyle: 'classic',
  subKeywords: 'changed, viral, unexpected',
  subColor: '#A78BFA',
  subFontSize: 28,
  subPosition: 'bottom',

  // Queue & Exports
  queue: [],
  exports: [],

  // Speech Dictation
  speechRecognition: null,
  isDictating: false,

  // Live Clipper
  live: {
    stream: null,
    recorder: null,
    mimeType: 'video/webm',
    headerBytes: null,
    chunks: [],
    active: false,
    sourceLabel: 'No active source',
    startedAt: 0,
    timerId: null,
    clips: [],
  },

  // Settings
  model: localStorage.getItem(STORAGE_MODEL_KEY) || DEFAULT_MODEL,

  // FFmpeg Engine
  ffmpeg: {
    instance: null,
    loaded: false,
    loadingPromise: null,
    fontBytes: null,
    activeProgressCb: null,
  },
};

// ============================================================================
// DOM Element Cache
// ============================================================================

const el = {
  // Shell & Nav
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  btnOpenSidebar: document.getElementById('btn-open-sidebar'),
  btnCloseSidebar: document.getElementById('btn-close-sidebar'),
  topbarTitle: document.getElementById('topbar-title'),
  topbarMeta: document.getElementById('topbar-meta'),
  topbarModelLabel: document.getElementById('topbar-model-label'),
  btnHeaderUpload: document.getElementById('btn-header-upload'),
  sidebarMediaName: document.getElementById('sidebar-media-name'),
  sidebarMediaSpecs: document.getElementById('sidebar-media-specs'),
  navSubtitlesCount: document.getElementById('nav-subtitles-count'),
  navQueueCount: document.getElementById('nav-queue-count'),

  // File Inputs
  videoFileInput: document.getElementById('video-file-input'),
  transcriptFileInput: document.getElementById('transcript-file-input'),

  // Upload & Media Bar
  uploadDropzone: document.getElementById('upload-dropzone'),
  btnDropzoneBrowse: document.getElementById('btn-dropzone-browse'),
  loadedMediaBar: document.getElementById('loaded-media-bar'),
  mediaFilename: document.getElementById('media-filename'),
  mediaDuration: document.getElementById('media-duration'),
  mediaFilesize: document.getElementById('media-filesize'),
  mediaDimensions: document.getElementById('media-dimensions'),
  btnReplaceVideo: document.getElementById('btn-replace-video'),
  btnClearVideo: document.getElementById('btn-clear-video'),

  // Stage & Video
  previewFrame: document.getElementById('preview-frame'),
  previewBlurBg: document.getElementById('preview-blur-bg'),
  mainVideo: document.getElementById('main-video'),
  previewSubtitleOverlay: document.getElementById('preview-subtitle-overlay'),
  stageEmptyState: document.getElementById('stage-empty-state'),
  btnStageUpload: document.getElementById('btn-stage-upload'),
  stageFormatMeta: document.getElementById('stage-format-meta'),
  stageFramingMeta: document.getElementById('stage-framing-meta'),
  stageResMeta: document.getElementById('stage-res-meta'),

  // Transport & Timeline
  btnPlayPause: document.getElementById('btn-play-pause'),
  btnStepBack: document.getElementById('btn-step-back'),
  btnStepForward: document.getElementById('btn-step-forward'),
  btnPreviewRange: document.getElementById('btn-preview-range'),
  timecodeCurrent: document.getElementById('timecode-current'),
  timecodeTotal: document.getElementById('timecode-total'),
  btnMute: document.getElementById('btn-mute'),
  volumeSlider: document.getElementById('volume-slider'),
  playbackSpeed: document.getElementById('playback-speed'),
  timelineTrack: document.getElementById('timeline-track'),
  timelineMarkers: document.getElementById('timeline-markers'),
  timelineSelection: document.getElementById('timeline-selection'),
  handleIn: document.getElementById('handle-in'),
  handleOut: document.getElementById('handle-out'),
  timelineProgress: document.getElementById('timeline-progress'),
  timelinePlayhead: document.getElementById('timeline-playhead'),
  btnSetIn: document.getElementById('btn-set-in'),
  btnSetOut: document.getElementById('btn-set-out'),
  selectionReadout: document.getElementById('selection-readout'),

  // Clip Editor
  ffmpegMiniState: document.getElementById('ffmpeg-mini-state'),
  clipTitleInput: document.getElementById('clip-title-input'),
  clipStartInput: document.getElementById('clip-start-input'),
  clipEndInput: document.getElementById('clip-end-input'),
  burnSubtitlesToggle: document.getElementById('burn-subtitles-toggle'),
  burnCueCount: document.getElementById('burn-cue-count'),
  btnAddQueue: document.getElementById('btn-add-queue'),
  btnExportClip: document.getElementById('btn-export-clip'),
  exportProgressBox: document.getElementById('export-progress-box'),
  exportStageLabel: document.getElementById('export-stage-label'),
  exportPercentLabel: document.getElementById('export-percent-label'),
  exportProgressFill: document.getElementById('export-progress-fill'),

  // AI Panel
  transcriptInput: document.getElementById('transcript-input'),
  transcriptCharCount: document.getElementById('transcript-char-count'),
  btnInsertTimestamp: document.getElementById('btn-insert-timestamp'),
  btnImportTranscript: document.getElementById('btn-import-transcript'),
  btnDictateTranscript: document.getElementById('btn-dictate-transcript'),
  sampleKeyframesToggle: document.getElementById('sample-keyframes-toggle'),
  aiInputHonestyNote: document.getElementById('ai-input-honesty-note'),
  aiInstructionsInput: document.getElementById('ai-instructions-input'),
  btnFindHighlights: document.getElementById('btn-find-highlights'),
  aiBtnSpinner: document.getElementById('ai-btn-spinner'),
  aiBtnLabel: document.getElementById('ai-btn-label'),
  highlightsError: document.getElementById('highlights-error'),
  highlightsLoading: document.getElementById('highlights-loading'),
  highlightsMeta: document.getElementById('highlights-meta'),
  highlightsList: document.getElementById('highlights-list'),

  // Subtitles View
  btnAddCue: document.getElementById('btn-add-cue'),
  btnSubImportSrt: document.getElementById('btn-sub-import-srt'),
  btnSubFromTranscript: document.getElementById('btn-sub-from-transcript'),
  btnSubExportSrt: document.getElementById('btn-sub-export-srt'),
  btnSubClear: document.getElementById('btn-sub-clear'),
  subtitleCueList: document.getElementById('subtitle-cue-list'),
  subtitleStylePreview: document.getElementById('subtitle-style-preview'),
  subtitleKeywordsInput: document.getElementById('subtitle-keywords-input'),
  subtitleFontsizeSlider: document.getElementById('subtitle-fontsize-slider'),
  subtitleFontsizeValue: document.getElementById('subtitle-fontsize-value'),
  subtitlesBurnSync: document.getElementById('subtitles-burn-sync'),

  // Live Clipper View
  liveStatusText: document.getElementById('live-status-text'),
  livePreviewVideo: document.getElementById('live-preview-video'),
  liveEmptyState: document.getElementById('live-empty-state'),
  liveSourceLabel: document.getElementById('live-source-label'),
  liveBufferReadout: document.getElementById('live-buffer-readout'),
  liveBufferFill: document.getElementById('live-buffer-fill'),
  btnLiveScreen: document.getElementById('btn-live-screen'),
  btnLiveCamera: document.getElementById('btn-live-camera'),
  btnLiveStop: document.getElementById('btn-live-stop'),
  liveClipsCount: document.getElementById('live-clips-count'),
  liveClipsList: document.getElementById('live-clips-list'),

  // Export Queue View
  btnExportAll: document.getElementById('btn-export-all'),
  btnClearQueue: document.getElementById('btn-clear-queue'),
  queueProgressBox: document.getElementById('queue-progress-box'),
  queueStageLabel: document.getElementById('queue-stage-label'),
  queuePercentLabel: document.getElementById('queue-percent-label'),
  queueProgressFill: document.getElementById('queue-progress-fill'),
  queueList: document.getElementById('queue-list'),
  completedExportsCount: document.getElementById('completed-exports-count'),
  exportsList: document.getElementById('exports-list'),

  // Settings View
  settingsGeminiStatus: document.getElementById('settings-gemini-status'),
  settingsModelSelect: document.getElementById('settings-model-select'),
  btnTestGemini: document.getElementById('btn-test-gemini'),
  settingsApiOutput: document.getElementById('settings-api-output'),
  settingsFfmpegStatus: document.getElementById('settings-ffmpeg-status'),
  btnPreloadFfmpeg: document.getElementById('btn-preload-ffmpeg'),
  capWasm: document.getElementById('cap-wasm'),
  capDisplay: document.getElementById('cap-display'),
  capRecorder: document.getElementById('cap-recorder'),
  capSpeech: document.getElementById('cap-speech'),

  // Edit Highlight Modal
  editModal: document.getElementById('edit-highlight-modal'),
  editForm: document.getElementById('edit-highlight-form'),
  editHlTitle: document.getElementById('edit-hl-title'),
  editHlStart: document.getElementById('edit-hl-start'),
  editHlEnd: document.getElementById('edit-hl-end'),
  editHlReason: document.getElementById('edit-hl-reason'),
  btnCloseEditModal: document.getElementById('btn-close-edit-modal'),
  btnCancelEditModal: document.getElementById('btn-cancel-edit-modal'),

  // Toasts
  toastContainer: document.getElementById('toast-container'),
};

// ============================================================================
// Utilities
// ============================================================================

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(seconds, showTenths = false) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  const base =
    hrs > 0
      ? `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return showTenths ? `${base}.${tenths}` : base;
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function parseTimeInput(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  const str = String(raw || '').trim();
  if (!str) return NaN;
  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }
  const parts = str.split(':').map((p) => parseFloat(p.replace(',', '.')));
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function slugifyFilename(title, ext = 'mp4') {
  const clean = String(title || 'zeroclip-clip')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${clean || 'zeroclip-clip'}.${ext}`;
}

function showToast(message, type = 'info', durationMs = 4200) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>
  `;
  const remove = () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  el.toastContainer.appendChild(toast);
  if (durationMs > 0) {
    setTimeout(remove, durationMs);
  }
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ============================================================================
// Navigation & Responsive Sidebar
// ============================================================================

const VIEW_TITLES = {
  studio: 'Studio',
  subtitles: 'Subtitles',
  live: 'Live Clipper',
  exports: 'Export Queue',
  settings: 'Settings',
};

function switchView(viewName) {
  if (!VIEW_TITLES[viewName]) return;
  state.activeView = viewName;

  document.querySelectorAll('.view').forEach((node) => {
    node.classList.toggle('is-active', node.id === `view-${viewName}`);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === viewName);
  });

  el.topbarTitle.textContent = VIEW_TITLES[viewName];
  closeMobileSidebar();
}

function openMobileSidebar() {
  el.sidebar.classList.add('is-open');
  el.sidebarBackdrop.classList.add('is-open');
}

function closeMobileSidebar() {
  el.sidebar.classList.remove('is-open');
  el.sidebarBackdrop.classList.remove('is-open');
}

// ============================================================================
// Video Loading, Preview & Timeline Controls
// ============================================================================

function loadVideoFile(file, sourceNameOverride = null) {
  if (!file) return;
  const validExt = /\.(mp4|mov|webm)$/i.test(file.name || '');
  const validMime = /^(video\/mp4|video\/quicktime|video\/webm)/i.test(file.type || '');
  if (!validExt && !validMime) {
    showToast('Please select a supported MP4, MOV, or WebM video file.', 'warning');
    return;
  }

  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
  }

  const finalFile =
    sourceNameOverride && !(file instanceof File)
      ? new File([file], sourceNameOverride, { type: file.type || 'video/webm' })
      : file;

  state.videoFile = finalFile;
  state.videoUrl = URL.createObjectURL(finalFile);
  state.previewStopAt = null;

  el.mainVideo.src = state.videoUrl;
  el.previewBlurBg.src = state.videoUrl;
  el.previewBlurBg.classList.add('has-source');

  el.stageEmptyState.classList.add('is-hidden');
  el.uploadDropzone.classList.add('is-hidden');
  el.loadedMediaBar.classList.remove('is-hidden');

  const displayName = finalFile.name || 'uploaded-video.mp4';
  el.mediaFilename.textContent = displayName;
  el.mediaFilesize.textContent = formatBytes(finalFile.size);
  el.sidebarMediaName.textContent = displayName;
  el.sidebarMediaSpecs.textContent = `Loading metadata · ${formatBytes(finalFile.size)}`;

  el.mainVideo.load();
  el.previewBlurBg.load();

  setTransportEnabled(true);
  updateAiHonestyNote();
  showToast(`Loaded "${displayName}" for local browser editing.`, 'success');
}

function clearLoadedVideo() {
  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
  }
  state.videoFile = null;
  state.videoUrl = null;
  state.duration = 0;
  state.videoWidth = 0;
  state.videoHeight = 0;
  state.clipStart = 0;
  state.clipEnd = 30;
  state.previewStopAt = null;

  el.mainVideo.pause();
  el.mainVideo.removeAttribute('src');
  el.mainVideo.load();
  el.previewBlurBg.pause();
  el.previewBlurBg.removeAttribute('src');
  el.previewBlurBg.classList.remove('has-source');
  el.previewBlurBg.load();

  el.stageEmptyState.classList.remove('is-hidden');
  el.uploadDropzone.classList.remove('is-hidden');
  el.loadedMediaBar.classList.add('is-hidden');
  el.sidebarMediaName.textContent = 'No video loaded';
  el.sidebarMediaSpecs.textContent = 'MP4, MOV, or WebM';
  el.timecodeCurrent.textContent = '00:00.0';
  el.timecodeTotal.textContent = '00:00.0';
  el.previewSubtitleOverlay.innerHTML = '';

  setTransportEnabled(false);
  updateTimelineVisuals();
  updateAiHonestyNote();
  renderTimelineMarkers();
  showToast('Video removed from workspace.', 'info');
}

function setTransportEnabled(enabled) {
  [
    el.btnPlayPause,
    el.btnStepBack,
    el.btnStepForward,
    el.btnPreviewRange,
    el.btnMute,
    el.volumeSlider,
    el.playbackSpeed,
    el.btnSetIn,
    el.btnSetOut,
  ].forEach((control) => {
    control.disabled = !enabled;
  });
}

function syncBlurVideo(forceTime = false) {
  if (!state.videoUrl || state.framing !== 'blur') return;
  if (forceTime || Math.abs(el.previewBlurBg.currentTime - el.mainVideo.currentTime) > 0.25) {
    try {
      el.previewBlurBg.currentTime = el.mainVideo.currentTime;
    } catch {
      // Ignore seek race before readyState
    }
  }
  el.previewBlurBg.playbackRate = el.mainVideo.playbackRate;
  if (!el.mainVideo.paused && el.previewBlurBg.paused) {
    el.previewBlurBg.play().catch(() => {});
  } else if (el.mainVideo.paused && !el.previewBlurBg.paused) {
    el.previewBlurBg.pause();
  }
}

function setClipRange(start, end, markCustom = false) {
  const maxDur = state.duration > 0 ? state.duration : Math.max(end, 120);
  let s = Number.isFinite(start) ? clamp(start, 0, Math.max(0, maxDur - 0.5)) : 0;
  let e = Number.isFinite(end) ? clamp(end, s + 0.5, maxDur) : Math.min(maxDur, s + 30);

  s = Math.round(s * 10) / 10;
  e = Math.round(e * 10) / 10;
  if (e <= s) e = Math.min(maxDur, s + 1);

  state.clipStart = s;
  state.clipEnd = e;

  el.clipStartInput.value = formatTime(s, true);
  el.clipEndInput.value = formatTime(e, true);

  if (markCustom) {
    state.durationPreset = 'custom';
    syncSegmentedButtons('[data-duration]', 'custom', 'duration');
  }

  updateTimelineVisuals();
}

function applyDurationPreset(preset) {
  state.durationPreset = preset;
  syncSegmentedButtons('[data-duration]', preset, 'duration');
  if (preset === 'custom') return;
  const len = Number(preset);
  if (!Number.isFinite(len)) return;
  const maxDur = state.duration > 0 ? state.duration : state.clipStart + len;
  let newEnd = state.clipStart + len;
  let newStart = state.clipStart;
  if (newEnd > maxDur) {
    newEnd = maxDur;
    newStart = Math.max(0, maxDur - len);
  }
  setClipRange(newStart, newEnd, false);
}

function updateTimelineVisuals() {
  const dur = state.duration > 0 ? state.duration : Math.max(state.clipEnd, 60);
  const current = el.mainVideo.currentTime || 0;
  const pctCurrent = clamp((current / dur) * 100, 0, 100);
  const pctIn = clamp((state.clipStart / dur) * 100, 0, 100);
  const pctOut = clamp((state.clipEnd / dur) * 100, pctIn, 100);

  el.timelineProgress.style.width = `${pctCurrent}%`;
  el.timelinePlayhead.style.left = `${pctCurrent}%`;
  el.timelineSelection.style.left = `${pctIn}%`;
  el.timelineSelection.style.width = `${Math.max(1, pctOut - pctIn)}%`;
  el.timelineTrack.setAttribute('aria-valuenow', String(Math.round(pctCurrent)));

  const clipLen = Math.max(0, state.clipEnd - state.clipStart);
  el.selectionReadout.textContent = `Clip Range: ${formatTime(state.clipStart, true)} – ${formatTime(state.clipEnd, true)} · ${clipLen.toFixed(1)}s`;
}

function renderTimelineMarkers() {
  el.timelineMarkers.innerHTML = '';
  if (!state.duration || !state.highlights.length) return;
  for (const hl of state.highlights) {
    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    const leftPct = clamp((hl.start / state.duration) * 100, 0, 100);
    const widthPct = clamp(((hl.end - hl.start) / state.duration) * 100, 0.8, 100 - leftPct);
    marker.style.left = `${leftPct}%`;
    marker.style.width = `${widthPct}%`;
    marker.title = `${hl.title} (${formatTime(hl.start)}–${formatTime(hl.end)})`;
    el.timelineMarkers.appendChild(marker);
  }
}

function syncSegmentedButtons(selector, activeVal, datasetKey) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset[datasetKey] === activeVal);
  });
}

function updateStagePreviewAttributes() {
  el.previewFrame.dataset.aspect = state.aspectRatio;
  el.previewFrame.dataset.framing = state.framing;

  const aspectLabels = {
    '9:16': '9:16 Vertical',
    '16:9': '16:9 Landscape',
    '1:1': '1:1 Square',
  };
  el.stageFormatMeta.textContent = aspectLabels[state.aspectRatio] || state.aspectRatio;
  el.stageFramingMeta.textContent = state.framing === 'blur' ? 'Blur Background' : 'Center Crop';
  el.stageResMeta.textContent = state.resolution;

  syncBlurVideo(true);
}

// ============================================================================
// Subtitles Engine (Parsing, Styling, Live Overlay, SRT Export)
// ============================================================================

function parseSrtOrVtt(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/^WEBVTT[^\n]*\n+/i, '');
  const blocks = normalized.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;

    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const [startRaw, endRaw] = lines[timeLineIdx].split('-->').map((s) => s.trim().split(' ')[0]);
    const start = parseTimeInput(startRaw);
    const end = parseTimeInput(endRaw);
    const cueText = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (Number.isFinite(start) && Number.isFinite(end) && end > start && cueText) {
      cues.push({ id: uid('cue'), start, end, text: cueText });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

function buildSrtContent(cues) {
  return cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(
      (cue, idx) =>
        `${idx + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text.trim()}`
    )
    .join('\n\n');
}

function formatCaptionHtml(text) {
  const escaped = escapeHtml(text);
  const keywords = state.subKeywords
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  if (!keywords.length) {
    return `<span class="sub-line">${escaped}</span>`;
  }
  const escapedKws = keywords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escapedKws.join('|')})\\b`, 'gi');
  const highlighted = escaped.replace(regex, '<mark class="sub-kw">$1</mark>');
  return `<span class="sub-line">${highlighted}</span>`;
}

function applySubtitleOverlayStyles() {
  const targets = [el.previewSubtitleOverlay, el.subtitleStylePreview];
  targets.forEach((node) => {
    node.dataset.position = state.subPosition;
    node.dataset.style = state.subStyle;
    node.style.fontSize = `${state.subFontSize}px`;
    node.style.setProperty('--sub-highlight', state.subColor);
  });

  el.subtitleFontsizeValue.textContent = `${state.subFontSize}px`;
  el.subtitleStylePreview.innerHTML = formatCaptionHtml(
    'This moment completely changed the unexpected outcome.'
  );
  updateLiveSubtitleOverlay();
}

function updateLiveSubtitleOverlay() {
  if (!state.videoUrl || !state.subtitles.length) {
    el.previewSubtitleOverlay.innerHTML = '';
    return;
  }
  const t = el.mainVideo.currentTime || 0;
  const activeCue = state.subtitles.find((c) => t >= c.start && t <= c.end);
  el.previewSubtitleOverlay.innerHTML = activeCue ? formatCaptionHtml(activeCue.text) : '';
}

function renderSubtitleCueList() {
  el.navSubtitlesCount.textContent = String(state.subtitles.length);
  el.burnCueCount.textContent = String(state.subtitles.length);

  if (!state.subtitles.length) {
    el.subtitleCueList.innerHTML = `
      <div class="empty-state">
        <p>No subtitle cues yet.</p>
        <p class="empty-state-sub">Add a cue at the current video playhead or import an existing SRT/VTT caption file.</p>
      </div>
    `;
    updateLiveSubtitleOverlay();
    return;
  }

  state.subtitles.sort((a, b) => a.start - b.start);
  el.subtitleCueList.innerHTML = '';

  state.subtitles.forEach((cue) => {
    const row = document.createElement('div');
    row.className = 'cue-row';
    row.innerHTML = `
      <div class="cue-row-times">
        <input class="text-input cue-time-input tabular" type="text" value="${escapeHtml(formatTime(cue.start, true))}" data-field="start" aria-label="Cue start time" />
        <span class="meta-sep">&ndash;</span>
        <input class="text-input cue-time-input tabular" type="text" value="${escapeHtml(formatTime(cue.end, true))}" data-field="end" aria-label="Cue end time" />
        <button class="btn btn-ghost btn-sm" type="button" data-action="jump">Jump</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="delete">Delete</button>
      </div>
      <input class="text-input" type="text" value="${escapeHtml(cue.text)}" data-field="text" placeholder="Enter caption text..." aria-label="Cue caption text" />
    `;

    row.querySelector('[data-field="start"]').addEventListener('change', (e) => {
      const val = parseTimeInput(e.target.value);
      if (Number.isFinite(val)) {
        cue.start = Math.max(0, val);
        if (cue.end <= cue.start) cue.end = cue.start + 2;
        renderSubtitleCueList();
      } else {
        e.target.value = formatTime(cue.start, true);
      }
    });

    row.querySelector('[data-field="end"]').addEventListener('change', (e) => {
      const val = parseTimeInput(e.target.value);
      if (Number.isFinite(val) && val > cue.start) {
        cue.end = val;
        renderSubtitleCueList();
      } else {
        e.target.value = formatTime(cue.end, true);
      }
    });

    row.querySelector('[data-field="text"]').addEventListener('input', (e) => {
      cue.text = e.target.value;
      updateLiveSubtitleOverlay();
    });

    row.querySelector('[data-action="jump"]').addEventListener('click', () => {
      if (!state.videoUrl) {
        showToast('Upload a video in Studio to jump to this timestamp.', 'warning');
        return;
      }
      switchView('studio');
      el.mainVideo.currentTime = cue.start;
      syncBlurVideo(true);
      updateLiveSubtitleOverlay();
    });

    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      state.subtitles = state.subtitles.filter((c) => c.id !== cue.id);
      renderSubtitleCueList();
    });

    el.subtitleCueList.appendChild(row);
  });

  updateLiveSubtitleOverlay();
}

function generateCuesFromTranscriptText() {
  const raw = el.transcriptInput.value.trim();
  if (!raw) {
    showToast('Paste a transcript in the Studio AI panel first.', 'warning');
    return;
  }

  // First try standard SRT/VTT parsing
  const srtParsed = parseSrtOrVtt(raw);
  if (srtParsed.length) {
    state.subtitles = srtParsed;
    renderSubtitleCueList();
    showToast(`Imported ${srtParsed.length} timed subtitle cues from transcript.`, 'success');
    return;
  }

  // Next try [MM:SS] or MM:SS timestamped lines
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const tsRegex = /^\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]?\s*[-–:]?\s*(.+)$/;
  const timestamped = [];
  for (const line of lines) {
    const match = line.match(tsRegex);
    if (match) {
      const t = parseTimeInput(match[1]);
      if (Number.isFinite(t)) {
        timestamped.push({ time: t, text: match[2].trim() });
      }
    }
  }

  if (timestamped.length) {
    const cues = timestamped.map((item, i) => {
      const nextTime = timestamped[i + 1]?.time;
      const fallbackEnd = item.time + Math.max(2.5, Math.min(6, item.text.split(' ').length * 0.45));
      const end =
        Number.isFinite(nextTime) && nextTime > item.time
          ? Math.min(nextTime - 0.1, item.time + 7)
          : fallbackEnd;
      return {
        id: uid('cue'),
        start: item.time,
        end: Math.max(item.time + 1, end),
        text: item.text,
      };
    });
    state.subtitles = cues;
    renderSubtitleCueList();
    showToast(`Generated ${cues.length} subtitle cues from timestamped lines.`, 'success');
    return;
  }

  // Fallback: evenly distribute sentences across loaded video duration (or 4s per sentence)
  const sentences = raw.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) || [raw];
  const totalDur = state.duration > 0 ? state.duration : sentences.length * 4;
  const step = totalDur / sentences.length;
  state.subtitles = sentences.map((sentence, idx) => ({
    id: uid('cue'),
    start: Math.round(idx * step * 10) / 10,
    end: Math.round(Math.min(totalDur, (idx + 1) * step - 0.1) * 10) / 10,
    text: sentence,
  }));
  renderSubtitleCueList();
  showToast(`Created ${state.subtitles.length} evenly spaced cues. Adjust timings to match speech.`, 'info');
}

// ============================================================================
// AI Highlight Detection (Honest Transcript + Multimodal Keyframe Analysis)
// ============================================================================

function updateAiHonestyNote() {
  const transcriptLen = el.transcriptInput.value.trim().length;
  el.transcriptCharCount.textContent = `${transcriptLen.toLocaleString()} chars`;

  const hasTranscript = transcriptLen >= 12;
  const wantsFrames = el.sampleKeyframesToggle.checked;
  const hasVideo = Boolean(state.videoUrl && state.duration > 0);

  if (hasTranscript && wantsFrames && hasVideo) {
    el.aiInputHonestyNote.textContent =
      'Gemini will analyze both your timestamped transcript and up to 8 sampled visual keyframes from your video.';
  } else if (hasTranscript) {
    el.aiInputHonestyNote.textContent =
      'Gemini will analyze your text transcript and timestamps only (no video audio/pixels sent).';
  } else if (wantsFrames && hasVideo) {
    el.aiInputHonestyNote.textContent =
      'No transcript entered. Gemini will inspect up to 8 sampled visual frames from your video (visual cues only — audio speech is not analyzed without a transcript).';
  } else {
    el.aiInputHonestyNote.textContent =
      'Add a timestamped transcript or upload a video with Visual Keyframe Sampling enabled so Gemini has real data to analyze.';
  }
}

async function extractVideoKeyframes(maxFrames = 8) {
  if (!state.videoUrl || !state.duration || state.duration <= 0) return [];

  return new Promise((resolve) => {
    const tempVideo = document.createElement('video');
    tempVideo.src = state.videoUrl;
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'auto';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames = [];

    const cleanup = () => {
      tempVideo.pause();
      tempVideo.removeAttribute('src');
      tempVideo.load();
    };

    tempVideo.addEventListener(
      'error',
      () => {
        cleanup();
        resolve([]);
      },
      { once: true }
    );

    tempVideo.addEventListener(
      'loadeddata',
      async () => {
        const dur = tempVideo.duration || state.duration;
        const count = Math.min(maxFrames, Math.max(2, Math.floor(dur / 4) || 2));
        const targetW = 320;
        const ratio = tempVideo.videoHeight && tempVideo.videoWidth
          ? tempVideo.videoHeight / tempVideo.videoWidth
          : 9 / 16;
        canvas.width = targetW;
        canvas.height = Math.max(120, Math.round(targetW * ratio));

        const timestamps = [];
        for (let i = 0; i < count; i++) {
          const frac = count === 1 ? 0.5 : (i + 0.5) / count;
          timestamps.push(Math.round(clamp(dur * frac, 0.2, Math.max(0.2, dur - 0.2)) * 10) / 10);
        }

        for (const ts of timestamps) {
          try {
            await new Promise((resSeek, rejSeek) => {
              const timeout = setTimeout(() => rejSeek(new Error('seek timeout')), 3500);
              tempVideo.addEventListener(
                'seeked',
                () => {
                  clearTimeout(timeout);
                  resSeek();
                },
                { once: true }
              );
              tempVideo.currentTime = ts;
            });

            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.62);
            const base64 = dataUrl.split(',')[1];
            if (base64) {
              frames.push({ timestamp: ts, mimeType: 'image/jpeg', data: base64 });
            }
          } catch {
            // Skip frame if seek fails
          }
        }

        cleanup();
        resolve(frames);
      },
      { once: true }
    );
  });
}

async function findViralMoments() {
  if (state.isAnalyzing) return;

  const transcript = el.transcriptInput.value.trim();
  const wantsKeyframes = el.sampleKeyframesToggle.checked;
  const hasVideo = Boolean(state.videoUrl && state.duration > 0);

  if (transcript.length < 12 && !(wantsKeyframes && hasVideo)) {
    el.highlightsError.textContent =
      'Gemini cannot inspect an empty project. Paste a timestamped transcript (at least 12 characters) or upload a video with Visual Keyframe Sampling enabled.';
    el.highlightsError.classList.remove('is-hidden');
    showToast('Add a transcript or upload a video with keyframe sampling enabled.', 'warning');
    return;
  }

  state.isAnalyzing = true;
  el.btnFindHighlights.disabled = true;
  el.aiBtnSpinner.classList.remove('is-hidden');
  el.aiBtnLabel.textContent = wantsKeyframes && hasVideo ? 'SAMPLING VIDEO & ANALYZING...' : 'ANALYZING WITH GEMINI...';
  el.highlightsError.classList.add('is-hidden');
  el.highlightsLoading.classList.remove('is-hidden');

  try {
    let keyframes = [];
    if (wantsKeyframes && hasVideo) {
      keyframes = await extractVideoKeyframes(8);
    }

    el.aiBtnLabel.textContent = 'FINDING VIRAL MOMENTS...';

    const preferredDuration = state.durationPreset === 'custom' ? null : Number(state.durationPreset);
    const response = await fetch('/api/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'analyze',
        model: state.model,
        transcript,
        instructions: el.aiInstructionsInput.value.trim(),
        duration: state.duration || null,
        preferredDuration,
        videoMeta: state.videoFile
          ? {
              filename: state.videoFile.name,
              size: state.videoFile.size,
              width: state.videoWidth,
              height: state.videoHeight,
            }
          : {},
        keyframes,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const msg = data.error || `Request failed with HTTP ${response.status}.`;
      const details = data.details ? ` (${data.details})` : '';
      throw new Error(`${msg}${details}`);
    }

    const received = Array.isArray(data.highlights) ? data.highlights : [];
    state.highlights = received.map((h) => ({
      id: uid('hl'),
      start: Number(h.start) || 0,
      end: Number(h.end) || 30,
      title: h.title || 'Highlight Clip',
      reason: h.reason || '',
      score: Number(h.score) || 80,
    }));

    const modeLabel =
      data.meta?.analysisMode === 'transcript+keyframes'
        ? `Transcript + ${data.meta.keyframesAnalyzed} visual frames`
        : data.meta?.analysisMode === 'keyframes'
          ? `${data.meta.keyframesAnalyzed} visual frames only`
          : 'Transcript text only';

    el.highlightsMeta.textContent = `${state.highlights.length} clips · ${modeLabel} · ${data.meta?.model || state.model}`;
    renderHighlightsList();
    renderTimelineMarkers();

    if (state.highlights.length) {
      showToast(`Found ${state.highlights.length} viral clip candidates with Gemini.`, 'success');
    } else {
      showToast('Gemini completed analysis but did not find distinct highlights in the provided context.', 'warning');
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unable to reach /api/highlights.';
    el.highlightsError.textContent = errMsg;
    el.highlightsError.classList.remove('is-hidden');
    showToast(errMsg, 'error', 6000);
  } finally {
    state.isAnalyzing = false;
    el.btnFindHighlights.disabled = false;
    el.aiBtnSpinner.classList.add('is-hidden');
    el.aiBtnLabel.textContent = 'FIND VIRAL MOMENTS';
    el.highlightsLoading.classList.add('is-hidden');
  }
}

function renderHighlightsList() {
  if (!state.highlights.length) {
    el.highlightsList.innerHTML = `
      <div class="empty-state">
        <p>No AI highlights yet.</p>
        <p class="empty-state-sub">Provide a transcript or enable keyframe sampling on an uploaded video, then click <strong>FIND VIRAL MOMENTS</strong>.</p>
      </div>
    `;
    return;
  }

  el.highlightsList.innerHTML = '';

  state.highlights.forEach((hl) => {
    const dur = Math.max(0, hl.end - hl.start);
    const card = document.createElement('article');
    card.className = 'highlight-card';
    card.innerHTML = `
      <div class="highlight-card-top">
        <h4 class="highlight-title">${escapeHtml(hl.title)}</h4>
        <span class="highlight-score tabular">Score ${hl.score}/100</span>
      </div>
      <div class="highlight-meta tabular">
        <span>${escapeHtml(formatTime(hl.start, true))} &ndash; ${escapeHtml(formatTime(hl.end, true))}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${dur.toFixed(1)}s</span>
      </div>
      <p class="highlight-reason">${escapeHtml(hl.reason)}</p>
      <div class="highlight-actions">
        <button class="btn btn-primary btn-sm" type="button" data-action="preview">Preview</button>
        <button class="btn btn-secondary btn-sm" type="button" data-action="load">Load in Editor</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="queue">Queue</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="edit">Edit</button>
      </div>
    `;

    card.querySelector('[data-action="preview"]').addEventListener('click', () => {
      loadHighlightIntoEditor(hl, true);
    });

    card.querySelector('[data-action="load"]').addEventListener('click', () => {
      loadHighlightIntoEditor(hl, false);
      showToast(`Loaded "${hl.title}" into the Clip Editor.`, 'info');
    });

    card.querySelector('[data-action="queue"]').addEventListener('click', () => {
      addClipToQueue({
        title: hl.title,
        start: hl.start,
        end: hl.end,
        aspectRatio: state.aspectRatio,
        framing: state.framing,
        resolution: state.resolution,
        burnSubtitles: state.burnSubtitles,
      });
    });

    card.querySelector('[data-action="edit"]').addEventListener('click', () => {
      openEditHighlightModal(hl);
    });

    el.highlightsList.appendChild(card);
  });
}

function loadHighlightIntoEditor(hl, autoPlay = false) {
  el.clipTitleInput.value = hl.title;
  setClipRange(hl.start, hl.end, true);

  if (state.videoUrl) {
    el.mainVideo.currentTime = clamp(hl.start, 0, Math.max(0, state.duration - 0.1));
    syncBlurVideo(true);
    if (autoPlay) {
      state.previewStopAt = hl.end;
      el.mainVideo.play().catch(() => {});
    }
  } else if (autoPlay) {
    showToast('Upload the video file to preview this timestamp.', 'warning');
  }
}

function openEditHighlightModal(hl) {
  state.editingHighlightId = hl.id;
  el.editHlTitle.value = hl.title;
  el.editHlStart.value = String(hl.start);
  el.editHlEnd.value = String(hl.end);
  el.editHlReason.value = hl.reason;
  el.editModal.classList.remove('is-hidden');
  el.editHlTitle.focus();
}

function closeEditHighlightModal() {
  state.editingHighlightId = null;
  el.editModal.classList.add('is-hidden');
}

// ============================================================================
// Browser Live Dictation (Web Speech API where supported)
// ============================================================================

function toggleLiveDictation() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast(
      'Your browser does not support Web Speech API dictation. Import an SRT/VTT file or type timestamped notes instead.',
      'warning',
      5500
    );
    return;
  }

  if (state.isDictating && state.speechRecognition) {
    state.speechRecognition.stop();
    return;
  }

  const recognition = new SpeechRec();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = navigator.language || 'en-US';

  recognition.onstart = () => {
    state.isDictating = true;
    el.btnDictateTranscript.textContent = 'Stop Dictation';
    showToast('Live dictation started. Speak clearly into your microphone.', 'info');
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        const spoken = event.results[i][0]?.transcript?.trim();
        if (spoken) {
          const ts = formatTime(el.mainVideo.currentTime || 0, false);
          const prefix = el.transcriptInput.value.trim() ? '\n' : '';
          el.transcriptInput.value += `${prefix}[${ts}] ${spoken}`;
          updateAiHonestyNote();
        }
      }
    }
  };

  recognition.onerror = (event) => {
    showToast(`Dictation stopped: ${event.error || 'microphone unavailable'}.`, 'warning');
  };

  recognition.onend = () => {
    state.isDictating = false;
    state.speechRecognition = null;
    el.btnDictateTranscript.textContent = 'Live Dictate';
  };

  state.speechRecognition = recognition;
  try {
    recognition.start();
  } catch {
    state.isDictating = false;
    showToast('Could not start microphone dictation.', 'error');
  }
}

// ============================================================================
// FFmpeg.wasm Engine (Single-Threaded CDN + Blob Worker URL)
// ============================================================================

function loadExternalScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${url}`));
    document.head.appendChild(script);
  });
}

async function fetchToBlobURL(url, mimeType) {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} while downloading ${url}`);
  }
  const buf = await resp.arrayBuffer();
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
}

function updateFfmpegStatusUI(label, statusClass = 'status-neutral') {
  el.ffmpegMiniState.textContent = label;
  el.settingsFfmpegStatus.textContent = label;
  el.settingsFfmpegStatus.className = `status-text ${statusClass}`;
}

async function ensureFFmpegLoaded(onStage) {
  if (state.ffmpeg.loaded && state.ffmpeg.instance) {
    return state.ffmpeg.instance;
  }
  if (state.ffmpeg.loadingPromise) {
    return state.ffmpeg.loadingPromise;
  }

  state.ffmpeg.loadingPromise = (async () => {
    updateFfmpegStatusUI('Loading FFmpeg.wasm...', 'status-warn');
    let lastError = null;

    for (const cdn of FFMPEG_CDN_SOURCES) {
      try {
        onStage?.('Downloading FFmpeg.wasm runtime from CDN...', 8);
        if (!window.FFmpegWASM?.FFmpeg) {
          await loadExternalScript(cdn.ffmpegScript);
        }
        const FFmpegCtor = window.FFmpegWASM?.FFmpeg;
        if (!FFmpegCtor) {
          throw new Error('FFmpegWASM global was not initialized.');
        }

        const ffmpeg = new FFmpegCtor();
        ffmpeg.on('progress', ({ progress }) => {
          if (typeof state.ffmpeg.activeProgressCb === 'function' && Number.isFinite(progress)) {
            state.ffmpeg.activeProgressCb(clamp(progress, 0, 1));
          }
        });

        onStage?.('Preparing local WebAssembly core...', 22);
        const [classWorkerURL, coreURL, wasmURL] = await Promise.all([
          fetchToBlobURL(cdn.worker, 'text/javascript'),
          fetchToBlobURL(cdn.coreJs, 'text/javascript'),
          fetchToBlobURL(cdn.coreWasm, 'application/wasm'),
        ]);

        onStage?.('Initializing FFmpeg WebAssembly worker...', 38);
        await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });

        state.ffmpeg.instance = ffmpeg;
        state.ffmpeg.loaded = true;
        updateFfmpegStatusUI('Ready (Loaded)', 'status-ok');
        return ffmpeg;
      } catch (err) {
        lastError = err;
      }
    }

    updateFfmpegStatusUI('Load Failed', 'status-error');
    state.ffmpeg.loadingPromise = null;
    throw lastError || new Error('Could not load FFmpeg.wasm from CDN.');
  })();

  return state.ffmpeg.loadingPromise;
}

async function ensureSubtitleFontLoaded(ffmpeg) {
  if (!state.ffmpeg.fontBytes) {
    for (const cdn of FFMPEG_CDN_SOURCES) {
      try {
        const resp = await fetch(cdn.fontTtf, { mode: 'cors' });
        if (resp.ok) {
          state.ffmpeg.fontBytes = new Uint8Array(await resp.arrayBuffer());
          break;
        }
      } catch {
        // Try next mirror
      }
    }
  }
  if (!state.ffmpeg.fontBytes) {
    throw new Error('Subtitle font could not be downloaded from CDN.');
  }
  await ffmpeg.writeFile('font.ttf', state.ffmpeg.fontBytes);
}

function getOutputDimensions(aspectRatio, resolution) {
  const is1080 = resolution === '1080p';
  if (aspectRatio === '9:16') return is1080 ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
  if (aspectRatio === '1:1') return is1080 ? { w: 1080, h: 1080 } : { w: 720, h: 720 };
  return is1080 ? { w: 1920, h: 1080 } : { w: 1280, h: 720 };
}

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '\u2019')
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, ' ');
}

function wrapCaptionText(text, maxChars = 28) {
  const words = String(text || '').trim().split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function buildSubtitleDrawtextFilters(clip, outW, outH) {
  const activeCues = state.subtitles.filter(
    (c) => c.end > clip.start && c.start < clip.end && c.text.trim()
  );
  if (!activeCues.length) return [];

  const scaleFactor = outH / 720;
  const fontSize = Math.max(20, Math.round(state.subFontSize * scaleFactor));
  const lineGap = Math.round(fontSize * 1.28);
  const maxChars = clip.aspectRatio === '9:16' ? 22 : clip.aspectRatio === '1:1' ? 26 : 40;

  const keywords = state.subKeywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length >= 2);
  const highlightHex = (state.subColor || '#A78BFA').replace('#', '0x');

  const filters = [];

  for (const cue of activeCues) {
    const relStart = Math.max(0, cue.start - clip.start).toFixed(2);
    const relEnd = Math.min(clip.end - clip.start, cue.end - clip.start).toFixed(2);
    const lines = wrapCaptionText(cue.text, maxChars);

    lines.forEach((line, lineIdx) => {
      const lowerLine = line.toLowerCase();
      const hasKw = keywords.some((kw) => lowerLine.includes(kw));
      const fontColor = hasKw ? highlightHex : 'white';

      let yExpr;
      if (state.subPosition === 'top') {
        yExpr = `h*0.10+${lineIdx * lineGap}`;
      } else if (state.subPosition === 'middle') {
        const offset = Math.round((lineIdx - (lines.length - 1) / 2) * lineGap);
        yExpr = `(h-text_h)/2+${offset}`;
      } else {
        const fromBottom = (lines.length - 1 - lineIdx) * lineGap;
        yExpr = `h*0.86-text_h-${fromBottom}`;
      }

      const styleParts =
        state.subStyle === 'boxed'
          ? 'box=1:boxcolor=black@0.72:boxborderw=12:borderw=0'
          : state.subStyle === 'outline'
            ? 'borderw=4:bordercolor=black:shadowx=0:shadowy=3:shadowcolor=black@0.85'
            : 'borderw=2:bordercolor=black@0.9:shadowx=0:shadowy=2:shadowcolor=black@0.8';

      filters.push(
        `drawtext=fontfile=font.ttf:text='${escapeDrawtext(line)}':fontcolor=${fontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=${yExpr}:${styleParts}:enable='between(t,${relStart},${relEnd})'`
      );
    });
  }

  return filters;
}

async function renderClipWithFFmpeg(clip, progressUi) {
  if (!state.videoFile) {
    throw new Error('Upload a video file before exporting.');
  }
  const clipDuration = clip.end - clip.start;
  if (!Number.isFinite(clipDuration) || clipDuration < 0.5) {
    throw new Error('Clip duration must be at least 0.5 seconds.');
  }

  const updateProgress = (stage, pct) => {
    const safePct = clamp(Math.round(pct), 0, 100);
    progressUi.box.classList.remove('is-hidden');
    progressUi.stage.textContent = stage;
    progressUi.percent.textContent = `${safePct}%`;
    progressUi.fill.style.width = `${safePct}%`;
  };

  const ffmpeg = await ensureFFmpegLoaded(updateProgress);

  const extMatch = (state.videoFile.name || '').match(/\.(mp4|mov|webm)$/i);
  const inputName = `input${extMatch ? extMatch[0].toLowerCase() : '.mp4'}`;
  const outputName = `output_${Date.now()}.mp4`;

  updateProgress('Loading video into browser memory...', 42);
  const inputBytes = new Uint8Array(await state.videoFile.arrayBuffer());
  await ffmpeg.writeFile(inputName, inputBytes);

  const { w, h } = getOutputDimensions(clip.aspectRatio, clip.resolution);

  let subtitleFilters = [];
  if (clip.burnSubtitles && state.subtitles.length > 0) {
    try {
      updateProgress('Loading caption font for subtitle burn-in...', 46);
      await ensureSubtitleFontLoaded(ffmpeg);
      subtitleFilters = buildSubtitleDrawtextFilters(clip, w, h);
    } catch {
      subtitleFilters = [];
      showToast('Caption font could not be loaded for burn-in. Exporting clean MP4 instead.', 'warning');
    }
  }

  const runEncode = async (includeSubtitles) => {
    const activeSubFilters = includeSubtitles ? subtitleFilters : [];
    const subChain = activeSubFilters.length ? `,${activeSubFilters.join(',')}` : '';

    const args = ['-ss', clip.start.toFixed(2), '-t', clipDuration.toFixed(2), '-i', inputName];

    if (clip.framing === 'blur') {
      const filterComplex = `[0:v]split=2[bg][fg];[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:5[bgb];[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1${subChain}[vout]`;
      args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '0:a?');
    } else {
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1${subChain}`;
      args.push('-vf', vf);
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-y',
      outputName
    );

    state.ffmpeg.activeProgressCb = (ratio) => {
      updateProgress(`Encoding ${clip.aspectRatio} ${clip.resolution} MP4...`, 48 + ratio * 48);
    };

    const exitCode = await ffmpeg.exec(args);
    state.ffmpeg.activeProgressCb = null;
    return exitCode;
  };

  let exitCode = await runEncode(subtitleFilters.length > 0);
  if (exitCode !== 0 && subtitleFilters.length > 0) {
    showToast('Subtitle burn-in failed on this codec; retrying clean MP4 export.', 'warning');
    exitCode = await runEncode(false);
  }

  if (exitCode !== 0) {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    throw new Error(`FFmpeg exited with error code ${exitCode}. Try 720p or a shorter clip.`);
  }

  updateProgress('Finalizing MP4 file...', 97);
  const outData = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  const mp4Blob = new Blob([outData.buffer], { type: 'video/mp4' });
  const mp4Url = URL.createObjectURL(mp4Blob);
  const filename = slugifyFilename(clip.title, 'mp4');

  const exported = {
    id: uid('exp'),
    title: clip.title,
    filename,
    url: mp4Url,
    size: mp4Blob.size,
    duration: clipDuration,
    aspectRatio: clip.aspectRatio,
    framing: clip.framing,
    resolution: clip.resolution,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  state.exports.unshift(exported);
  renderCompletedExports();
  updateProgress('Export complete!', 100);
  triggerDownload(mp4Url, filename);
  return exported;
}

// ============================================================================
// Clip Queue & Batch Export
// ============================================================================

function getEditorClipConfig() {
  return {
    id: uid('q'),
    title: el.clipTitleInput.value.trim() || `Clip ${state.queue.length + 1}`,
    start: state.clipStart,
    end: state.clipEnd,
    aspectRatio: state.aspectRatio,
    framing: state.framing,
    resolution: state.resolution,
    burnSubtitles: state.burnSubtitles,
  };
}

function addClipToQueue(clipConfig) {
  if (!state.videoFile) {
    showToast('Upload a video before adding clips to the queue.', 'warning');
    return;
  }
  const item = { ...clipConfig, id: clipConfig.id || uid('q') };
  state.queue.push(item);
  renderQueueList();
  showToast(`Added "${item.title}" to Export Queue.`, 'success');
}

function renderQueueList() {
  el.navQueueCount.textContent = String(state.queue.length);
  el.btnExportAll.disabled = state.queue.length === 0 || state.isExporting;
  el.btnClearQueue.disabled = state.queue.length === 0 || state.isExporting;

  if (!state.queue.length) {
    el.queueList.innerHTML = `
      <div class="empty-state">
        <p>Your export queue is empty.</p>
        <p class="empty-state-sub">Add clips from the Studio editor or AI highlight cards to batch-export multiple MP4 files.</p>
      </div>
    `;
    return;
  }

  el.queueList.innerHTML = '';
  state.queue.forEach((clip) => {
    const dur = Math.max(0, clip.end - clip.start);
    const card = document.createElement('div');
    card.className = 'queue-card';
    card.innerHTML = `
      <div class="queue-card-header">
        <span class="queue-card-title">${escapeHtml(clip.title)}</span>
        <span class="inline-meta tabular">${escapeHtml(formatTime(clip.start, true))} &ndash; ${escapeHtml(formatTime(clip.end, true))} (${dur.toFixed(1)}s)</span>
      </div>
      <div class="highlight-meta tabular">
        <span>${escapeHtml(clip.aspectRatio)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${clip.framing === 'blur' ? 'Blur Background' : 'Center Crop'}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${escapeHtml(clip.resolution)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${clip.burnSubtitles ? 'Burn Subtitles' : 'No Subtitles'}</span>
      </div>
      <div class="highlight-actions">
        <button class="btn btn-primary btn-sm" type="button" data-action="export">Export MP4</button>
        <button class="btn btn-secondary btn-sm" type="button" data-action="edit">Load in Studio</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="remove">Remove</button>
      </div>
    `;

    card.querySelector('[data-action="export"]').addEventListener('click', async () => {
      if (state.isExporting) return;
      await runSingleQueueExport(clip);
    });

    card.querySelector('[data-action="edit"]').addEventListener('click', () => {
      el.clipTitleInput.value = clip.title;
      state.aspectRatio = clip.aspectRatio;
      state.framing = clip.framing;
      state.resolution = clip.resolution;
      state.burnSubtitles = clip.burnSubtitles;
      syncSegmentedButtons('[data-aspect]', state.aspectRatio, 'aspect');
      syncSegmentedButtons('[data-framing]', state.framing, 'framing');
      syncSegmentedButtons('[data-resolution]', state.resolution, 'resolution');
      el.burnSubtitlesToggle.checked = state.burnSubtitles;
      el.subtitlesBurnSync.checked = state.burnSubtitles;
      updateStagePreviewAttributes();
      setClipRange(clip.start, clip.end, true);
      switchView('studio');
      showToast(`Loaded "${clip.title}" into Studio.`, 'info');
    });

    card.querySelector('[data-action="remove"]').addEventListener('click', () => {
      state.queue = state.queue.filter((item) => item.id !== clip.id);
      renderQueueList();
    });

    el.queueList.appendChild(card);
  });
}

function renderCompletedExports() {
  el.completedExportsCount.textContent = `${state.exports.length} ${state.exports.length === 1 ? 'file' : 'files'}`;
  if (!state.exports.length) {
    el.exportsList.innerHTML = `
      <div class="empty-state">
        <p>No exported clips yet.</p>
        <p class="empty-state-sub">Rendered MP4 files appear here with instant playback and one-click download.</p>
      </div>
    `;
    return;
  }

  el.exportsList.innerHTML = '';
  state.exports.forEach((exp) => {
    const card = document.createElement('div');
    card.className = 'export-card';
    card.innerHTML = `
      <div class="queue-card-header">
        <span class="queue-card-title truncate">${escapeHtml(exp.filename)}</span>
        <span class="inline-meta tabular">${escapeHtml(formatBytes(exp.size))}</span>
      </div>
      <div class="highlight-meta tabular">
        <span>${exp.duration.toFixed(1)}s</span>
        <span aria-hidden="true">&middot;</span>
        <span>${escapeHtml(exp.aspectRatio)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${escapeHtml(exp.resolution)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${escapeHtml(exp.createdAt)}</span>
      </div>
      <video controls playsinline preload="metadata" src="${exp.url}"></video>
      <div class="highlight-actions">
        <button class="btn btn-primary btn-sm" type="button" data-action="download">Download MP4</button>
      </div>
    `;
    card.querySelector('[data-action="download"]').addEventListener('click', () => {
      triggerDownload(exp.url, exp.filename);
    });
    el.exportsList.appendChild(card);
  });
}

async function runSingleQueueExport(clip) {
  state.isExporting = true;
  el.btnExportClip.disabled = true;
  renderQueueList();
  try {
    await renderClipWithFFmpeg(clip, {
      box: el.queueProgressBox,
      stage: el.queueStageLabel,
      percent: el.queuePercentLabel,
      fill: el.queueProgressFill,
    });
    showToast(`Exported "${clip.title}" as MP4.`, 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Export failed.', 'error', 6000);
  } finally {
    state.isExporting = false;
    el.btnExportClip.disabled = false;
    renderQueueList();
  }
}

async function exportAllQueuedClips() {
  if (state.isExporting || !state.queue.length) return;
  if (!state.videoFile) {
    showToast('Upload the source video in Studio before batch exporting.', 'warning');
    return;
  }

  state.isExporting = true;
  el.btnExportClip.disabled = true;
  renderQueueList();

  let successCount = 0;
  try {
    for (let i = 0; i < state.queue.length; i++) {
      const clip = state.queue[i];
      el.queueStageLabel.textContent = `Clip ${i + 1} of ${state.queue.length}: ${clip.title}`;
      await renderClipWithFFmpeg(clip, {
        box: el.queueProgressBox,
        stage: el.queueStageLabel,
        percent: el.queuePercentLabel,
        fill: el.queueProgressFill,
      });
      successCount++;
    }
    showToast(`Batch export finished (${successCount} MP4 files downloaded).`, 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Batch export interrupted.', 'error', 6000);
  } finally {
    state.isExporting = false;
    el.btnExportClip.disabled = false;
    renderQueueList();
  }
}

// ============================================================================
// Live Clipper (Browser Media Capture + 120s Rolling Replay Buffer)
// ============================================================================

function pickSupportedRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

/**
 * Locate the first EBML Cluster ID (0x1F 0x43 0xB6 0x75) inside a WebM init chunk
 * so rolling replays prepend only the pure container header before recent clusters.
 */
function extractWebmHeaderBytes(uint8) {
  for (let i = 0; i < uint8.length - 4; i++) {
    if (
      uint8[i] === 0x1f &&
      uint8[i + 1] === 0x43 &&
      uint8[i + 2] === 0xb6 &&
      uint8[i + 3] === 0x75
    ) {
      return uint8.slice(0, i);
    }
  }
  return null;
}

function setLiveButtonsState(active) {
  el.btnLiveStop.disabled = !active;
  document.querySelectorAll('[data-live-seconds]').forEach((btn) => {
    btn.disabled = !active;
  });
}

async function startLiveCapture(mode) {
  if (state.live.active) {
    stopLiveCapture();
  }

  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
    showToast('Live browser capture is not supported in this browser.', 'error');
    return;
  }

  try {
    let stream;
    if (mode === 'screen') {
      if (!navigator.mediaDevices.getDisplayMedia) {
        showToast('Screen and browser tab capture is unavailable in this browser.', 'warning');
        return;
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });
      state.live.sourceLabel = 'Screen / Browser Tab Capture';
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      state.live.sourceLabel = 'Camera & Microphone Capture';
    }

    const mimeType = pickSupportedRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 })
      : new MediaRecorder(stream);

    state.live.stream = stream;
    state.live.recorder = recorder;
    state.live.mimeType = recorder.mimeType || mimeType || 'video/webm';
    state.live.headerBytes = null;
    state.live.chunks = [];
    state.live.active = true;
    state.live.startedAt = Date.now();

    el.livePreviewVideo.srcObject = stream;
    el.liveEmptyState.classList.add('is-hidden');
    el.liveStatusText.textContent = 'Recording rolling buffer';
    el.liveSourceLabel.textContent = state.live.sourceLabel;
    setLiveButtonsState(true);

    recorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size === 0) return;
      const now = Date.now();

      if (!state.live.headerBytes && state.live.chunks.length === 0) {
        try {
          const arr = new Uint8Array(await event.data.arrayBuffer());
          state.live.headerBytes = extractWebmHeaderBytes(arr);
        } catch {
          state.live.headerBytes = null;
        }
      }

      state.live.chunks.push({ ts: now, blob: event.data });

      // Maintain rolling 120-second window (keep 2s cushion)
      const cutoff = now - (MAX_LIVE_BUFFER_SEC + 2) * 1000;
      while (state.live.chunks.length > 1 && state.live.chunks[0].ts < cutoff) {
        state.live.chunks.shift();
      }
    };

    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (state.live.active) {
          stopLiveCapture();
          showToast('Capture source ended by browser.', 'info');
        }
      });
    });

    recorder.start(1000);

    state.live.timerId = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - state.live.startedAt) / 1000);
      const bufferedSec = Math.min(MAX_LIVE_BUFFER_SEC, state.live.chunks.length);
      el.liveBufferReadout.textContent = `Buffer: ${bufferedSec}s / ${MAX_LIVE_BUFFER_SEC}s · Live ${formatTime(elapsedSec)}`;
      el.liveBufferFill.style.width = `${clamp((bufferedSec / MAX_LIVE_BUFFER_SEC) * 100, 0, 100)}%`;
    }, 500);

    showToast(`Started ${state.live.sourceLabel}. Rolling 120s buffer is active.`, 'success');
  } catch (err) {
    if (err && err.name === 'NotAllowedError') {
      showToast('Capture permission was cancelled or denied.', 'warning');
    } else {
      showToast(`Unable to start capture: ${err?.message || 'Permission denied'}`, 'error');
    }
  }
}

function stopLiveCapture() {
  if (state.live.timerId) {
    clearInterval(state.live.timerId);
    state.live.timerId = null;
  }
  if (state.live.recorder && state.live.recorder.state !== 'inactive') {
    try {
      state.live.recorder.stop();
    } catch {
      // Ignore stop race
    }
  }
  if (state.live.stream) {
    state.live.stream.getTracks().forEach((t) => t.stop());
  }

  state.live.stream = null;
  state.live.recorder = null;
  state.live.active = false;

  el.livePreviewVideo.srcObject = null;
  el.liveEmptyState.classList.remove('is-hidden');
  el.liveStatusText.textContent = 'Capture stopped';
  setLiveButtonsState(false);
}

function saveLiveReplayClip(seconds) {
  if (!state.live.chunks.length) {
    showToast('Wait a few seconds for the rolling buffer to record frames first.', 'warning');
    return;
  }

  const now = Date.now();
  const cutoff = now - seconds * 1000;
  const recentChunks = state.live.chunks.filter((c) => c.ts >= cutoff);
  const selected = recentChunks.length ? recentChunks : state.live.chunks;

  const isTrimmedFromStart = selected[0] !== state.live.chunks[0];
  const parts = [];
  if (isTrimmedFromStart && state.live.headerBytes) {
    parts.push(state.live.headerBytes);
  }
  selected.forEach((c) => parts.push(c.blob));

  const blob = new Blob(parts, { type: state.live.mimeType || 'video/webm' });
  const url = URL.createObjectURL(blob);
  const actualSeconds = Math.min(seconds, selected.length);
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const filename = `zeroclip-live-${actualSeconds}s-${Date.now()}.webm`;

  state.live.clips.unshift({
    id: uid('live'),
    filename,
    blob,
    url,
    size: blob.size,
    seconds: actualSeconds,
    timestamp,
    source: state.live.sourceLabel,
  });

  renderLiveClipsList();
  showToast(`Saved last ${actualSeconds}s live replay clip.`, 'success');
}

function renderLiveClipsList() {
  const count = state.live.clips.length;
  el.liveClipsCount.textContent = `${count} ${count === 1 ? 'clip' : 'clips'}`;

  if (!count) {
    el.liveClipsList.innerHTML = `
      <div class="empty-state">
        <p>No live clips saved yet.</p>
        <p class="empty-state-sub">Start a screen, tab, or camera capture and press one of the instant replay buttons to save the last 30s&ndash;120s.</p>
      </div>
    `;
    return;
  }

  el.liveClipsList.innerHTML = '';
  state.live.clips.forEach((clip) => {
    const card = document.createElement('div');
    card.className = 'export-card';
    card.innerHTML = `
      <div class="queue-card-header">
        <span class="queue-card-title truncate">${escapeHtml(clip.filename)}</span>
        <span class="inline-meta tabular">${escapeHtml(formatBytes(clip.size))}</span>
      </div>
      <div class="highlight-meta tabular">
        <span>~${clip.seconds}s capture</span>
        <span aria-hidden="true">&middot;</span>
        <span>${escapeHtml(clip.source)}</span>
        <span aria-hidden="true">&middot;</span>
        <span>${escapeHtml(clip.timestamp)}</span>
      </div>
      <video controls playsinline preload="metadata" src="${clip.url}"></video>
      <div class="highlight-actions">
        <button class="btn btn-primary btn-sm" type="button" data-action="download">Download WebM</button>
        <button class="btn btn-secondary btn-sm" type="button" data-action="studio">Edit in Studio</button>
      </div>
    `;

    card.querySelector('[data-action="download"]').addEventListener('click', () => {
      triggerDownload(clip.url, clip.filename);
    });

    card.querySelector('[data-action="studio"]').addEventListener('click', () => {
      loadVideoFile(clip.blob, clip.filename);
      switchView('studio');
    });

    el.liveClipsList.appendChild(card);
  });
}

// ============================================================================
// Settings: Gemini API Test & Browser Capability Checks
// ============================================================================

async function testGeminiConnection() {
  el.btnTestGemini.disabled = true;
  el.btnTestGemini.textContent = 'Testing...';
  el.settingsGeminiStatus.textContent = 'Testing...';
  el.settingsGeminiStatus.className = 'status-text status-warn';
  el.settingsApiOutput.className = 'diagnostic-box';
  el.settingsApiOutput.textContent = `Sending test POST request to /api/highlights for model "${state.model}"...`;

  try {
    const resp = await fetch('/api/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', model: state.model }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok) {
      el.settingsGeminiStatus.textContent = 'Connection Error';
      el.settingsGeminiStatus.className = 'status-text status-error';
      el.settingsApiOutput.className = 'diagnostic-box is-error';
      const detailText = data.details ? ` Details: ${data.details}` : '';
      el.settingsApiOutput.textContent = `HTTP ${resp.status} (${data.code || 'ERROR'}): ${data.error || 'Failed to connect to Gemini API.'}${detailText}`;
      showToast(data.error || 'Gemini API test failed.', 'error', 5500);
      return;
    }

    el.settingsGeminiStatus.textContent = 'Connected';
    el.settingsGeminiStatus.className = 'status-text status-ok';
    el.settingsApiOutput.className = 'diagnostic-box is-ok';
    el.settingsApiOutput.textContent = `${data.message} Response latency: ${data.latencyMs} ms.`;
    showToast(`Gemini API connected (${data.model}, ${data.latencyMs} ms).`, 'success');
  } catch (err) {
    el.settingsGeminiStatus.textContent = 'Unreachable';
    el.settingsGeminiStatus.className = 'status-text status-error';
    el.settingsApiOutput.className = 'diagnostic-box is-error';
    el.settingsApiOutput.textContent = `Could not reach /api/highlights (${err?.message || 'Network error'}). Ensure the project is deployed on Vercel or running with the /api/highlights server route.`;
    showToast('Could not reach /api/highlights endpoint.', 'error');
  } finally {
    el.btnTestGemini.disabled = false;
    el.btnTestGemini.textContent = 'Test Gemini API';
  }
}

function detectBrowserCapabilities() {
  el.capWasm.textContent = typeof WebAssembly === 'object' ? 'Supported' : 'Unsupported';
  el.capDisplay.textContent =
    navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'
      ? 'Supported'
      : 'Unavailable';
  el.capRecorder.textContent = typeof MediaRecorder !== 'undefined' ? 'Supported' : 'Unavailable';
  el.capSpeech.textContent =
    window.SpeechRecognition || window.webkitSpeechRecognition ? 'Supported' : 'Unavailable in this browser';
}

// ============================================================================
// Timeline Dragging & Seeking
// ============================================================================

function initTimelineInteractions() {
  let dragMode = null; // 'seek' | 'in' | 'out'

  const pointerToTime = (clientX) => {
    const rect = el.timelineTrack.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const maxDur = state.duration > 0 ? state.duration : Math.max(state.clipEnd, 60);
    return ratio * maxDur;
  };

  el.handleIn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragMode = 'in';
    el.handleIn.setPointerCapture(e.pointerId);
  });

  el.handleOut.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragMode = 'out';
    el.handleOut.setPointerCapture(e.pointerId);
  });

  el.timelineTrack.addEventListener('pointerdown', (e) => {
    if (e.target === el.handleIn || e.target === el.handleOut) return;
    if (!state.videoUrl) return;
    dragMode = 'seek';
    el.timelineTrack.setPointerCapture(e.pointerId);
    const t = pointerToTime(e.clientX);
    state.previewStopAt = null;
    el.mainVideo.currentTime = t;
    syncBlurVideo(true);
    updateTimelineVisuals();
  });

  const handleMove = (e) => {
    if (!dragMode) return;
    const t = pointerToTime(e.clientX);
    if (dragMode === 'seek' && state.videoUrl) {
      el.mainVideo.currentTime = t;
      syncBlurVideo(true);
      updateTimelineVisuals();
    } else if (dragMode === 'in') {
      const nextStart = Math.min(t, state.clipEnd - 1);
      setClipRange(nextStart, state.clipEnd, true);
    } else if (dragMode === 'out') {
      const nextEnd = Math.max(t, state.clipStart + 1);
      setClipRange(state.clipStart, nextEnd, true);
    }
  };

  const handleUp = () => {
    dragMode = null;
  };

  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);

  el.timelineTrack.addEventListener('keydown', (e) => {
    if (!state.videoUrl) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      el.mainVideo.currentTime = Math.max(0, el.mainVideo.currentTime - 2);
      syncBlurVideo(true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      el.mainVideo.currentTime = Math.min(state.duration, el.mainVideo.currentTime + 2);
      syncBlurVideo(true);
    }
  });
}

// ============================================================================
// Event Bindings & Bootstrap
// ============================================================================

function bindEvents() {
  // Navigation
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.querySelector('[data-nav-reset]')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchView('studio');
  });
  el.btnOpenSidebar.addEventListener('click', openMobileSidebar);
  el.btnCloseSidebar.addEventListener('click', closeMobileSidebar);
  el.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Upload triggers
  const openVideoPicker = () => {
    el.videoFileInput.value = '';
    el.videoFileInput.click();
  };
  el.btnHeaderUpload.addEventListener('click', () => {
    switchView('studio');
    openVideoPicker();
  });
  el.btnDropzoneBrowse.addEventListener('click', (e) => {
    e.stopPropagation();
    openVideoPicker();
  });
  el.uploadDropzone.addEventListener('click', openVideoPicker);
  el.uploadDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openVideoPicker();
    }
  });
  el.btnStageUpload.addEventListener('click', openVideoPicker);
  el.btnReplaceVideo.addEventListener('click', openVideoPicker);
  el.btnClearVideo.addEventListener('click', clearLoadedVideo);

  el.videoFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadVideoFile(file);
  });

  // Drag & Drop Upload
  ['dragenter', 'dragover'].forEach((evt) => {
    el.uploadDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.uploadDropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    el.uploadDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.uploadDropzone.classList.remove('is-dragover');
    });
  });
  el.uploadDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadVideoFile(file);
  });

  // Main Video Metadata & Playback Sync
  el.mainVideo.addEventListener('loadedmetadata', () => {
    state.duration = Number.isFinite(el.mainVideo.duration) ? el.mainVideo.duration : 0;
    state.videoWidth = el.mainVideo.videoWidth || 0;
    state.videoHeight = el.mainVideo.videoHeight || 0;

    el.mediaDuration.textContent = formatTime(state.duration);
    el.mediaDimensions.textContent =
      state.videoWidth && state.videoHeight ? `${state.videoWidth}×${state.videoHeight}` : '—';
    el.timecodeTotal.textContent = formatTime(state.duration, true);
    el.sidebarMediaSpecs.textContent = `${formatTime(state.duration)} · ${formatBytes(state.videoFile?.size || 0)}`;

    const initialEnd = state.duration > 0 ? Math.min(state.duration, 30) : 30;
    setClipRange(0, initialEnd, false);
    renderTimelineMarkers();
    updateAiHonestyNote();
  });

  el.mainVideo.addEventListener('timeupdate', () => {
    const current = el.mainVideo.currentTime || 0;
    el.timecodeCurrent.textContent = formatTime(current, true);
    updateTimelineVisuals();
    updateLiveSubtitleOverlay();
    syncBlurVideo(false);

    if (state.previewStopAt !== null && current >= state.previewStopAt) {
      el.mainVideo.pause();
      state.previewStopAt = null;
    }
  });

  el.mainVideo.addEventListener('play', () => {
    el.btnPlayPause.textContent = 'Pause';
    syncBlurVideo(true);
  });

  el.mainVideo.addEventListener('pause', () => {
    el.btnPlayPause.textContent = 'Play';
    syncBlurVideo(false);
  });

  el.mainVideo.addEventListener('seeked', () => syncBlurVideo(true));
  el.mainVideo.addEventListener('ratechange', () => syncBlurVideo(false));

  // Transport Buttons
  el.btnPlayPause.addEventListener('click', () => {
    if (!state.videoUrl) return;
    state.previewStopAt = null;
    if (el.mainVideo.paused) {
      el.mainVideo.play().catch(() => {});
    } else {
      el.mainVideo.pause();
    }
  });

  el.btnStepBack.addEventListener('click', () => {
    if (!state.videoUrl) return;
    el.mainVideo.currentTime = Math.max(0, el.mainVideo.currentTime - 5);
    syncBlurVideo(true);
  });

  el.btnStepForward.addEventListener('click', () => {
    if (!state.videoUrl) return;
    el.mainVideo.currentTime = Math.min(state.duration, el.mainVideo.currentTime + 5);
    syncBlurVideo(true);
  });

  el.btnPreviewRange.addEventListener('click', () => {
    if (!state.videoUrl) return;
    el.mainVideo.currentTime = state.clipStart;
    state.previewStopAt = state.clipEnd;
    syncBlurVideo(true);
    el.mainVideo.play().catch(() => {});
  });

  el.btnMute.addEventListener('click', () => {
    el.mainVideo.muted = !el.mainVideo.muted;
    el.btnMute.textContent = el.mainVideo.muted ? 'Unmute' : 'Mute';
  });

  el.volumeSlider.addEventListener('input', (e) => {
    el.mainVideo.volume = Number(e.target.value);
    if (el.mainVideo.volume > 0 && el.mainVideo.muted) {
      el.mainVideo.muted = false;
      el.btnMute.textContent = 'Mute';
    }
  });

  el.playbackSpeed.addEventListener('change', (e) => {
    el.mainVideo.playbackRate = Number(e.target.value);
    syncBlurVideo(false);
  });

  el.btnSetIn.addEventListener('click', () => {
    const t = el.mainVideo.currentTime || 0;
    const end = state.clipEnd > t + 0.5 ? state.clipEnd : Math.min(state.duration || t + 30, t + 30);
    setClipRange(t, end, true);
  });

  el.btnSetOut.addEventListener('click', () => {
    const t = el.mainVideo.currentTime || 0;
    const start = state.clipStart < t - 0.5 ? state.clipStart : Math.max(0, t - 15);
    setClipRange(start, t, true);
  });

  // Clip Editor Inputs & Presets
  el.clipStartInput.addEventListener('change', () => {
    const parsed = parseTimeInput(el.clipStartInput.value);
    if (Number.isFinite(parsed)) {
      setClipRange(parsed, Math.max(parsed + 1, state.clipEnd), true);
    } else {
      el.clipStartInput.value = formatTime(state.clipStart, true);
    }
  });

  el.clipEndInput.addEventListener('change', () => {
    const parsed = parseTimeInput(el.clipEndInput.value);
    if (Number.isFinite(parsed) && parsed > state.clipStart) {
      setClipRange(state.clipStart, parsed, true);
    } else {
      el.clipEndInput.value = formatTime(state.clipEnd, true);
    }
  });

  document.querySelectorAll('[data-duration]').forEach((btn) => {
    btn.addEventListener('click', () => applyDurationPreset(btn.dataset.duration));
  });

  document.querySelectorAll('[data-aspect]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.aspectRatio = btn.dataset.aspect;
      syncSegmentedButtons('[data-aspect]', state.aspectRatio, 'aspect');
      updateStagePreviewAttributes();
    });
  });

  document.querySelectorAll('[data-framing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.framing = btn.dataset.framing;
      syncSegmentedButtons('[data-framing]', state.framing, 'framing');
      updateStagePreviewAttributes();
    });
  });

  document.querySelectorAll('[data-resolution]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.resolution = btn.dataset.resolution;
      syncSegmentedButtons('[data-resolution]', state.resolution, 'resolution');
      updateStagePreviewAttributes();
    });
  });

  const syncBurnToggle = (checked) => {
    state.burnSubtitles = checked;
    el.burnSubtitlesToggle.checked = checked;
    el.subtitlesBurnSync.checked = checked;
  };
  el.burnSubtitlesToggle.addEventListener('change', (e) => syncBurnToggle(e.target.checked));
  el.subtitlesBurnSync.addEventListener('change', (e) => syncBurnToggle(e.target.checked));

  el.btnAddQueue.addEventListener('click', () => {
    addClipToQueue(getEditorClipConfig());
  });

  el.btnExportClip.addEventListener('click', async () => {
    if (state.isExporting) return;
    if (!state.videoFile) {
      showToast('Upload a video file first before exporting.', 'warning');
      return;
    }
    state.isExporting = true;
    el.btnExportClip.disabled = true;
    renderQueueList();

    try {
      const clip = getEditorClipConfig();
      const exported = await renderClipWithFFmpeg(clip, {
        box: el.exportProgressBox,
        stage: el.exportStageLabel,
        percent: el.exportPercentLabel,
        fill: el.exportProgressFill,
      });
      showToast(`Exported "${exported.filename}" (${formatBytes(exported.size)}).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'MP4 export failed.', 'error', 6000);
    } finally {
      state.isExporting = false;
      el.btnExportClip.disabled = false;
      renderQueueList();
    }
  });

  // AI Highlight Panel Controls
  el.transcriptInput.addEventListener('input', updateAiHonestyNote);
  el.sampleKeyframesToggle.addEventListener('change', updateAiHonestyNote);

  el.btnInsertTimestamp.addEventListener('click', () => {
    const ts = `[${formatTime(el.mainVideo.currentTime || 0, false)}] `;
    const area = el.transcriptInput;
    const pos = area.selectionStart ?? area.value.length;
    const needsNewline = pos > 0 && area.value[pos - 1] !== '\n';
    const insertion = (needsNewline ? '\n' : '') + ts;
    area.value = area.value.slice(0, pos) + insertion + area.value.slice(area.selectionEnd ?? pos);
    area.focus();
    const nextPos = pos + insertion.length;
    area.setSelectionRange(nextPos, nextPos);
    updateAiHonestyNote();
  });

  const openTranscriptPicker = () => {
    el.transcriptFileInput.value = '';
    el.transcriptFileInput.click();
  };
  el.btnImportTranscript.addEventListener('click', openTranscriptPicker);
  el.btnSubImportSrt.addEventListener('click', openTranscriptPicker);

  el.transcriptFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const cues = parseSrtOrVtt(text);
    if (cues.length) {
      state.subtitles = cues;
      renderSubtitleCueList();
      el.transcriptInput.value = cues.map((c) => `[${formatTime(c.start)}] ${c.text}`).join('\n');
      showToast(`Imported ${cues.length} caption cues from "${file.name}".`, 'success');
    } else {
      el.transcriptInput.value = text.trim();
      showToast(`Loaded transcript text from "${file.name}".`, 'success');
    }
    updateAiHonestyNote();
  });

  el.btnDictateTranscript.addEventListener('click', toggleLiveDictation);
  el.btnFindHighlights.addEventListener('click', findViralMoments);

  // Edit Highlight Modal
  el.btnCloseEditModal.addEventListener('click', closeEditHighlightModal);
  el.btnCancelEditModal.addEventListener('click', closeEditHighlightModal);
  el.editModal.addEventListener('click', (e) => {
    if (e.target === el.editModal) closeEditHighlightModal();
  });
  el.editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const hl = state.highlights.find((item) => item.id === state.editingHighlightId);
    if (!hl) return;
    const start = Number(el.editHlStart.value);
    const end = Number(el.editHlEnd.value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      showToast('End time must be greater than start time.', 'warning');
      return;
    }
    hl.title = el.editHlTitle.value.trim() || hl.title;
    hl.start = Math.max(0, Math.round(start * 10) / 10);
    hl.end = Math.round(end * 10) / 10;
    hl.reason = el.editHlReason.value.trim();
    renderHighlightsList();
    renderTimelineMarkers();
    closeEditHighlightModal();
    showToast('Highlight updated.', 'success');
  });

  // Subtitles View Controls
  el.btnAddCue.addEventListener('click', () => {
    const start = Math.round((el.mainVideo.currentTime || 0) * 10) / 10;
    const end = Math.round((start + 3) * 10) / 10;
    state.subtitles.push({ id: uid('cue'), start, end, text: 'New caption text' });
    renderSubtitleCueList();
  });

  el.btnSubFromTranscript.addEventListener('click', generateCuesFromTranscriptText);

  el.btnSubExportSrt.addEventListener('click', () => {
    if (!state.subtitles.length) {
      showToast('Add at least one subtitle cue before exporting .SRT.', 'warning');
      return;
    }
    const srtText = buildSrtContent(state.subtitles);
    const blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, slugifyFilename(el.clipTitleInput.value || 'subtitles', 'srt'));
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('Downloaded .SRT subtitle file.', 'success');
  });

  el.btnSubClear.addEventListener('click', () => {
    state.subtitles = [];
    renderSubtitleCueList();
    showToast('Cleared all subtitle cues.', 'info');
  });

  document.querySelectorAll('[data-sub-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.subStyle = btn.dataset.subStyle;
      syncSegmentedButtons('[data-sub-style]', state.subStyle, 'subStyle');
      applySubtitleOverlayStyles();
    });
  });

  el.subtitleKeywordsInput.addEventListener('input', (e) => {
    state.subKeywords = e.target.value;
    applySubtitleOverlayStyles();
  });

  document.querySelectorAll('[data-sub-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.subColor = btn.dataset.subColor;
      document.querySelectorAll('[data-sub-color]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      applySubtitleOverlayStyles();
    });
  });

  el.subtitleFontsizeSlider.addEventListener('input', (e) => {
    state.subFontSize = Number(e.target.value);
    applySubtitleOverlayStyles();
  });

  document.querySelectorAll('[data-sub-pos]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.subPosition = btn.dataset.subPos;
      syncSegmentedButtons('[data-sub-pos]', state.subPosition, 'subPos');
      applySubtitleOverlayStyles();
    });
  });

  // Live Clipper Controls
  el.btnLiveScreen.addEventListener('click', () => startLiveCapture('screen'));
  el.btnLiveCamera.addEventListener('click', () => startLiveCapture('camera'));
  el.btnLiveStop.addEventListener('click', () => {
    stopLiveCapture();
    showToast('Live capture stopped.', 'info');
  });
  document.querySelectorAll('[data-live-seconds]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveLiveReplayClip(Number(btn.dataset.liveSeconds));
    });
  });

  // Export Queue Controls
  el.btnExportAll.addEventListener('click', exportAllQueuedClips);
  el.btnClearQueue.addEventListener('click', () => {
    state.queue = [];
    renderQueueList();
    showToast('Cleared export queue.', 'info');
  });

  // Settings Controls
  el.settingsModelSelect.value = state.model;
  el.topbarModelLabel.textContent = state.model;

  el.settingsModelSelect.addEventListener('change', (e) => {
    state.model = e.target.value;
    localStorage.setItem(STORAGE_MODEL_KEY, state.model);
    el.topbarModelLabel.textContent = state.model;
    showToast(`Switched Gemini model to ${state.model}.`, 'info');
  });

  el.btnTestGemini.addEventListener('click', testGeminiConnection);

  el.btnPreloadFfmpeg.addEventListener('click', async () => {
    el.btnPreloadFfmpeg.disabled = true;
    el.btnPreloadFfmpeg.textContent = 'Loading FFmpeg.wasm...';
    try {
      await ensureFFmpegLoaded();
      showToast('FFmpeg.wasm engine loaded and ready for exports.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load FFmpeg.wasm.', 'error');
    } finally {
      el.btnPreloadFfmpeg.disabled = false;
      el.btnPreloadFfmpeg.textContent = state.ffmpeg.loaded ? 'FFmpeg.wasm Loaded' : 'Preload FFmpeg.wasm Engine';
    }
  });
}

function init() {
  initTimelineInteractions();
  bindEvents();
  updateStagePreviewAttributes();
  applySubtitleOverlayStyles();
  updateTimelineVisuals();
  updateAiHonestyNote();
  renderQueueList();
  renderCompletedExports();
  renderLiveClipsList();
  detectBrowserCapabilities();
}

init();
