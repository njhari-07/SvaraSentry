import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Terminal } from "lucide-react";

export const CodeBlock: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const codeString = `import asyncio
import websockets
import json

# Connect to SvaraSentry Real-Time Audio Telemetry WebSocket
async def stream_audio_telemetry():
    uri = "ws://localhost:8000/ws/audio/active-call-001"
    async with websockets.connect(uri) as ws:
        # Stream 16 kHz Mono PCM audio chunks (200ms slices)
        await ws.send(pcm_chunk_bytes)
        
        # Receive live deepfake risk & operator guidance
        message = await ws.recv()
        result = json.loads(message)
        
        print(f"Deepfake Risk: {result['deepfake_probability']}%")
        print(f"Alert State:   {result['alert_level']}")
        print(f"Latency:       {result['latency_ms']} ms")

# Output:
# Deepfake Risk: 0.8%
# Alert State:   LOW
# Latency:       1.2 ms`;

  const copyCode = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="integration" className="relative z-10 py-24 px-6 max-w-5xl mx-auto">
      <div className="text-center max-w-xl mx-auto mb-14">
        <motion.span
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-xs font-mono uppercase tracking-widest text-violet-400 font-semibold"
        >
          02 // TELEMETRY WEBSOCKET API
        </motion.span>
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-3 mb-4 font-sans"
        >
          Stream & Verify in Real Time
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="text-white/60 text-base"
        >
          Connect straight to your SIP trunk, telephony gateway, or browser stream using standard WebSockets.
        </motion.p>
      </div>

      {/* Command Pill */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="flex items-center justify-between max-w-md mx-auto mb-8 px-5 py-3 rounded-full bg-black/60 border border-white/[0.1] backdrop-blur-xl font-mono text-xs text-white/80"
      >
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 font-bold">$</span>
          <span>curl -X GET http://localhost:8000/api/config</span>
        </div>
        <button
          onClick={() => {
            navigator.clipboard.writeText("curl -X GET http://localhost:8000/api/config");
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="text-white/50 hover:text-white transition-colors"
          title="Copy command"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </motion.div>

      {/* Terminal Code Window */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="rounded-3xl border border-white/[0.12] bg-[#07070f]/90 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden"
      >
        {/* Terminal Title Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="ml-3 font-mono text-xs text-white/40 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" /> telemetry_stream.py
            </span>
          </div>

          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] font-mono text-xs text-white/80 transition-all"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Code Content */}
        <div className="p-6 sm:p-8 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto text-white/80">
          <pre>
            <code>
              <span className="text-pink-400">import</span> asyncio{"\n"}
              <span className="text-pink-400">import</span> websockets{"\n"}
              <span className="text-pink-400">import</span> json{"\n\n"}
              <span className="text-white/40"># Connect to SvaraSentry Real-Time Audio Telemetry WebSocket</span>{"\n"}
              <span className="text-pink-400">async def</span> <span className="text-violet-300 font-bold">stream_audio_telemetry</span>():{"\n"}
              {"  "}uri = <span className="text-green-300">"ws://localhost:8000/ws/audio/active-call-001"</span>{"\n"}
              {"  "}<span className="text-pink-400">async with</span> websockets.connect(uri) <span className="text-pink-400">as</span> ws:{"\n"}
              {"    "}<span className="text-white/40"># Stream 16 kHz Mono PCM audio chunks (200ms slices)</span>{"\n"}
              {"    "}<span className="text-pink-400">await</span> ws.send(pcm_chunk_bytes){"\n\n"}
              {"    "}<span className="text-white/40"># Receive live deepfake risk & operator guidance</span>{"\n"}
              {"    "}message = <span className="text-pink-400">await</span> ws.recv(){"\n"}
              {"    "}result = json.loads(message){"\n\n"}
              {"    "}<span className="text-cyan-300">print</span>(f<span className="text-green-300">"Deepfake Risk: &#123;result['deepfake_probability']&#125;%"</span>){"\n"}
              {"    "}<span className="text-cyan-300">print</span>(f<span className="text-green-300">"Alert State:   &#123;result['alert_level']&#125;"</span>){"\n"}
              {"    "}<span className="text-cyan-300">print</span>(f<span className="text-green-300">"Latency:       &#123;result['latency_ms']&#125; ms"</span>){"\n"}
            </code>
          </pre>
        </div>
      </motion.div>
    </section>
  );
};

export default CodeBlock;
