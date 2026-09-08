import React, { useState, useEffect } from 'react';
import { Mic, Upload, Activity, Zap, Volume2, UserCheck, ArrowLeft, ShieldCheck, Radio, Lock, Square } from 'lucide-react';
import { WovenSkeleton } from '../WovenSkeleton';
import { WelcomeModal } from '../WelcomeModal';
import './Dashboard.css';

interface DashboardProps {
  onBackToLanding?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onBackToLanding }) => {
  const [session, setSession] = useState('demo-1');
  const [isRecording, setIsRecording] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [modalStep, setModalStep] = useState(1);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isRecording) {
      setRecordingSeconds(0);
      timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRecording]);

  const formatSeconds = (total: number) => {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleMicClick = () => {
    if (isRecording) {
      setIsRecording(false);
    } else {
      setModalStep(1);
      setShowWelcomeModal(true);
    }
  };

  const handleModalConfirm = () => {
    if (modalStep === 1) {
      setModalStep(2);
    } else {
      setShowWelcomeModal(false);
      setIsRecording(true);
    }
  };

  return (
    <div className="dashboard-shell">
      {/* Welcome / Onboarding Modal with Woven Textile Illustration */}
      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
        onConfirm={handleModalConfirm}
        illustrationColor="blue"
        eyebrow="Welcome"
        title={modalStep === 1 ? "Live Voice Analysis" : "Microphone Authorization"}
        subtitle={
          modalStep === 1
            ? "Continuous acoustic voice clone monitoring and deepfake defense"
            : "Activate your local browser microphone input to begin real-time analysis"
        }
        currentStep={modalStep}
        totalSteps={2}
        actionLabel={modalStep === 1 ? "Next" : "Start Monitoring"}
        bullets={
          modalStep === 1
            ? [
                {
                  icon: <Radio className="w-5 h-5" />,
                  text: "Real-time acoustic stream analysis over continuous 3-second stride windows"
                },
                {
                  icon: <ShieldCheck className="w-5 h-5" />,
                  text: "Dual-branch neural spoof detection and instant clone risk scoring"
                }
              ]
            : [
                {
                  icon: <Lock className="w-5 h-5" />,
                  text: "Audio stays in this session and is processed locally without server persistence"
                },
                {
                  icon: <Activity className="w-5 h-5" />,
                  text: "Spectrogram and session trend graphs generate automatically after first window"
                }
              ]
        }
      />

      {/* 1. Header Topbar */}
      <header className="dash-topbar">
        <div className="dash-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="dashShield" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="50%" stopColor="#60a5fa" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
                <linearGradient id="dashWave" x1="12" y1="6" x2="12" y2="18" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#7dd3fc" />
                </linearGradient>
              </defs>
              <path
                d="M12 2.5L4.5 5.5V11.5C4.5 16.2 7.7 20.6 12 21.8C16.3 20.6 19.5 16.2 19.5 11.5V5.5L12 2.5Z"
                stroke="url(#dashShield)"
                strokeWidth="1.8"
                strokeLinejoin="round"
                fill="rgba(56, 189, 248, 0.12)"
              />
              <path d="M8 10V14" stroke="url(#dashWave)" strokeWidth="2" strokeLinecap="round" />
              <path d="M10.7 7.5V16.5" stroke="url(#dashWave)" strokeWidth="2" strokeLinecap="round" />
              <path d="M13.3 6V18" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M16 8.5V15.5" stroke="url(#dashWave)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span>SvaraSentry<span className="dot">.</span></span>
          <span className="badge">DEFENSE</span>
        </div>

        <div className="dash-actions">
          {onBackToLanding && (
            <button className="dash-btn-ghost" onClick={onBackToLanding}>
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Landing</span>
            </button>
          )}

          <label className="dash-session-field">
            <span>SESSION</span>
            <input
              value={session}
              onChange={(e) => setSession(e.target.value)}
              maxLength={80}
              aria-label="Session ID"
            />
          </label>

          <div className="dash-status-pill">
            <span className="indicator" />
            <span>Ready</span>
          </div>
        </div>
      </header>

      {/* 2. Main Decision Panel */}
      <section className={`dash-decision-panel ${isRecording ? 'has-prominent-mic' : ''}`}>
        <div className="dash-decision-copy">
          <div className="dash-kicker">
            <span className="dot" />
            <span>LIVE ANALYSIS</span>
          </div>
          <h1>{isRecording ? 'Voice stream active' : 'Ready to monitor'}</h1>
          <p>{isRecording ? 'Continuous acoustic stream analysis in progress.' : 'Choose a microphone or audio file to begin real-time deepfake authenticity analysis.'}</p>

          <div className="flex flex-wrap gap-3">
            <button
              className={`dash-btn-primary ${isRecording ? 'bg-red-500/20 text-red-400 border-red-500/40' : ''}`}
              onClick={handleMicClick}
            >
              {isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
              <span>{isRecording ? 'Stop stream' : 'Start microphone'}</span>
            </button>

            {!isRecording && (
              <button className="dash-btn-secondary">
                <Upload className="w-4 h-4" />
                <span>Analyze a file</span>
              </button>
            )}
          </div>
        </div>

        {/* Big Prominent Live Microphone Centerpiece */}
        {isRecording && (
          <div className="dash-prominent-mic" aria-label="Microphone live recording active">
            <div className="dash-mic-orb-wrap" onClick={handleMicClick} title="Click to stop microphone">
              <span className="dash-mic-sonar" />
              <span className="dash-mic-sonar delay-1" />
              <span className="dash-mic-sonar delay-2" />
              <div className="dash-mic-orb">
                <Mic className="w-9 h-9" />
              </div>
            </div>

            <div className="dash-mic-status">
              <span className="dash-rec-badge">
                <span className="dash-rec-dot" /> LIVE RECORDING
              </span>
              <span className="dash-mic-timer">{formatSeconds(recordingSeconds)}</span>
              <span className="dash-mic-caption">Acoustic Stream · 16 kHz</span>
            </div>

            <div className="dash-mic-equalizer" aria-hidden="true">
              {[35, 75, 50, 90, 65, 80, 45, 60].map((h, i) => (
                <span
                  key={i}
                  className="dash-eq-bar"
                  style={{
                    height: `${h}%`,
                    animation: `pulseHeight 0.8s ease-in-out infinite alternate ${i * 0.1}s`,
                  }}
                />
              ))}
            </div>

            <button
              type="button"
              className="dash-mic-stop-btn"
              onClick={handleMicClick}
              title="Stop microphone recording"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop Recording</span>
            </button>
          </div>
        )}

        <div className="dash-gauge-wrap">
          <div className="dash-gauge" style={{ ['--risk' as string]: 0 }}>
            <div className="dash-gauge-inner">
              <strong>—</strong>
              <small>CLONE RISK</small>
            </div>
          </div>
          <span className="dash-risk-badge">Waiting</span>
        </div>
      </section>

      {/* 3. Session Metrics Grid */}
      <section className="dash-metric-grid">
        <div className="dash-metric-card">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 grid place-content-center text-blue-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <small>DETECTION ENGINE</small>
            <strong>Dual-Branch Conv</strong>
            <span>Active check</span>
          </div>
        </div>

        <div className="dash-metric-card">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 grid place-content-center text-cyan-400">
            <Volume2 className="w-4 h-4" />
          </div>
          <div>
            <small>SIGNAL QUALITY</small>
            <strong>{isRecording ? 'Nominal' : 'No signal'}</strong>
            <span>{isRecording ? '-24 dBFS' : '— dBFS'}</span>
          </div>
        </div>

        <div className="dash-metric-card">
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 grid place-content-center text-sky-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <small>PROCESSING</small>
            <strong>{isRecording ? '38 ms' : '— ms'}</strong>
            <span>{isRecording ? '3 windows analyzed' : '0 windows'}</span>
          </div>
        </div>

        <div className="dash-metric-card">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 grid place-content-center text-indigo-400">
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <small>VOICE IDENTITY</small>
            <strong>Not enrolled</strong>
            <span>Optional second signal</span>
          </div>
        </div>
      </section>

      {/* 4. Analysis Grid (Spectrogram & Risk Timeline) */}
      <section className="dash-analysis-grid">
        {/* Spectrogram Panel - UNTOUCHED original placeholder */}
        <article className="dash-panel">
          <div className="dash-panel-head">
            <div>
              <span className="dash-kicker">ACOUSTIC VIEW</span>
              <h2>Spectrogram</h2>
            </div>
            <div className="font-mono text-xs text-slate-400">
              Voice energy &middot; Anomaly focus
            </div>
          </div>

          <div className="dash-spec-stage">
            <div className="dash-spec-axis">
              <span>8 kHz</span>
              <span>4 kHz</span>
              <span>0 Hz</span>
            </div>
            <div className="dash-spec-frame">
              <div className="dash-spec-empty">
                <span className="wave">▂▅▃▇▂▆▃▅</span>
                <p>Spectrogram appears after the first 3-second window</p>
              </div>
            </div>
          </div>
          <div className="dash-time-axis">
            <span>−3.0s</span>
            <span>−2.0s</span>
            <span>−1.0s</span>
            <span>Now</span>
          </div>
        </article>

        {/* Risk Timeline Panel - Content-Aware 40-Bar WovenSkeleton Component */}
        <article className="dash-panel">
          <div className="dash-panel-head">
            <div>
              <span className="dash-kicker">SESSION TREND</span>
              <h2>Risk timeline</h2>
            </div>
            <span className="font-mono text-xs text-slate-400 px-2 py-0.5 rounded bg-white/5 border border-white/10">
              0 windows
            </span>
          </div>

          <div className="dash-timeline-stage">
            <WovenSkeleton
              variant="timeline"
              color="blue"
              copy="Awaiting session telemetry & risk analysis stream…"
            />
          </div>

          <div className="dash-threshold-key">
            <span><i className="safe" />Low</span>
            <span><i className="caution" />Caution 55%</span>
            <span><i className="high" />High 75%</span>
          </div>
        </article>
      </section>
    </div>
  );
};

export default Dashboard;
