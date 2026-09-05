const button = document.getElementById("relay-button");
const stateLabel = document.getElementById("relay-state");
const copy = document.getElementById("relay-copy");
const orb = document.getElementById("orb");

const statLevel = document.getElementById("stat-level");
const statTime = document.getElementById("stat-time");
const statConn = document.getElementById("stat-conn");
const statDropped = document.getElementById("stat-dropped");
const statsDiv = document.getElementById("stats");

let socket = null, context = null, stream = null, processor = null, wakeLock = null;
let targetRate = 16000;
let connectionState = "idle"; // idle -> requesting_permission -> connecting -> streaming -> reconnecting -> stopping -> stopped
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let startTime = null;
let timerInterval = null;
let droppedFrames = 0;

const pairingToken = new URLSearchParams(location.search).get("pair");

if (!window.isSecureContext && location.hostname !== "localhost") {
  document.getElementById("secure-note").hidden = false;
  setState("actionable_error", "Insecure Context", "Microphone access requires HTTPS.");
} else if (!pairingToken) {
  setState("actionable_error", "Missing Token", "No pairing token found in URL. Please scan the QR code from the dashboard again.");
} else {
  setState("idle", "Ready to relay", "Tap below to share your microphone with the dashboard.");
  button.hidden = false;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateTimer() {
  if (startTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    statTime.textContent = formatTime(elapsed);
  }
}

function setState(newState, title, desc) {
  connectionState = newState;
  stateLabel.textContent = title;
  copy.textContent = desc;
  
  if (newState === "idle" || newState === "actionable_error" || newState === "stopped") {
    button.textContent = "Start relay";
    button.className = "";
    orb.className = "orb";
    statsDiv.hidden = true;
  } else if (newState === "streaming") {
    button.textContent = "Stop relay";
    button.className = "stop";
    orb.className = "orb live";
    statsDiv.hidden = false;
  } else if (newState === "reconnecting") {
    button.textContent = "Cancel reconnect";
    button.className = "stop";
    orb.className = "orb reconnect";
    statsDiv.hidden = false;
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock was released');
      });
    }
  } catch (err) {
    console.error(err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

async function start() {
  if (connectionState === "streaming" || connectionState === "connecting") return;
  setState("requesting_permission", "Requesting Microphone", "Please allow microphone access.");
  
  try {
    const config = await fetch("/api/config").then((response) => response.json());
    targetRate = config.sample_rate;
    
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
    await connectWebSocket();
  } catch (error) {
    setState("actionable_error", "Permission Denied", "Microphone access was denied or no microphone was found.");
    await cleanup();
  }
}

async function connectWebSocket() {
  setState("connecting", "Connecting", "Connecting to dashboard...");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  
  return new Promise((resolve, reject) => {
    socket = new WebSocket(`${protocol}://${location.host}/ws/audio/pair/${pairingToken}`);
    socket.binaryType = "arraybuffer";
    
    socket.onopen = async () => {
      reconnectAttempts = 0;
      await setupAudioProcessing();
      resolve();
    };
    
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "error") {
            setState("actionable_error", "Connection Error", data.message);
            stop();
        }
      } catch (e) {}
    };
    
    socket.onerror = () => {
      if (connectionState === "connecting") {
        reject(new Error("Could not reach the dashboard server"));
      }
    };
    
    socket.onclose = async (event) => {
      if (connectionState === "stopping" || connectionState === "stopped" || connectionState === "actionable_error") return;
      if (event.code === 1008) {
         setState("actionable_error", "Session Error", event.reason || "Invalid pairing token or session full.");
         await cleanup();
         return;
      }
      handleDisconnect();
    };
  });
}

async function setupAudioProcessing() {
  try {
    context = new AudioContext();
    await context.audioWorklet.addModule("/static/audio_processor.js");
    
    const source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'relay-processor', {
      processorOptions: { targetRate }
    });
    
    processor.port.onmessage = (event) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > targetRate * 2 * 4) { // 4 seconds of PCM16 (targetRate is sample rate, x2 for 16-bit, x4 seconds)
           droppedFrames++;
           statDropped.textContent = droppedFrames;
        } else {
           socket.send(event.data.buffer);
        }
        
        statLevel.textContent = Math.round(event.data.dbfs);
        // Also periodically send status updates
        if (Math.random() < 0.05) {
            socket.send(JSON.stringify({ type: "status", dropped_frames: droppedFrames }));
        }
      }
    };
    
    source.connect(processor);
    processor.connect(context.destination);
    
    setState("streaming", "Relaying securely", "Live audio is feeding the session.");
    statConn.textContent = "Healthy";
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    await requestWakeLock();
  } catch (err) {
    setState("actionable_error", "Audio Error", "Failed to setup audio processing.");
    await cleanup();
  }
}

async function handleDisconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    setState("actionable_error", "Disconnected", "Lost connection to the dashboard and could not reconnect.");
    await cleanup();
    return;
  }
  
  reconnectAttempts++;
  setState("reconnecting", "Reconnecting", `Attempt ${reconnectAttempts} of ${maxReconnectAttempts}...`);
  statConn.textContent = "Reconnecting...";
  
  const backoffDelay = Math.min(1000 * Math.pow(2, reconnectAttempts) + Math.random() * 500, 10000);
  setTimeout(() => {
    if (connectionState === "reconnecting") {
      connectWebSocket().catch(() => handleDisconnect());
    }
  }, backoffDelay);
}

async function stop() {
  setState("stopping", "Stopping", "Cleaning up...");
  await cleanup();
  if (connectionState !== "actionable_error") {
    setState("stopped", "Relay stopped", "Audio is no longer being sent to the dashboard.");
  }
}

async function cleanup() {
  processor?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  if (context && context.state !== "closed") await context.close();
  socket?.close();
  clearInterval(timerInterval);
  releaseWakeLock();
  
  socket = context = stream = processor = null;
  startTime = null;
}

button.addEventListener("click", () => {
  if (connectionState === "idle" || connectionState === "actionable_error" || connectionState === "stopped") {
    start();
  } else {
    stop();
  }
});

window.addEventListener("beforeunload", stop);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === 'visible' && connectionState === "streaming") {
    requestWakeLock();
  }
});
