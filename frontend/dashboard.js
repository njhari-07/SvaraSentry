// Acoustic panel is loaded as an ES module — wait for it before first render
let acousticPanel = null;
import("/static/acoustic_panel.js")
  .then(({ createAcousticPanel }) => { acousticPanel = createAcousticPanel(); })
  .catch(() => { /* acoustic panel unavailable — spectrogram still shows via fallback */ });

const state = {
  config: null,
  monitorSocket: null,
  audioSocket: null,
  reconnectTimer: null,
  pingTimer: null,
  audioContext: null,
  mediaStream: null,
  processor: null,
  values: [],
  lastLevel: "none",
  activeSource: null,
};

const $ = (id) => document.getElementById(id);
const sessionId = () => $("session").value.trim() || "demo-1";
const socketUrl = (path) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;

async function initialize() {
  try {
    state.config = await fetch("/api/config").then((response) => {
      if (!response.ok) throw new Error("Runtime is unavailable");
      return response.json();
    });
    $("model-value").textContent = friendlyModel(state.config.model_kind);
    $("model-detail").textContent = state.config.model_mode === "baseline" ? "Pipeline validation" : "Checkpoint loaded";
    $("mode-banner").hidden = !state.config.baseline_disclaimer;
    $("footer-runtime").textContent = `${state.config.sample_rate / 1000} kHz · ${state.config.window_seconds}s window · ${state.config.stride_seconds}s stride`;
    connectMonitor();
  } catch (error) {
    setConnection(false, "Backend offline");
    $("source-status").textContent = error.message;
  }
  drawTimeline();
}

function friendlyModel(kind) {
  return kind === "integration-baseline" ? "Demo baseline" : kind.replaceAll("-", " ");
}

function setConnection(connected, label = connected ? "Connected" : "Reconnecting") {
  $("connection").className = `connection ${connected ? "online" : "offline"}`;
  $("connection").innerHTML = `<i></i>${label}`;
}

function connectMonitor() {
  clearTimeout(state.reconnectTimer);
  clearInterval(state.pingTimer);
  state.monitorSocket?.close();
  const socket = new WebSocket(socketUrl(`/ws/dashboard/${encodeURIComponent(sessionId())}`));
  state.monitorSocket = socket;
  socket.onopen = () => {
    setConnection(true);
    state.pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 20000);
  };
  socket.onmessage = ({ data }) => handleMessage(JSON.parse(data));
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    setConnection(false);
    clearInterval(state.pingTimer);
    if (state.monitorSocket === socket) state.reconnectTimer = setTimeout(connectMonitor, 1800);
  };
}

function handleMessage(message) {
  if (message.type === "result") renderResult(message);
  if (message.type === "snapshot") {
    setIdentity(message.voice_enrolled, message.latest?.identity_match);
    if (message.latest) renderResult(message.latest);
  }
  if (message.type === "source") setSourceConnected(message.connected);
  if (message.type === "source_status") handleSourceStatus(message);
  if (message.type === "enrollment") setIdentity(message.voice_enrolled, null);
  if (message.type === "reset") resetDisplay();
}

function handleSourceStatus(message) {
  if (message.source === "phone") {
    if (message.state === "streaming") {
      const dialog = $("pairing-dialog");
      if (dialog && dialog.open) dialog.close();
      state.activeSource = "phone";
      let statusStr = "Phone connected";
      if (message.network_state === "degraded") statusStr += " (Degraded network)";
      if (message.dropped_frames > 0) statusStr += ` · ${message.dropped_frames} frames dropped`;
      showActiveSource(statusStr);
    } else if (message.state === "stopped") {
      if (state.activeSource === "phone") stopAudio();
    }
  }
}

function renderResult(result) {
  const risk = Math.max(0, Math.min(1, Number(result.smoothed_risk)));
  const percent = Math.round(risk * 100);
  $("gauge").style.setProperty("--risk", percent);
  $("risk-value").textContent = percent;
  $("risk-unit").hidden = false;
  const labels = { none: "Low risk", caution: "Caution", high: "High risk" };
  $("risk-badge").textContent = labels[result.alert_level];
  $("risk-badge").className = `risk-badge ${result.alert_level}`;
  $("live-dot").className = "live";
  updateDecision(result.alert_level);

  if (result.signal) {
    $("signal-value").textContent = titleCase(result.signal.state);
    $("signal-detail").textContent = `${result.signal.rms_dbfs} dBFS · peak ${Math.round(result.signal.peak * 100)}%`;
  }
  $("latency-value").textContent = `${Math.round(result.processing_ms)} ms`;
  $("chunk-detail").textContent = `${result.chunk_index} window${result.chunk_index === 1 ? "" : "s"} analyzed`;
  $("window-count").textContent = `${result.chunk_index} window${result.chunk_index === 1 ? "" : "s"}`;
  setIdentity(result.voice_enrolled, result.identity_match);

  if (acousticPanel) {
    acousticPanel.update(result);
  } else {
    // Fallback for very early renders before ES module resolves
    if (result.spectrogram_png_b64) {
      $("spectrogram").src = `data:image/png;base64,${result.spectrogram_png_b64}`;
      $("spectrogram").classList.add("visible");
      $("spectrogram-empty").hidden = true;
    }
    const overlay = $("attention-region");
    if (overlay) {
      const region = result.flagged_region;
      const meta = result.spectrogram;
      if (region?.time_offset_ms && meta) {
        const [start, end] = region.time_offset_ms;
        const totalMs = (meta.window_seconds ?? 3.0) * 1000;
        const cs = Math.max(0, start), ce = Math.min(totalMs, end);
        if (ce > cs) {
          overlay.style.left = `${(cs / totalMs * 100).toFixed(2)}%`;
          overlay.style.width = `${Math.max(2, (ce - cs) / totalMs * 100).toFixed(2)}%`;
          overlay.hidden = false;
        } else { overlay.hidden = true; }
      } else { overlay.hidden = true; }
    }
  }
  state.values.push({ risk, raw: Number(result.risk_score), level: result.alert_level });
  state.values = state.values.slice(-120);
  drawTimeline();
  if (result.alert_level !== state.lastLevel) {
    addEvent(result.alert_level, labels[result.alert_level], decisionText(result.alert_level));
    state.lastLevel = result.alert_level;
  }
}

function decisionText(level) {
  return {
    none: "The current signal remains below the caution threshold.",
    caution: "Pause sensitive actions and verify the caller with a known detail.",
    high: "End the call and verify identity through a trusted channel.",
  }[level];
}

function updateDecision(level) {
  const content = {
    none: ["Voice appears consistent", decisionText(level), "No action needed", "Continue the call, but stay alert to unusual requests."],
    caution: ["Verification recommended", decisionText(level), "Verify before acting", "Ask a question only the real caller should know. Do not share credentials or transfer funds."],
    high: ["Possible synthetic voice", decisionText(level), "Stop and verify", "End the call. Contact the person through a saved number or another trusted channel."],
  }[level];
  $("decision-title").textContent = content[0];
  $("decision-guidance").textContent = content[1];
  $("response-title").textContent = content[2];
  $("response-copy").textContent = content[3];
  const response = document.querySelector(".response-card");
  response.className = `response-card ${level === "none" ? "" : level}`;
  document.querySelector(".response-icon").textContent = level === "none" ? "✓" : level === "caution" ? "!" : "×";
}

function setIdentity(enrolled, match) {
  if (!enrolled) {
    $("identity-value").textContent = "Not enrolled";
    $("identity-detail").textContent = "Optional second signal";
    $("enroll-open").textContent = "Enroll";
    return;
  }
  $("identity-value").textContent = match == null ? "Enrolled" : `${Math.round(match * 100)}% match`;
  $("identity-detail").textContent = match == null ? "Waiting for live speech" : "Compared with reference";
  $("enroll-open").textContent = "Manage";
}


function addEvent(level, title, copy) {
  const list = $("event-list");
  list.querySelector(".empty-event")?.remove();
  const item = document.createElement("li");
  item.className = level;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.innerHTML = `<span></span><div><strong>${title}</strong><p>${copy}</p></div><time>${time}</time>`;
  list.prepend(item);
}

function setSourceConnected(connected) {
  if (!connected && state.activeSource) stopAudio(false);
}

async function openAudioSocket() {
  if (state.audioSocket?.readyState === WebSocket.OPEN) return state.audioSocket;
  const socket = new WebSocket(socketUrl(`/ws/audio/${encodeURIComponent(sessionId())}`));
  socket.binaryType = "arraybuffer";
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "error") $("source-status").textContent = message.message;
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Could not open the audio stream"));
  });
  state.audioSocket = socket;
  return socket;
}

async function startMicrophone() {
  try {
    await stopAudio();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
    state.mediaStream = stream;
    const socket = await openAudioSocket();
    const context = new AudioContext();
    state.audioContext = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain();
    silent.gain.value = 0;
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > state.config.sample_rate * 2 * 4) return;
      socket.send(floatToPcm16(resample(inputBuffer.getChannelData(0), context.sampleRate, state.config.sample_rate)));
    };
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    Object.assign(state, { processor, activeSource: "microphone" });
    showActiveSource("Microphone live · first score arrives after 3 seconds");
  } catch (error) {
    $("source-status").textContent = error.message;
    await stopAudio();
  }
}

async function streamFile(file) {
  try {
    await stopAudio();
    const decodeContext = new AudioContext();
    const decoded = await decodeContext.decodeAudioData(await file.arrayBuffer());
    await decodeContext.close();
    const mono = decoded.getChannelData(0);
    const samples = resample(mono, decoded.sampleRate, state.config.sample_rate);
    if (samples.length < state.config.sample_rate * state.config.window_seconds) throw new Error(`Audio must be at least ${state.config.window_seconds} seconds`);
    const socket = await openAudioSocket();
    state.activeSource = "file";
    showActiveSource(`Streaming ${file.name}`);
    const frameSamples = Math.round(state.config.sample_rate * .25);
    for (let offset = 0; offset < samples.length && state.activeSource === "file"; offset += frameSamples) {
      socket.send(floatToPcm16(samples.subarray(offset, offset + frameSamples)));
      const progress = Math.min(100, Math.round((offset + frameSamples) / samples.length * 100));
      $("source-status").textContent = `${file.name} · ${progress}% streamed`;
      await delay(250);
    }
    if (state.activeSource === "file") {
      $("source-status").textContent = `${file.name} · analysis complete`;
      await stopAudio(false);
    }
  } catch (error) {
    $("source-status").textContent = error.message;
    await stopAudio();
  }
}

function resample(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return new Float32Array(input);
  const output = new Float32Array(Math.round(input.length * targetRate / sourceRate));
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const mix = position - left;
    output[index] = input[left] * (1 - mix) + (input[Math.min(left + 1, input.length - 1)] || 0) * mix;
  }
  return output;
}

function floatToPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = value < 0 ? value * 32768 : value * 32767;
  }
  return pcm.buffer;
}

async function stopAudio(updateStatus = true) {
  state.activeSource = null;
  state.processor?.disconnect();
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  if (state.audioContext && state.audioContext.state !== "closed") await state.audioContext.close();
  state.audioSocket?.close();
  Object.assign(state, { processor: null, mediaStream: null, audioContext: null, audioSocket: null });
  $("mic-button").hidden = false;
  document.querySelector("label[for='audio-file']").hidden = false;
  $("phone-button").hidden = false;
  $("stop-button").hidden = true;
  if (updateStatus) $("source-status").textContent = "Audio stream stopped.";
}

function showActiveSource(status) {
  $("mic-button").hidden = true;
  document.querySelector("label[for='audio-file']").hidden = true;
  $("phone-button").hidden = true;
  $("stop-button").hidden = false;
  $("source-status").textContent = status;
}

async function enroll(file) {
  const form = new FormData();
  form.append("audio", file);
  $("enroll-status").textContent = "Creating the voice reference…";
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId())}/enrollment`, { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || "Enrollment failed");
    $("enroll-status").textContent = `Voice enrolled from ${body.duration_seconds}s of audio.`;
    setIdentity(true, null);
    addEvent("none", "Trusted voice enrolled", "Future windows will include an identity similarity signal.");
  } catch (error) {
    $("enroll-status").textContent = error.message;
  }
}

async function removeEnrollment() {
  await fetch(`/api/sessions/${encodeURIComponent(sessionId())}/enrollment`, { method: "DELETE" });
  $("enroll-status").textContent = "Voice reference removed.";
  setIdentity(false, null);
}

async function resetSession() {
  await stopAudio(false);
  await fetch(`/api/sessions/${encodeURIComponent(sessionId())}/reset`, { method: "POST" });
  resetDisplay();
}

function resetDisplay() {
  if (acousticPanel) acousticPanel.reset();
  state.values = [];
  state.lastLevel = "none";
  $("gauge").style.setProperty("--risk", 0);
  $("risk-value").textContent = "—";
  $("risk-unit").hidden = true;
  $("risk-badge").textContent = "Waiting";
  $("risk-badge").className = "risk-badge neutral";
  $("live-dot").className = "";
  $("decision-title").textContent = "Ready to monitor";
  $("decision-guidance").textContent = "Choose a microphone or audio file to begin a session.";
  $("signal-value").textContent = "No signal";
  $("signal-detail").textContent = "— dBFS";
  $("latency-value").textContent = "— ms";
  $("chunk-detail").textContent = "0 windows analyzed";
  $("window-count").textContent = "0 windows";
  $("spectrogram").classList.remove("visible");
  $("spectrogram-empty").hidden = false;
  $("attention-region").hidden = true;
  $("event-list").innerHTML = '<li class="empty-event"><span></span><div><strong>No events yet</strong><p>Risk transitions and identity checks will appear here.</p></div></li>';
  updateDecision("none");
  drawTimeline();
}

function drawTimeline() {
  const canvas = $("timeline");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height, pad = { top: 10, right: 8, bottom: 16, left: 7 };
  const chartHeight = height - pad.top - pad.bottom;
  ctx.fillStyle = "rgba(244,199,93,.035)"; ctx.fillRect(pad.left, pad.top + chartHeight * .25, width - pad.left - pad.right, chartHeight * .2);
  ctx.fillStyle = "rgba(255,109,109,.045)"; ctx.fillRect(pad.left, pad.top, width - pad.left - pad.right, chartHeight * .25);
  ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
  [[.75, "rgba(255,109,109,.35)"], [.55, "rgba(244,199,93,.3)"], [.25, "rgba(121,160,148,.14)"]].forEach(([value, color]) => {
    const y = pad.top + chartHeight * (1 - value); ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  });
  ctx.setLineDash([]);
  if (state.values.length < 2) {
    ctx.fillStyle = "#617a72"; ctx.font = "13px DM Sans"; ctx.textAlign = "center"; ctx.fillText("Risk history appears here", width / 2, height / 2); return;
  }
  const gradient = ctx.createLinearGradient(0, 0, width, 0); gradient.addColorStop(0, "#52dfb0"); gradient.addColorStop(.65, "#f4c75d"); gradient.addColorStop(1, "#ff6d6d");
  ctx.strokeStyle = gradient; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.beginPath();
  state.values.forEach(({ risk }, index) => {
    const x = pad.left + index * (width - pad.left - pad.right) / Math.max(1, state.values.length - 1);
    const y = pad.top + chartHeight * (1 - risk);
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }); ctx.stroke();
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const titleCase = (value) => value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
$("mic-button").addEventListener("click", startMicrophone);
$("phone-button").addEventListener("click", async () => {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId())}/pairing-token`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Could not generate pairing token");
    
    const pairingUrl = new URL(`/phone?pair=${data.token}`, location.href).toString();
    const qrContainer = $("qrcode-container");
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
      text: pairingUrl,
      width: 200,
      height: 200,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
    
    $("pairing-link").href = pairingUrl;
    $("pairing-link").textContent = pairingUrl;
    $("pairing-dialog").showModal();
  } catch (err) {
    $("source-status").textContent = err.message;
  }
});
$("stop-button").addEventListener("click", () => stopAudio());
$("audio-file").addEventListener("change", ({ target }) => { if (target.files[0]) streamFile(target.files[0]); target.value = ""; });
$("session").addEventListener("change", async () => { await stopAudio(false); resetDisplay(); connectMonitor(); });
$("reset-button").addEventListener("click", resetSession);
$("enroll-open").addEventListener("click", () => $("enroll-dialog").showModal());
$("enrollment-file").addEventListener("change", ({ target }) => { if (target.files[0]) enroll(target.files[0]); target.value = ""; });
$("remove-enrollment").addEventListener("click", removeEnrollment);
window.addEventListener("resize", drawTimeline);
window.addEventListener("beforeunload", () => stopAudio(false));
initialize();
