"use client";

import { useState } from "react";
import type { AnalysisResult, FinalSessionSummary, RuntimeConfig } from "@/lib/types";
import styles from "./risk-timeline.module.css";

function audioTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60).toString().padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function RiskTimeline({ points, config, finalSummary, finalizing }: {
  points: AnalysisResult[]; config: RuntimeConfig; finalSummary: FinalSessionSummary | null; finalizing: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = points.find((point) => point.chunk_index === selectedIndex) ?? points.at(-1);
  const end = (point: AnalysisResult) => point.timestamp ?? config.window_seconds + (point.chunk_index - 1) * config.stride_seconds;
  const from = points.length ? Math.max(0, end(points[0]) - config.window_seconds) : 0;
  const to = points.length ? Math.max(from + config.window_seconds, end(points[points.length - 1])) : config.window_seconds;
  const x = (seconds: number) => 48 + (seconds - from) / (to - from) * 540;
  const y = (risk: number) => 190 - Math.max(0, Math.min(1, risk)) * 160;
  const line = (field: "risk_score" | "smoothed_risk") => points.map((point, index) => `${index ? "L" : "M"}${x(end(point))},${y(point[field])}`).join(" ");
  const thresholds = [{ value: config.caution_threshold, label: "Caution", color: "#fbbf24" },
    { value: config.high_threshold, label: "High", color: "#fb7185" }];
  return (
    <div className={styles.root}>
      <p className={styles.cadence}>{config.window_seconds}s audio windows · {config.stride_seconds}s stride · {finalSummary ? "Finalized" : finalizing ? "Finishing queued audio" : "Live window history"}</p>
      <p className={styles.note}>First analysis: 0–{config.window_seconds}s. Then {config.stride_seconds}–{config.window_seconds + config.stride_seconds}s. Times below are positions in the audio, not result arrival times.</p>
      {!points.length ? <div className={styles.empty}>Waiting for the first complete {config.window_seconds}-second window.</div> : <>
        <div className={styles.legend}><span style={{color: "#7dd3fc"}}>● Window risk</span><span style={{color: "#a78bfa"}}>● Smoothed live risk</span>{finalSummary && <span style={{color: "#6ee7b7"}}>— Final mean {percent(finalSummary.average_risk)}</span>}</div>
        <svg className={styles.chart} viewBox="0 0 640 235" role="img" aria-label={`Risk over audio time ${audioTime(from)} to ${audioTime(to)}. Select a window in the table for details.`}>
          {[0, 0.25, 0.5, 0.75, 1].map((value) => <g key={value}><line x1="48" x2="588" y1={y(value)} y2={y(value)} stroke="#26354a"/><text x="40" y={y(value) + 4} textAnchor="end">{value * 100}%</text></g>)}
          {thresholds.map(({value, label, color}) => value == null ? null : <g key={label}><line x1="48" x2="588" y1={y(value)} y2={y(value)} stroke={color} strokeDasharray="5 5" opacity=".65"/><text x="588" y={y(value) - 5} textAnchor="end" fill={color}>{label} {percent(value)}</text></g>)}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <text key={fraction} x={48 + 540 * fraction} y="213" textAnchor="middle">{audioTime(from + (to - from) * fraction)}</text>)}
          <text x="318" y="232" textAnchor="middle">Audio elapsed · window end time</text>
          <path d={line("risk_score")} fill="none" stroke="#7dd3fc" strokeWidth="2"/>
          <path d={line("smoothed_risk")} fill="none" stroke="#a78bfa" strokeWidth="2.5"/>
          {finalSummary && <line x1="48" x2="588" y1={y(finalSummary.average_risk)} y2={y(finalSummary.average_risk)} stroke="#6ee7b7" strokeDasharray="8 4"/>}
          {selected && <g><line x1={x(end(selected))} x2={x(end(selected))} y1="30" y2="190" stroke="#cbd5e1" opacity=".35"/><circle cx={x(end(selected))} cy={y(selected.risk_score)} r="4" fill="#7dd3fc"/><circle cx={x(end(selected))} cy={y(selected.smoothed_risk)} r="4" fill="#a78bfa"/></g>}
        </svg>
        {selected && <div className={styles.detail}>
          <strong>Window #{selected.chunk_index} · {audioTime(end(selected) - config.window_seconds)}–{audioTime(end(selected))}</strong>
          <span>Model output: {selected.fake_probability == null ? "unavailable" : percent(selected.fake_probability)} · Window risk: {percent(selected.risk_score)} · Smoothed: {percent(selected.smoothed_risk)}</span>
          <span>Processing: {Math.round(selected.processing_ms)} ms · Input: {selected.signal ? `${selected.signal.rms_dbfs.toFixed(1)} dBFS · ${selected.signal.state}` : "unavailable"}</span>
          <button type="button" onClick={() => setSelectedIndex(null)}>Follow latest window</button>
        </div>}
        <details className={styles.log}>
          <summary>Window log · {points.length} retained windows</summary>
          <div className={styles.scroll}><table><caption>Select a window to inspect its scores above.</caption><thead><tr><th>Window / audio time</th><th>Risk</th><th>Smoothed</th><th>Processing</th></tr></thead><tbody>
            {[...points].reverse().map((point) => <tr key={point.chunk_index} aria-selected={selected?.chunk_index === point.chunk_index}>
              <td><button type="button" onClick={() => setSelectedIndex(point.chunk_index)}>#{point.chunk_index} · {audioTime(end(point) - config.window_seconds)}–{audioTime(end(point))}</button></td>
              <td>{percent(point.risk_score)}</td><td>{percent(point.smoothed_risk)}</td><td>{Math.round(point.processing_ms)} ms</td>
            </tr>)}
          </tbody></table></div>
        </details>
        <p className={styles.note}>Showing up to 120 windows received by this dashboard; reconnects may leave gaps. The final mean uses all server-analyzed windows, not just this visible history. Window risk includes identity fusion when enrolled; smoothed risk is the live trend.</p>
      </>}
    </div>
  );
}
