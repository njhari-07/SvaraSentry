const button = document.getElementById("relay-button");
const sessionInput = document.getElementById("relay-session");
const stateLabel = document.getElementById("relay-state");
const copy = document.getElementById("relay-copy");
const orb = document.getElementById("orb");
let socket = null, context = null, stream = null, processor = null;
let targetRate = 16000;

const querySession = new URLSearchParams(location.search).get("session");
if (querySession) sessionInput.value = querySession;
if (!window.isSecureContext && location.hostname !== "localhost") document.getElementById("secure-note").hidden = false;

async function start() {
  try {
    const config = await fetch("/api/config").then((response) => response.json());
    targetRate = config.sample_rate;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const session = encodeURIComponent(sessionInput.value.trim() || "demo-1");
    socket = new WebSocket(`${protocol}://${location.host}/ws/audio/${session}`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("Could not reach the dashboard server")); });
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain(); silent.gain.value = 0;
    processor.onaudioprocess = ({ inputBuffer }) => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > targetRate * 8) return;
      socket.send(toPcm(resample(inputBuffer.getChannelData(0), context.sampleRate, targetRate)));
    };
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    sessionInput.disabled = true; button.textContent = "Stop relay"; button.className = "stop"; orb.className = "orb live";
    stateLabel.textContent = "Relaying securely"; copy.textContent = `Live audio is feeding session “${sessionInput.value}”. Keep this screen awake.`;
  } catch (error) { stateLabel.textContent = "Could not start"; copy.textContent = error.message; await stop(); }
}

async function stop() {
  processor?.disconnect(); stream?.getTracks().forEach((track) => track.stop());
  if (context && context.state !== "closed") await context.close(); socket?.close();
  socket = context = stream = processor = null; sessionInput.disabled = false; button.textContent = "Start microphone relay"; button.className = ""; orb.className = "orb";
  if (stateLabel.textContent !== "Could not start") { stateLabel.textContent = "Relay stopped"; copy.textContent = "Audio is no longer being sent to the dashboard."; }
}

function resample(input, sourceRate, outputRate) {
  if (sourceRate === outputRate) return new Float32Array(input);
  const output = new Float32Array(Math.round(input.length * outputRate / sourceRate)); const ratio = sourceRate / outputRate;
  for (let index = 0; index < output.length; index++) { const position = index * ratio, left = Math.floor(position), mix = position - left; output[index] = input[left] * (1 - mix) + (input[Math.min(left + 1, input.length - 1)] || 0) * mix; }
  return output;
}
function toPcm(samples) { const pcm = new Int16Array(samples.length); for (let index = 0; index < samples.length; index++) { const value = Math.max(-1, Math.min(1, samples[index])); pcm[index] = value < 0 ? value * 32768 : value * 32767; } return pcm.buffer; }
button.addEventListener("click", () => socket ? stop() : start());
window.addEventListener("beforeunload", stop);

