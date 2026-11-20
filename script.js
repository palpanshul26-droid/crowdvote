/* ==========================================================================
   FrameCut — Complete Vanilla JavaScript Frontend (script.js)
   Zero frameworks, zero modules/imports, real API integration with server.py
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_API_KEY = "framecut_backend_url";
  var POLL_INTERVAL_MS = 1200;

  var state = {
    apiBase: loadSavedApiBase(),
    backendConnected: false,
    health: null,
    sourceMode: "upload",
    selectedFile: null,
    selectedFileMeta: null,
    aspectRatio: "9:16",
    captionStyle: "dynamic",
    activeJobId: null,
    activeJob: null,
    sessionJobs: [],
    clipSearchQuery: "",
    pollTimer: null,
    isUploading: false,
    editorMode: "edit", // "edit" | "create"
    editingClipId: null,
    pendingConfirmAction: null,
  };

  /* ------------------------------------------------------------------------
     DOM References
     ------------------------------------------------------------------------ */
  var dom = {};

  function cacheDom() {
    dom.navNewVideoBtn = document.getElementById("nav-new-video-btn");
    dom.mobileMenuBtn = document.getElementById("mobile-menu-btn");
    dom.mobileNavDrawer = document.getElementById("mobile-nav-drawer");

    dom.systemBanner = document.getElementById("system-banner");
    dom.systemStateIcon = document.getElementById("system-state-icon");
    dom.systemBannerTitle = document.getElementById("system-banner-title");
    dom.systemBannerMeta = document.getElementById("system-banner-meta");
    dom.systemIssues = document.getElementById("system-issues");
    dom.recheckHealthBtn = document.getElementById("recheck-health-btn");
    dom.toggleBackendConfigBtn = document.getElementById("toggle-backend-config-btn");
    dom.backendConfigPanel = document.getElementById("backend-config-panel");
    dom.backendUrlForm = document.getElementById("backend-url-form");
    dom.backendUrlInput = document.getElementById("backend-url-input");
    dom.resetBackendUrlBtn = document.getElementById("reset-backend-url-btn");

    dom.clipJobForm = document.getElementById("clip-job-form");
    dom.tabUpload = document.getElementById("tab-upload");
    dom.tabUrl = document.getElementById("tab-url");
    dom.paneUpload = document.getElementById("pane-upload");
    dom.paneUrl = document.getElementById("pane-url");

    dom.fileDropzone = document.getElementById("file-dropzone");
    dom.videoFileInput = document.getElementById("video-file-input");
    dom.dropzoneEmpty = document.getElementById("dropzone-empty");
    dom.dropzoneSelected = document.getElementById("dropzone-selected");
    dom.selectedFileName = document.getElementById("selected-file-name");
    dom.selectedFileMeta = document.getElementById("selected-file-meta");
    dom.clearFileBtn = document.getElementById("clear-file-btn");
    dom.maxUploadLabel = document.getElementById("max-upload-label");

    dom.videoUrlInput = document.getElementById("video-url-input");
    dom.urlAuthorizedCheckbox = document.getElementById("url-authorized-checkbox");

    dom.aspectRatioGroup = document.getElementById("aspect-ratio-group");
    dom.captionStyleGroup = document.getElementById("caption-style-group");
    dom.clipCountSelect = document.getElementById("clip-count-select");
    dom.languageSelect = document.getElementById("language-select");
    dom.minDurationInput = document.getElementById("min-duration-input");
    dom.maxDurationInput = document.getElementById("max-duration-input");

    dom.formErrorBox = document.getElementById("form-error-box");
    dom.formErrorText = document.getElementById("form-error-text");
    dom.uploadTransferBox = document.getElementById("upload-transfer-box");
    dom.uploadTransferLabel = document.getElementById("upload-transfer-label");
    dom.uploadTransferPct = document.getElementById("upload-transfer-pct");
    dom.uploadTransferFill = document.getElementById("upload-transfer-fill");
    dom.submitJobBtn = document.getElementById("submit-job-btn");

    dom.activeJobId = document.getElementById("active-job-id");
    dom.trackerEmpty = document.getElementById("tracker-empty");
    dom.trackerBody = document.getElementById("tracker-body");
    dom.jobSourceSummary = document.getElementById("job-source-summary");
    dom.jobStageMsg = document.getElementById("job-stage-msg");
    dom.jobProgressPct = document.getElementById("job-progress-pct");
    dom.jobProgressFill = document.getElementById("job-progress-fill");
    dom.pipelineSteps = document.getElementById("pipeline-steps");
    dom.jobErrorBox = document.getElementById("job-error-box");
    dom.jobErrorTitle = document.getElementById("job-error-title");
    dom.jobErrorMessage = document.getElementById("job-error-message");
    dom.jobErrorFix = document.getElementById("job-error-fix");
    dom.retryJobBtn = document.getElementById("retry-job-btn");
    dom.dismissJobBtn = document.getElementById("dismiss-job-btn");

    dom.refreshJobsBtn = document.getElementById("refresh-jobs-btn");
    dom.sessionJobsList = document.getElementById("session-jobs-list");

    dom.clipsSummaryMeta = document.getElementById("clips-summary-meta");
    dom.clipsToolbar = document.getElementById("clips-toolbar");
    dom.clipSearchInput = document.getElementById("clip-search-input");
    dom.toggleTranscriptBtn = document.getElementById("toggle-transcript-btn");
    dom.openCustomClipBtn = document.getElementById("open-custom-clip-btn");
    dom.downloadAllBtn = document.getElementById("download-all-btn");
    dom.deleteActiveJobBtn = document.getElementById("delete-active-job-btn");

    dom.transcriptDrawer = document.getElementById("transcript-drawer");
    dom.transcriptMeta = document.getElementById("transcript-meta");
    dom.closeTranscriptBtn = document.getElementById("close-transcript-btn");
    dom.transcriptSegments = document.getElementById("transcript-segments");

    dom.clipsEmptyState = document.getElementById("clips-empty-state");
    dom.clipsGrid = document.getElementById("clips-grid");

    dom.clipEditorModal = document.getElementById("clip-editor-modal");
    dom.editorModalTitle = document.getElementById("editor-modal-title");
    dom.editorModalSubtitle = document.getElementById("editor-modal-subtitle");
    dom.closeEditorModalBtn = document.getElementById("close-editor-modal-btn");
    dom.cancelEditorBtn = document.getElementById("cancel-editor-btn");
    dom.clipEditorForm = document.getElementById("clip-editor-form");
    dom.editorVideo = document.getElementById("editor-video");
    dom.editorVideoShell = document.getElementById("editor-video-shell");
    dom.timelineWindowLabel = document.getElementById("timeline-window-label");
    dom.timelineSourceTotal = document.getElementById("timeline-source-total");
    dom.timelineSelection = document.getElementById("timeline-selection");
    dom.editorTitleInput = document.getElementById("editor-title-input");
    dom.editorStartInput = document.getElementById("editor-start-input");
    dom.editorEndInput = document.getElementById("editor-end-input");
    dom.editorStartFmt = document.getElementById("editor-start-fmt");
    dom.editorEndFmt = document.getElementById("editor-end-fmt");
    dom.editorStartSlider = document.getElementById("editor-start-slider");
    dom.editorEndSlider = document.getElementById("editor-end-slider");
    dom.editorAspectSelect = document.getElementById("editor-aspect-select");
    dom.editorCaptionSelect = document.getElementById("editor-caption-select");
    dom.editorSrtTextarea = document.getElementById("editor-srt-textarea");
    dom.resetSrtBtn = document.getElementById("reset-srt-btn");
    dom.editorErrorBox = document.getElementById("editor-error-box");
    dom.editorErrorText = document.getElementById("editor-error-text");
    dom.saveEditorBtn = document.getElementById("save-editor-btn");
    dom.saveEditorLabel = document.getElementById("save-editor-label");

    dom.confirmModal = document.getElementById("confirm-modal");
    dom.confirmModalTitle = document.getElementById("confirm-modal-title");
    dom.confirmModalMessage = document.getElementById("confirm-modal-message");
    dom.confirmCancelBtn = document.getElementById("confirm-cancel-btn");
    dom.confirmProceedBtn = document.getElementById("confirm-proceed-btn");

    dom.toastRegion = document.getElementById("toast-region");
  }

  /* ------------------------------------------------------------------------
     Utility Helpers
     ------------------------------------------------------------------------ */
  function loadSavedApiBase() {
    try {
      var saved = window.localStorage.getItem(STORAGE_API_KEY) || "";
      if (saved) return saved.replace(/\/+$/, "");
    } catch (_err) {
      // Ignore storage errors in sandboxed frames
    }
    if (typeof window.FRAMECUT_API_URL === "string" && window.FRAMECUT_API_URL.trim()) {
      return window.FRAMECUT_API_URL.trim().replace(/\/+$/, "");
    }
    var metaTag = document.querySelector('meta[name="framecut-api-url"]');
    if (metaTag && metaTag.getAttribute("content")) {
      return metaTag.getAttribute("content").trim().replace(/\/+$/, "");
    }
    return "";
  }

  function saveApiBase(url) {
    var clean = (url || "").trim().replace(/\/+$/, "");
    state.apiBase = clean;
    try {
      if (clean) {
        window.localStorage.setItem(STORAGE_API_KEY, clean);
      } else {
        window.localStorage.removeItem(STORAGE_API_KEY);
      }
    } catch (_err) {
      // Ignore storage errors in sandboxed frames
    }
  }

  function apiUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return state.apiBase + path;
  }

  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function formatTime(seconds, showTenths) {
    var s = Math.max(0, Number(seconds) || 0);
    var hrs = Math.floor(s / 3600);
    var mins = Math.floor((s % 3600) / 60);
    var rem = s % 60;
    var secStr = showTenths ? rem.toFixed(1).padStart(4, "0") : String(Math.floor(rem)).padStart(2, "0");
    if (hrs > 0) {
      return String(hrs).padStart(2, "0") + ":" + String(mins).padStart(2, "0") + ":" + secStr;
    }
    return String(mins).padStart(2, "0") + ":" + secStr;
  }

  function showToast(message, type) {
    var toast = document.createElement("div");
    toast.className = "toast" + (type === "success" ? " is-success" : type === "error" ? " is-error" : "");
    toast.textContent = message;
    dom.toastRegion.appendChild(toast);
    window.setTimeout(function () {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, 4200);
  }

  function setFormError(message) {
    if (!message) {
      dom.formErrorBox.hidden = true;
      dom.formErrorText.textContent = "";
      return;
    }
    dom.formErrorText.textContent = message;
    dom.formErrorBox.hidden = false;
  }

  function setEditorError(message) {
    if (!message) {
      dom.editorErrorBox.hidden = true;
      dom.editorErrorText.textContent = "";
      return;
    }
    dom.editorErrorText.textContent = message;
    dom.editorErrorBox.hidden = false;
  }

  async function fetchJson(path, options) {
    var response;
    try {
      response = await window.fetch(apiUrl(path), options);
    } catch (_networkErr) {
      throw new Error(
        "Cannot reach the FastAPI backend at " +
          (state.apiBase || window.location.origin) +
          ". Start `python3 server.py` or configure the Backend URL above."
      );
    }

    var contentType = response.headers.get("content-type") || "";
    var isJson = contentType.indexOf("application/json") !== -1;

    if (!isJson) {
      throw new Error(
        "Backend server.py is not responding with JSON on " +
          (state.apiBase || window.location.origin) +
          ". Launch `python3 server.py` and point the Backend URL to its port (default http://localhost:8000)."
      );
    }

    var data = await response.json();
    if (!response.ok) {
      var detail = data && (data.detail || data.message) ? data.detail || data.message : "Request failed (" + response.status + ")";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  }

  /* ------------------------------------------------------------------------
     Backend Health & Capability Diagnostics
     ------------------------------------------------------------------------ */
  async function checkBackendHealth() {
    dom.systemBanner.classList.remove("is-ready", "is-warning", "is-error");
    dom.systemStateIcon.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
    dom.systemBannerTitle.textContent = "Checking processing backend...";
    dom.systemBannerMeta.textContent = "Verifying FastAPI server, FFmpeg, and Google Gemini configuration";
    dom.systemIssues.hidden = true;
    renderIcons();

    try {
      var health = await fetchJson("/api/health");
      state.backendConnected = true;
      state.health = health;

      if (health.max_upload_mb) {
        dom.maxUploadLabel.textContent = health.max_upload_mb + " MB";
      }

      var aiLabel =
        health.ai && health.ai.available
          ? "Gemini (" + (health.ai.model || "ready") + ")"
          : "Missing GEMINI_API_KEY";
      var txLabel =
        health.transcription && health.transcription.available
          ? health.transcription.provider +
            (health.transcription.model ? " (" + health.transcription.model + ")" : "")
          : "Not configured";

      var summaryParts = [
        "FFmpeg: " + (health.ffmpeg && health.ffmpeg.available ? "Ready" : "Missing"),
        "Transcription: " + txLabel,
        "AI: " + aiLabel,
        "URL yt-dlp: " + (health.yt_dlp && health.yt_dlp.available ? "Installed" : "Direct media URLs only"),
      ];

      if (health.ready) {
        dom.systemBanner.classList.add("is-ready");
        dom.systemStateIcon.innerHTML = '<i data-lucide="check-circle-2"></i>';
        dom.systemBannerTitle.textContent = "Processing backend ready";
        dom.systemBannerMeta.textContent = summaryParts.join(" · ");
        dom.systemIssues.hidden = true;
      } else {
        dom.systemBanner.classList.add("is-warning");
        dom.systemStateIcon.innerHTML = '<i data-lucide="alert-triangle"></i>';
        dom.systemBannerTitle.textContent = "Backend connected — configuration required before processing";
        dom.systemBannerMeta.textContent = summaryParts.join(" · ");
        renderSystemIssues(health.missing_requirements || []);
      }

      renderIcons();
      await loadSessionJobs();
    } catch (err) {
      state.backendConnected = false;
      state.health = null;
      dom.systemBanner.classList.add("is-error");
      dom.systemStateIcon.innerHTML = '<i data-lucide="server-off"></i>';
      dom.systemBannerTitle.textContent = "Python FastAPI backend (server.py) not reachable";
      dom.systemBannerMeta.textContent =
        "Target: " + (state.apiBase || window.location.origin) + " · Real processing requires server.py running";
      renderSystemIssues([
        {
          dependency: "FastAPI Server",
          message: err.message,
          how_to_fix:
            "Run `python3 server.py` (default port 8000). If serving index.html separately, click 'Backend URL' and enter `http://localhost:8000`.",
        },
      ]);
      renderIcons();
    }
  }

  function renderSystemIssues(issues) {
    if (!issues || !issues.length) {
      dom.systemIssues.hidden = true;
      dom.systemIssues.innerHTML = "";
      return;
    }
    dom.systemIssues.innerHTML = issues
      .map(function (item) {
        return (
          '<div class="system-issue-row">' +
          '<div><span class="system-issue-label">' +
          escapeHtml(item.dependency || "Requirement") +
          ":</span> " +
          escapeHtml(item.message || "") +
          (item.how_to_fix
            ? ' <span class="system-issue-fix">— ' + escapeHtml(item.how_to_fix) + "</span>"
            : "") +
          "</div></div>"
        );
      })
      .join("");
    dom.systemIssues.hidden = false;
  }

  /* ------------------------------------------------------------------------
     Source Mode & File Selection
     ------------------------------------------------------------------------ */
  function setSourceMode(mode) {
    state.sourceMode = mode;
    var isUpload = mode === "upload";
    dom.tabUpload.classList.toggle("is-active", isUpload);
    dom.tabUpload.setAttribute("aria-selected", String(isUpload));
    dom.tabUrl.classList.toggle("is-active", !isUpload);
    dom.tabUrl.setAttribute("aria-selected", String(!isUpload));
    dom.paneUpload.hidden = !isUpload;
    dom.paneUrl.hidden = isUpload;
    setFormError("");
  }

  function handleSelectedFile(file) {
    if (!file) return;
    setFormError("");

    var allowedExts = [".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"];
    var lowerName = file.name.toLowerCase();
    var hasValidExt = allowedExts.some(function (ext) {
      return lowerName.endsWith(ext);
    });
    if (!hasValidExt) {
      setFormError("Unsupported file type. Please choose an MP4, MOV, WebM, MKV, M4V, or AVI video.");
      return;
    }

    var maxMb = (state.health && state.health.max_upload_mb) || 500;
    if (file.size > maxMb * 1024 * 1024) {
      setFormError("Selected file (" + formatBytes(file.size) + ") exceeds the " + maxMb + " MB upload limit.");
      return;
    }

    state.selectedFile = file;
    state.selectedFileMeta = null;
    dom.selectedFileName.textContent = file.name;
    dom.selectedFileMeta.textContent = formatBytes(file.size) + " · Reading video metadata...";
    dom.dropzoneEmpty.hidden = true;
    dom.dropzoneSelected.hidden = false;

    // Probe real local duration & resolution using browser video element
    var probeVideo = document.createElement("video");
    probeVideo.preload = "metadata";
    var objectUrl = URL.createObjectURL(file);
    probeVideo.onloadedmetadata = function () {
      var dur = probeVideo.duration;
      var w = probeVideo.videoWidth;
      var h = probeVideo.videoHeight;
      URL.revokeObjectURL(objectUrl);
      state.selectedFileMeta = { duration: dur, width: w, height: h };
      if (state.selectedFile === file) {
        var metaParts = [formatBytes(file.size)];
        if (isFinite(dur) && dur > 0) metaParts.push(formatTime(dur, false));
        if (w && h) metaParts.push(w + "×" + h);
        dom.selectedFileMeta.textContent = metaParts.join(" · ");
      }
    };
    probeVideo.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      if (state.selectedFile === file) {
        dom.selectedFileMeta.textContent = formatBytes(file.size) + " · Ready for FFprobe validation";
      }
    };
    probeVideo.src = objectUrl;
  }

  function clearSelectedFile() {
    state.selectedFile = null;
    state.selectedFileMeta = null;
    dom.videoFileInput.value = "";
    dom.dropzoneSelected.hidden = true;
    dom.dropzoneEmpty.hidden = false;
  }

  /* ------------------------------------------------------------------------
     Job Submission (Real XHR File Upload & Authorized URL JSON Post)
     ------------------------------------------------------------------------ */
  function readJobFormOptions() {
    var minDur = parseInt(dom.minDurationInput.value, 10) || 20;
    var maxDur = parseInt(dom.maxDurationInput.value, 10) || 60;
    if (minDur < 5 || maxDur > 180 || minDur >= maxDur) {
      throw new Error("Clip duration range is invalid. Min duration must be at least 5s and less than Max duration.");
    }
    return {
      aspect_ratio: state.aspectRatio,
      clip_count: parseInt(dom.clipCountSelect.value, 10) || 4,
      min_duration: minDur,
      max_duration: maxDur,
      burn_captions: state.captionStyle !== "off",
      caption_style: state.captionStyle === "off" ? "dynamic" : state.captionStyle,
      language: dom.languageSelect.value || "auto",
    };
  }

  function uploadVideoWithProgress(file, opts) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var formData = new FormData();
      formData.append("file", file);
      formData.append("aspect_ratio", opts.aspect_ratio);
      formData.append("clip_count", String(opts.clip_count));
      formData.append("min_duration", String(opts.min_duration));
      formData.append("max_duration", String(opts.max_duration));
      formData.append("burn_captions", String(opts.burn_captions));
      formData.append("caption_style", opts.caption_style);
      formData.append("language", opts.language);

      dom.uploadTransferBox.hidden = false;
      dom.uploadTransferLabel.textContent = "Uploading " + file.name + "...";
      dom.uploadTransferPct.textContent = "0%";
      dom.uploadTransferFill.style.width = "0%";

      xhr.upload.onprogress = function (evt) {
        if (!evt.lengthComputable) return;
        var pct = Math.round((evt.loaded / evt.total) * 100);
        dom.uploadTransferPct.textContent = pct + "%";
        dom.uploadTransferFill.style.width = pct + "%";
        dom.uploadTransferLabel.textContent =
          "Uploading " + formatBytes(evt.loaded) + " / " + formatBytes(evt.total);
      };

      xhr.onload = function () {
        dom.uploadTransferBox.hidden = true;
        var ctype = xhr.getResponseHeader("content-type") || "";
        if (ctype.indexOf("application/json") === -1) {
          reject(
            new Error(
              "Upload failed: FastAPI backend (server.py) is not reachable at " +
                (state.apiBase || window.location.origin) +
                "."
            )
          );
          return;
        }
        try {
          var payload = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(payload);
          } else {
            reject(new Error(payload.detail || payload.message || "Upload rejected (" + xhr.status + ")"));
          }
        } catch (_err) {
          reject(new Error("Invalid JSON response from server."));
        }
      };

      xhr.onerror = function () {
        dom.uploadTransferBox.hidden = true;
        reject(
          new Error(
            "Network error while uploading. Confirm `python3 server.py` is running at " +
              (state.apiBase || window.location.origin) +
              "."
          )
        );
      };

      xhr.open("POST", apiUrl("/api/jobs/upload"), true);
      xhr.send(formData);
    });
  }

  async function handleJobFormSubmit(evt) {
    evt.preventDefault();
    if (state.isUploading) return;
    setFormError("");

    var opts;
    try {
      opts = readJobFormOptions();
    } catch (err) {
      setFormError(err.message);
      return;
    }

    if (state.sourceMode === "upload") {
      if (!state.selectedFile) {
        setFormError("Please select or drop a video file to upload.");
        return;
      }
    } else {
      var rawUrl = (dom.videoUrlInput.value || "").trim();
      if (!/^https?:\/\/.+/i.test(rawUrl)) {
        setFormError("Please enter a valid HTTP or HTTPS video URL.");
        return;
      }
      if (!dom.urlAuthorizedCheckbox.checked) {
        setFormError("Please confirm you own or have permission to process this video URL.");
        return;
      }
    }

    state.isUploading = true;
    dom.submitJobBtn.disabled = true;

    try {
      var job;
      if (state.sourceMode === "upload") {
        job = await uploadVideoWithProgress(state.selectedFile, opts);
      } else {
        var urlPayload = Object.assign(
          {
            url: dom.videoUrlInput.value.trim(),
            authorized: true,
          },
          opts
        );
        job = await fetchJson("/api/jobs/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(urlPayload),
        });
      }

      showToast("Job " + job.job_id + " started. Monitoring live processing...", "success");
      selectAndTrackJob(job);
      await loadSessionJobs();
    } catch (err) {
      setFormError(err.message);
      showToast(err.message, "error");
    } finally {
      state.isUploading = false;
      dom.submitJobBtn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------------
     Live Job Polling, Pipeline UI & Session Queue
     ------------------------------------------------------------------------ */
  function stopPolling() {
    if (state.pollTimer) {
      window.clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function isJobTerminal(status) {
    return status === "completed" || status === "failed";
  }

  function selectAndTrackJob(job) {
    stopPolling();
    state.activeJobId = job.job_id;
    state.activeJob = job;
    renderJobTracker(job);
    renderClipsWorkspace(job);
    renderSessionJobs();

    if (!isJobTerminal(job.status)) {
      schedulePoll(job.job_id);
    }
  }

  function schedulePoll(jobId) {
    stopPolling();
    state.pollTimer = window.setTimeout(async function () {
      if (state.activeJobId !== jobId) return;
      try {
        var latest = await fetchJson("/api/jobs/" + encodeURIComponent(jobId));
        var prevStatus = state.activeJob ? state.activeJob.status : null;
        state.activeJob = latest;
        renderJobTracker(latest);
        renderClipsWorkspace(latest);

        if (prevStatus !== latest.status) {
          loadSessionJobs();
          if (latest.status === "completed") {
            showToast(
              "Finished rendering " + (latest.clips ? latest.clips.length : 0) + " clips.",
              "success"
            );
          } else if (latest.status === "failed" && latest.error) {
            showToast(latest.error.message || "Job failed.", "error");
          }
        }

        if (!isJobTerminal(latest.status)) {
          schedulePoll(jobId);
        }
      } catch (err) {
        showToast("Lost connection while polling job: " + err.message, "error");
      }
    }, POLL_INTERVAL_MS);
  }

  async function loadSessionJobs() {
    if (!state.backendConnected) return;
    try {
      var data = await fetchJson("/api/jobs");
      state.sessionJobs = data.jobs || [];
      renderSessionJobs();

      if (!state.activeJobId && state.sessionJobs.length > 0) {
        var newest = await fetchJson("/api/jobs/" + encodeURIComponent(state.sessionJobs[0].job_id));
        selectAndTrackJob(newest);
      }
    } catch (_err) {
      // Handled by health check
    }
  }

  function renderSessionJobs() {
    if (!state.sessionJobs.length) {
      dom.sessionJobsList.innerHTML =
        '<p class="muted-small">No temporary jobs on the backend yet.</p>';
      return;
    }

    dom.sessionJobsList.innerHTML = state.sessionJobs
      .map(function (item) {
        var isSelected = item.job_id === state.activeJobId;
        var statusLabel =
          item.status === "completed"
            ? item.clip_count + " clips ready"
            : item.status === "failed"
              ? "Failed"
              : item.progress + "% · " + item.status.replace(/_/g, " ");
        return (
          '<button type="button" class="session-job-item' +
          (isSelected ? " is-selected" : "") +
          '" data-job-select="' +
          escapeHtml(item.job_id) +
          '">' +
          '<div class="session-job-info">' +
          '<div class="session-job-name">' +
          escapeHtml(item.source_name || item.job_id) +
          "</div>" +
          '<div class="session-job-sub tabular">' +
          escapeHtml(item.job_id) +
          " · " +
          escapeHtml(statusLabel) +
          "</div>" +
          "</div>" +
          '<i data-lucide="chevron-right" aria-hidden="true"></i>' +
          "</button>"
        );
      })
      .join("");
    renderIcons();
  }

  function renderJobTracker(job) {
    if (!job) {
      dom.activeJobId.textContent = "No active job";
      dom.trackerEmpty.hidden = false;
      dom.trackerBody.hidden = true;
      return;
    }

    dom.activeJobId.textContent = "Job " + job.job_id;
    dom.trackerEmpty.hidden = true;
    dom.trackerBody.hidden = false;

    var src = job.source || {};
    var metaBits = [];
    if (src.duration > 0) metaBits.push(formatTime(src.duration, false));
    if (src.width && src.height) metaBits.push(src.width + "×" + src.height);
    if (src.size_bytes > 0) metaBits.push(formatBytes(src.size_bytes));
    if (job.options && job.options.aspect_ratio) metaBits.push(job.options.aspect_ratio);

    dom.jobSourceSummary.innerHTML =
      '<div class="job-source-title">' +
      escapeHtml(src.filename || "Source video") +
      "</div>" +
      '<div class="job-source-meta tabular">' +
      escapeHtml(metaBits.join(" · ") || "Inspecting media...") +
      "</div>";

    dom.jobStageMsg.textContent = job.stage_message || job.status;
    dom.jobProgressPct.textContent = (job.progress || 0) + "%";
    dom.jobProgressFill.style.width = (job.progress || 0) + "%";

    var stages = job.stages || [];
    dom.pipelineSteps.innerHTML = stages
      .map(function (st) {
        var iconName =
          st.state === "done"
            ? "check-circle-2"
            : st.state === "active"
              ? "loader-2"
              : st.state === "error"
                ? "x-circle"
                : "circle";
        var iconClass = st.state === "active" ? ' class="spin"' : "";
        var stateWord =
          st.state === "done"
            ? "Done"
            : st.state === "active"
              ? "Running"
              : st.state === "error"
                ? "Failed"
                : "Pending";
        return (
          '<li class="pipeline-step is-' +
          escapeHtml(st.state) +
          '">' +
          '<span class="pipeline-step-left">' +
          '<i data-lucide="' +
          iconName +
          '"' +
          iconClass +
          ' aria-hidden="true"></i>' +
          "<span>" +
          escapeHtml(st.label) +
          "</span>" +
          "</span>" +
          '<span class="pipeline-step-state">' +
          stateWord +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    if (job.status === "failed" && job.error) {
      dom.jobErrorBox.hidden = false;
      dom.jobErrorTitle.textContent = job.error.missing_dependency
        ? "Missing Dependency: " + job.error.missing_dependency
        : "Processing Failed (" + (job.error.code || "ERROR") + ")";
      dom.jobErrorMessage.textContent = job.error.message || "Unknown processing error.";
      if (job.error.how_to_fix) {
        dom.jobErrorFix.textContent = "How to fix: " + job.error.how_to_fix;
        dom.jobErrorFix.hidden = false;
      } else {
        dom.jobErrorFix.hidden = true;
      }
    } else {
      dom.jobErrorBox.hidden = true;
    }

    renderIcons();
  }

  /* ------------------------------------------------------------------------
     Clips Grid, Transcript Drawer & Actions
     ------------------------------------------------------------------------ */
  function renderClipsWorkspace(job) {
    if (!job) {
      dom.clipsToolbar.hidden = true;
      dom.transcriptDrawer.hidden = true;
      dom.clipsGrid.hidden = true;
      dom.clipsEmptyState.hidden = false;
      dom.clipsSummaryMeta.textContent =
        "Rendered clips from the active job will appear here with real video previews and trim controls.";
      return;
    }

    var clips = job.clips || [];
    var hasSource = Boolean(job.source && job.source.duration > 0);
    dom.clipsToolbar.hidden = !(clips.length > 0 || hasSource);
    dom.downloadAllBtn.disabled = clips.length === 0;
    dom.openCustomClipBtn.disabled = !hasSource;
    dom.toggleTranscriptBtn.disabled = !(job.transcript && job.transcript.segments && job.transcript.segments.length > 0);

    if (clips.length === 0) {
      dom.clipsGrid.hidden = true;
      dom.clipsEmptyState.hidden = false;
      if (job.status === "failed") {
        dom.clipsSummaryMeta.textContent =
          "Job " + job.job_id + " failed before clips could be rendered. Review the error panel to retry.";
      } else if (job.status === "completed") {
        dom.clipsSummaryMeta.textContent =
          "All clips were deleted from Job " + job.job_id + ". Use Custom Clip to render a new range.";
      } else {
        dom.clipsSummaryMeta.textContent =
          "Rendering in progress for " + (job.source.filename || job.job_id) + "...";
      }
      renderTranscriptSegments(job);
      return;
    }

    var query = (state.clipSearchQuery || "").trim().toLowerCase();
    var filtered = clips.filter(function (c) {
      if (!query) return true;
      var haystack = (
        (c.title || "") +
        " " +
        (c.description || "") +
        " " +
        (c.reason || "") +
        " " +
        (c.hook || "") +
        " " +
        (c.transcript_excerpt || "")
      ).toLowerCase();
      return haystack.indexOf(query) !== -1;
    });

    var totalSeconds = clips.reduce(function (sum, c) {
      return sum + (Number(c.duration) || 0);
    }, 0);
    dom.clipsSummaryMeta.textContent =
      clips.length +
      (clips.length === 1 ? " clip rendered" : " clips rendered") +
      " · Total runtime " +
      formatTime(totalSeconds, false) +
      " · Source: " +
      (job.source.filename || job.job_id);

    dom.clipsEmptyState.hidden = true;
    dom.clipsGrid.hidden = false;

    if (filtered.length === 0) {
      dom.clipsGrid.innerHTML =
        '<div class="clips-empty-state glass-surface" style="grid-column: 1 / -1;">' +
        '<p class="empty-title">No clips match "' +
        escapeHtml(state.clipSearchQuery) +
        '"</p>' +
        '<p class="empty-desc">Clear the filter query to view all rendered clips.</p>' +
        "</div>";
      return;
    }

    dom.clipsGrid.innerHTML = filtered
      .map(function (clip) {
        var verQuery = "?v=" + encodeURIComponent(String(clip.version || 1));
        var streamSrc = apiUrl(clip.preview_url) + verQuery;
        var thumbSrc = apiUrl(clip.thumbnail_url) + verQuery;
        var downloadHref = apiUrl(clip.download_url);
        var srtHref = apiUrl(clip.srt_url) + "?download=1";
        var ratioClass =
          clip.aspect_ratio === "1:1"
            ? "ratio-1-1"
            : clip.aspect_ratio === "16:9"
              ? "ratio-16-9"
              : "ratio-9-16";

        var metaParts = [
          formatTime(clip.start, false) + " – " + formatTime(clip.end, false),
          Number(clip.duration).toFixed(1) + "s",
          clip.aspect_ratio,
          clip.burn_captions ? "Captions: " + clip.caption_style : "No captions",
          formatBytes(clip.size_bytes),
        ];

        return (
          '<article class="clip-card" data-clip-id="' +
          escapeHtml(clip.clip_id) +
          '">' +
          '<div class="clip-media-stage ' +
          ratioClass +
          '">' +
          '<video class="clip-video" controls playsinline preload="metadata" poster="' +
          escapeHtml(thumbSrc) +
          '" src="' +
          escapeHtml(streamSrc) +
          '"></video>' +
          "</div>" +
          '<div class="clip-body">' +
          '<h3 class="clip-title">' +
          escapeHtml(clip.title) +
          "</h3>" +
          '<div class="clip-meta-line tabular">' +
          escapeHtml(metaParts.join(" · ")) +
          "</div>" +
          (clip.description || clip.reason || clip.transcript_excerpt
            ? '<p class="clip-reason">' +
              escapeHtml(clip.description || clip.reason || clip.transcript_excerpt) +
              "</p>"
            : "") +
          '<div class="clip-actions">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-action="edit-clip" data-clip-id="' +
          escapeHtml(clip.clip_id) +
          '">' +
          '<i data-lucide="sliders-horizontal" aria-hidden="true"></i>' +
          "<span>Trim &amp; Edit</span>" +
          "</button>" +
          '<a class="btn btn-primary btn-sm btn-primary-download" href="' +
          escapeHtml(downloadHref) +
          '" download>' +
          '<i data-lucide="download" aria-hidden="true"></i>' +
          "<span>MP4</span>" +
          "</a>" +
          '<a class="btn btn-ghost btn-sm" href="' +
          escapeHtml(srtHref) +
          '" download title="Download SRT captions">' +
          "<span>SRT</span>" +
          "</a>" +
          '<button type="button" class="btn btn-ghost btn-sm btn-danger-ghost" data-action="delete-clip" data-clip-id="' +
          escapeHtml(clip.clip_id) +
          '" aria-label="Delete clip">' +
          '<i data-lucide="trash-2" aria-hidden="true"></i>' +
          "</button>" +
          "</div>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    renderTranscriptSegments(job);
    renderIcons();
  }

  function renderTranscriptSegments(job) {
    var transcript = job && job.transcript;
    var segments = (transcript && transcript.segments) || [];
    if (!segments.length) {
      dom.transcriptSegments.innerHTML =
        '<p class="muted-small">No transcript segments available for this job.</p>';
      return;
    }

    dom.transcriptMeta.textContent =
      "Language: " +
      (transcript.language || "auto") +
      " · Engine: " +
      (transcript.provider || "Google Gemini") +
      " · " +
      segments.length +
      " segments — click any line to create a custom clip starting there.";

    dom.transcriptSegments.innerHTML = segments
      .map(function (seg) {
        return (
          '<button type="button" class="transcript-row" data-seed-start="' +
          escapeHtml(String(seg.start)) +
          '">' +
          '<span class="transcript-time tabular">' +
          formatTime(seg.start, false) +
          " – " +
          formatTime(seg.end, false) +
          "</span>" +
          '<span class="transcript-text">' +
          escapeHtml(seg.text) +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  /* ------------------------------------------------------------------------
     Clip Trim / Edit / Custom Clip Modal
     ------------------------------------------------------------------------ */
  function syncEditorTimelineUi() {
    var total = (state.activeJob && state.activeJob.source && state.activeJob.source.duration) || 60;
    var start = Math.max(0, Math.min(total, parseFloat(dom.editorStartInput.value) || 0));
    var end = Math.max(0, Math.min(total, parseFloat(dom.editorEndInput.value) || 0));

    dom.editorStartFmt.textContent = formatTime(start, true);
    dom.editorEndFmt.textContent = formatTime(end, true);
    dom.editorStartSlider.value = String(start);
    dom.editorEndSlider.value = String(end);

    var dur = Math.max(0, end - start);
    dom.timelineWindowLabel.textContent =
      formatTime(start, false) + " – " + formatTime(end, false) + " (" + dur.toFixed(1) + "s)";
    dom.timelineSourceTotal.textContent = formatTime(total, false);

    var leftPct = total > 0 ? (start / total) * 100 : 0;
    var widthPct = total > 0 ? Math.max(1.5, (dur / total) * 100) : 10;
    dom.timelineSelection.style.left = leftPct.toFixed(2) + "%";
    dom.timelineSelection.style.width = Math.min(100 - leftPct, widthPct).toFixed(2) + "%";
  }

  async function openClipEditor(clipId, seedStart) {
    if (!state.activeJob) return;
    setEditorError("");

    var sourceDuration = Math.max(1, Number(state.activeJob.source.duration) || 60);
    dom.editorStartSlider.max = String(sourceDuration);
    dom.editorEndSlider.max = String(sourceDuration);
    dom.editorStartInput.max = String(sourceDuration);
    dom.editorEndInput.max = String(sourceDuration);

    if (clipId) {
      var clip = (state.activeJob.clips || []).find(function (c) {
        return c.clip_id === clipId;
      });
      if (!clip) return;

      state.editorMode = "edit";
      state.editingClipId = clipId;
      dom.editorModalTitle.textContent = "Edit & Trim Clip";
      dom.editorModalSubtitle.textContent =
        "Modify trim boundaries, aspect ratio, or captions and re-render with FFmpeg.";
      dom.saveEditorLabel.textContent = "Re-render Clip";

      dom.editorTitleInput.value = clip.title || "";
      dom.editorStartInput.value = Number(clip.start).toFixed(1);
      dom.editorEndInput.value = Number(clip.end).toFixed(1);
      dom.editorAspectSelect.value = clip.aspect_ratio || "9:16";
      dom.editorCaptionSelect.value = clip.burn_captions ? clip.caption_style || "dynamic" : "off";
      dom.editorSrtTextarea.value = "";
      dom.editorSrtTextarea.dataset.touched = "false";

      var ver = "?v=" + encodeURIComponent(String(clip.version || 1));
      dom.editorVideo.src = apiUrl(clip.preview_url) + ver;
      dom.editorVideo.poster = apiUrl(clip.thumbnail_url) + ver;
      dom.editorVideoShell.hidden = false;

      // Load real SRT captions for this clip
      try {
        var srtResp = await window.fetch(apiUrl(clip.srt_url));
        if (srtResp.ok) {
          dom.editorSrtTextarea.value = await srtResp.text();
        }
      } catch (_err) {
        // Non-fatal
      }
    } else {
      state.editorMode = "create";
      state.editingClipId = null;
      var defaultStart = typeof seedStart === "number" ? Math.max(0, Math.min(sourceDuration - 2, seedStart)) : 0;
      var defaultEnd = Math.min(sourceDuration, defaultStart + Math.min(30, sourceDuration - defaultStart));

      dom.editorModalTitle.textContent = "Create Custom Clip";
      dom.editorModalSubtitle.textContent =
        "Cut any custom timestamp range directly from the source video with FFmpeg.";
      dom.saveEditorLabel.textContent = "Render Clip";

      dom.editorTitleInput.value = "Custom Clip " + ((state.activeJob.clips || []).length + 1);
      dom.editorStartInput.value = defaultStart.toFixed(1);
      dom.editorEndInput.value = defaultEnd.toFixed(1);
      dom.editorAspectSelect.value = state.activeJob.options.aspect_ratio || "9:16";
      dom.editorCaptionSelect.value = state.activeJob.options.burn_captions
        ? state.activeJob.options.caption_style || "dynamic"
        : "off";
      dom.editorSrtTextarea.value = "";
      dom.editorSrtTextarea.dataset.touched = "false";

      // Show existing first clip preview or hide player until rendered
      dom.editorVideo.removeAttribute("src");
      dom.editorVideo.load();
      dom.editorVideoShell.hidden = true;
    }

    syncEditorTimelineUi();
    dom.clipEditorModal.hidden = false;
    dom.editorTitleInput.focus();
    renderIcons();
  }

  function closeClipEditor() {
    dom.clipEditorModal.hidden = true;
    dom.editorVideo.pause();
    state.editingClipId = null;
    setEditorError("");
  }

  async function handleClipEditorSubmit(evt) {
    evt.preventDefault();
    if (!state.activeJob) return;
    setEditorError("");

    var start = parseFloat(dom.editorStartInput.value);
    var end = parseFloat(dom.editorEndInput.value);
    var title = (dom.editorTitleInput.value || "").trim();
    if (!title) {
      setEditorError("Please enter a clip title.");
      return;
    }
    if (!isFinite(start) || !isFinite(end) || end - start < 1.0) {
      setEditorError("End time must be at least 1.0 second after Start time.");
      return;
    }

    var captionVal = dom.editorCaptionSelect.value;
    var body = {
      title: title,
      start: start,
      end: end,
      aspect_ratio: dom.editorAspectSelect.value,
      burn_captions: captionVal !== "off",
      caption_style: captionVal === "off" ? "dynamic" : captionVal,
    };

    if (dom.editorSrtTextarea.dataset.touched === "true") {
      body.captions_srt = dom.editorSrtTextarea.value;
    }

    dom.saveEditorBtn.disabled = true;
    dom.saveEditorLabel.textContent = "Rendering with FFmpeg...";

    try {
      var jobId = state.activeJob.job_id;
      if (state.editorMode === "edit" && state.editingClipId) {
        var updated = await fetchJson(
          "/api/jobs/" + encodeURIComponent(jobId) + "/clips/" + encodeURIComponent(state.editingClipId),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        state.activeJob.clips = state.activeJob.clips.map(function (c) {
          return c.clip_id === updated.clip_id ? updated : c;
        });
        showToast("Clip re-rendered successfully.", "success");
      } else {
        var created = await fetchJson("/api/jobs/" + encodeURIComponent(jobId) + "/clips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        state.activeJob.clips.push(created);
        showToast("Custom clip rendered successfully.", "success");
      }

      renderClipsWorkspace(state.activeJob);
      loadSessionJobs();
      closeClipEditor();
    } catch (err) {
      setEditorError(err.message);
    } finally {
      dom.saveEditorBtn.disabled = false;
      dom.saveEditorLabel.textContent = state.editorMode === "edit" ? "Re-render Clip" : "Render Clip";
    }
  }

  /* ------------------------------------------------------------------------
     Confirm Dialog & Deletion / Retry Handlers
     ------------------------------------------------------------------------ */
  function openConfirmDialog(title, message, onConfirm) {
    dom.confirmModalTitle.textContent = title;
    dom.confirmModalMessage.textContent = message;
    state.pendingConfirmAction = onConfirm;
    dom.confirmModal.hidden = false;
    dom.confirmProceedBtn.focus();
  }

  function closeConfirmDialog() {
    dom.confirmModal.hidden = true;
    state.pendingConfirmAction = null;
  }

  async function retryActiveJob() {
    if (!state.activeJobId) return;
    dom.retryJobBtn.disabled = true;
    try {
      var retried = await fetchJson("/api/jobs/" + encodeURIComponent(state.activeJobId) + "/retry", {
        method: "POST",
      });
      showToast("Retrying job " + retried.job_id + "...", "success");
      selectAndTrackJob(retried);
      await loadSessionJobs();
    } catch (err) {
      showToast("Retry failed: " + err.message, "error");
    } finally {
      dom.retryJobBtn.disabled = false;
    }
  }

  async function deleteActiveJob() {
    if (!state.activeJobId) return;
    var jid = state.activeJobId;
    try {
      await fetchJson("/api/jobs/" + encodeURIComponent(jid), { method: "DELETE" });
      stopPolling();
      state.activeJobId = null;
      state.activeJob = null;
      renderJobTracker(null);
      renderClipsWorkspace(null);
      showToast("Deleted temporary job " + jid + " and cleaned up files.", "success");
      await loadSessionJobs();
    } catch (err) {
      showToast("Failed to delete job: " + err.message, "error");
    }
  }

  async function deleteSingleClip(clipId) {
    if (!state.activeJobId) return;
    var jid = state.activeJobId;
    try {
      await fetchJson(
        "/api/jobs/" + encodeURIComponent(jid) + "/clips/" + encodeURIComponent(clipId),
        { method: "DELETE" }
      );
      if (state.activeJob) {
        state.activeJob.clips = state.activeJob.clips.filter(function (c) {
          return c.clip_id !== clipId;
        });
        renderClipsWorkspace(state.activeJob);
      }
      loadSessionJobs();
      showToast("Clip deleted.", "success");
    } catch (err) {
      showToast("Failed to delete clip: " + err.message, "error");
    }
  }

  /* ------------------------------------------------------------------------
     Event Binding
     ------------------------------------------------------------------------ */
  function bindEvents() {
    // Top bar CTA & Mobile menu
    dom.navNewVideoBtn.addEventListener("click", function () {
      clearSelectedFile();
      dom.videoUrlInput.value = "";
      dom.urlAuthorizedCheckbox.checked = false;
      setFormError("");
      var studio = document.getElementById("studio");
      if (studio) studio.scrollIntoView({ behavior: "smooth" });
    });

    dom.mobileMenuBtn.addEventListener("click", function () {
      var expanded = dom.mobileMenuBtn.getAttribute("aria-expanded") === "true";
      dom.mobileMenuBtn.setAttribute("aria-expanded", String(!expanded));
      dom.mobileNavDrawer.hidden = expanded;
    });

    dom.mobileNavDrawer.addEventListener("click", function (evt) {
      if (evt.target.classList.contains("mobile-nav-link")) {
        dom.mobileNavDrawer.hidden = true;
        dom.mobileMenuBtn.setAttribute("aria-expanded", "false");
      }
    });

    // Health check & Backend URL configuration
    dom.recheckHealthBtn.addEventListener("click", checkBackendHealth);

    dom.toggleBackendConfigBtn.addEventListener("click", function () {
      var willShow = dom.backendConfigPanel.hidden;
      dom.backendConfigPanel.hidden = !willShow;
      dom.toggleBackendConfigBtn.setAttribute("aria-expanded", String(willShow));
      if (willShow) {
        dom.backendUrlInput.value = state.apiBase;
        dom.backendUrlInput.focus();
      }
    });

    dom.backendUrlForm.addEventListener("submit", function (evt) {
      evt.preventDefault();
      saveApiBase(dom.backendUrlInput.value);
      dom.backendConfigPanel.hidden = true;
      dom.toggleBackendConfigBtn.setAttribute("aria-expanded", "false");
      checkBackendHealth();
    });

    dom.resetBackendUrlBtn.addEventListener("click", function () {
      dom.backendUrlInput.value = "";
      saveApiBase("");
      dom.backendConfigPanel.hidden = true;
      dom.toggleBackendConfigBtn.setAttribute("aria-expanded", "false");
      checkBackendHealth();
    });

    // Source tabs
    dom.tabUpload.addEventListener("click", function () {
      setSourceMode("upload");
    });
    dom.tabUrl.addEventListener("click", function () {
      setSourceMode("url");
    });

    // File dropzone & input
    dom.fileDropzone.addEventListener("click", function (evt) {
      if (evt.target.closest("#clear-file-btn")) return;
      dom.videoFileInput.click();
    });
    dom.fileDropzone.addEventListener("keydown", function (evt) {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        dom.videoFileInput.click();
      }
    });
    dom.videoFileInput.addEventListener("change", function () {
      if (dom.videoFileInput.files && dom.videoFileInput.files[0]) {
        handleSelectedFile(dom.videoFileInput.files[0]);
      }
    });
    dom.fileDropzone.addEventListener("dragover", function (evt) {
      evt.preventDefault();
      dom.fileDropzone.classList.add("is-dragover");
    });
    dom.fileDropzone.addEventListener("dragleave", function () {
      dom.fileDropzone.classList.remove("is-dragover");
    });
    dom.fileDropzone.addEventListener("drop", function (evt) {
      evt.preventDefault();
      dom.fileDropzone.classList.remove("is-dragover");
      if (evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0]) {
        handleSelectedFile(evt.dataTransfer.files[0]);
      }
    });
    dom.clearFileBtn.addEventListener("click", function (evt) {
      evt.stopPropagation();
      clearSelectedFile();
    });

    // Aspect ratio & Caption segmented groups
    dom.aspectRatioGroup.addEventListener("click", function (evt) {
      var btn = evt.target.closest("[data-aspect]");
      if (!btn) return;
      state.aspectRatio = btn.getAttribute("data-aspect");
      dom.aspectRatioGroup.querySelectorAll("[data-aspect]").forEach(function (el) {
        var active = el === btn;
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-pressed", String(active));
      });
    });

    dom.captionStyleGroup.addEventListener("click", function (evt) {
      var btn = evt.target.closest("[data-caption]");
      if (!btn) return;
      state.captionStyle = btn.getAttribute("data-caption");
      dom.captionStyleGroup.querySelectorAll("[data-caption]").forEach(function (el) {
        var active = el === btn;
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-pressed", String(active));
      });
    });

    // Main Job Form submit
    dom.clipJobForm.addEventListener("submit", handleJobFormSubmit);

    // Retry & Delete failed job
    dom.retryJobBtn.addEventListener("click", retryActiveJob);
    dom.dismissJobBtn.addEventListener("click", function () {
      openConfirmDialog(
        "Delete Job",
        "Remove this temporary job and all associated source/rendered files from the server?",
        deleteActiveJob
      );
    });

    // Session jobs list
    dom.refreshJobsBtn.addEventListener("click", loadSessionJobs);
    dom.sessionJobsList.addEventListener("click", async function (evt) {
      var btn = evt.target.closest("[data-job-select]");
      if (!btn) return;
      var jid = btn.getAttribute("data-job-select");
      try {
        var job = await fetchJson("/api/jobs/" + encodeURIComponent(jid));
        selectAndTrackJob(job);
      } catch (err) {
        showToast("Could not load job: " + err.message, "error");
      }
    });

    // Clips toolbar
    dom.clipSearchInput.addEventListener("input", function () {
      state.clipSearchQuery = dom.clipSearchInput.value;
      if (state.activeJob) renderClipsWorkspace(state.activeJob);
    });

    dom.toggleTranscriptBtn.addEventListener("click", function () {
      dom.transcriptDrawer.hidden = !dom.transcriptDrawer.hidden;
    });
    dom.closeTranscriptBtn.addEventListener("click", function () {
      dom.transcriptDrawer.hidden = true;
    });
    dom.transcriptSegments.addEventListener("click", function (evt) {
      var row = evt.target.closest("[data-seed-start]");
      if (!row) return;
      var startVal = parseFloat(row.getAttribute("data-seed-start"));
      openClipEditor(null, isFinite(startVal) ? startVal : 0);
    });

    dom.openCustomClipBtn.addEventListener("click", function () {
      openClipEditor(null, 0);
    });

    dom.downloadAllBtn.addEventListener("click", function () {
      if (!state.activeJobId) return;
      var link = document.createElement("a");
      link.href = apiUrl("/api/jobs/" + encodeURIComponent(state.activeJobId) + "/download-all");
      link.setAttribute("download", "");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Preparing ZIP archive of all rendered clips...", "success");
    });

    dom.deleteActiveJobBtn.addEventListener("click", function () {
      openConfirmDialog(
        "Delete Entire Job",
        "Delete this temporary job, source video, transcript, and all rendered clips immediately?",
        deleteActiveJob
      );
    });

    // Delegated Clip Card Actions (Edit / Delete)
    dom.clipsGrid.addEventListener("click", function (evt) {
      var actionBtn = evt.target.closest("[data-action]");
      if (!actionBtn) return;
      var action = actionBtn.getAttribute("data-action");
      var clipId = actionBtn.getAttribute("data-clip-id");
      if (!clipId) return;

      if (action === "edit-clip") {
        openClipEditor(clipId);
      } else if (action === "delete-clip") {
        openConfirmDialog(
          "Delete Clip",
          "Permanently remove this rendered clip and its caption file from the current job?",
          function () {
            return deleteSingleClip(clipId);
          }
        );
      }
    });

    // Clip Editor Modal controls
    dom.closeEditorModalBtn.addEventListener("click", closeClipEditor);
    dom.cancelEditorBtn.addEventListener("click", closeClipEditor);
    dom.clipEditorModal.addEventListener("click", function (evt) {
      if (evt.target === dom.clipEditorModal) closeClipEditor();
    });

    dom.editorStartInput.addEventListener("input", syncEditorTimelineUi);
    dom.editorEndInput.addEventListener("input", syncEditorTimelineUi);
    dom.editorStartSlider.addEventListener("input", function () {
      dom.editorStartInput.value = Number(dom.editorStartSlider.value).toFixed(1);
      syncEditorTimelineUi();
    });
    dom.editorEndSlider.addEventListener("input", function () {
      dom.editorEndInput.value = Number(dom.editorEndSlider.value).toFixed(1);
      syncEditorTimelineUi();
    });

    dom.clipEditorForm.addEventListener("click", function (evt) {
      var nudgeBtn = evt.target.closest("[data-nudge]");
      if (!nudgeBtn) return;
      var targetField = nudgeBtn.getAttribute("data-nudge");
      var delta = parseFloat(nudgeBtn.getAttribute("data-delta")) || 0;
      var maxDur = (state.activeJob && state.activeJob.source && state.activeJob.source.duration) || 60;
      var inputEl = targetField === "start" ? dom.editorStartInput : dom.editorEndInput;
      var next = Math.max(0, Math.min(maxDur, (parseFloat(inputEl.value) || 0) + delta));
      inputEl.value = next.toFixed(1);
      syncEditorTimelineUi();
    });

    dom.editorSrtTextarea.addEventListener("input", function () {
      dom.editorSrtTextarea.dataset.touched = "true";
    });

    dom.resetSrtBtn.addEventListener("click", function () {
      dom.editorSrtTextarea.value = "";
      dom.editorSrtTextarea.dataset.touched = "false";
      showToast("Captions will be auto-generated from the speech transcript on render.", "success");
    });

    dom.clipEditorForm.addEventListener("submit", handleClipEditorSubmit);

    // Confirmation Dialog
    dom.confirmCancelBtn.addEventListener("click", closeConfirmDialog);
    dom.confirmModal.addEventListener("click", function (evt) {
      if (evt.target === dom.confirmModal) closeConfirmDialog();
    });
    dom.confirmProceedBtn.addEventListener("click", async function () {
      var fn = state.pendingConfirmAction;
      closeConfirmDialog();
      if (typeof fn === "function") await fn();
    });

    // Escape key closes modals
    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape") {
        if (!dom.confirmModal.hidden) closeConfirmDialog();
        else if (!dom.clipEditorModal.hidden) closeClipEditor();
      }
    });

    // Copy setup commands
    document.querySelectorAll(".copy-cmd-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy") || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () {
              showToast("Command copied to clipboard.", "success");
            },
            function () {
              showToast("Copy failed — please select and copy manually.", "error");
            }
          );
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     Bootstrap
     ------------------------------------------------------------------------ */
  function init() {
    cacheDom();
    bindEvents();
    renderIcons();
    checkBackendHealth();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
