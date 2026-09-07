import React, { useState } from 'react';
import { Mic, Upload, Activity, Zap, Volume2, UserCheck, ArrowLeft, ShieldCheck, Radio, Lock } from 'lucide-react';
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
      <section className="dash-decision-panel">
        <div className="dash-decision-copy">
          <div className="dash-kicker">
            <span className="dot" />
            <span>LIVE ANALYSIS</span>
          </div>
          <h1>Ready to monitor</h1>
          <p>Choose a microphone or audio file to begin real-time deepfake authenticity analysis.</p>

          <div className="flex flex-wrap gap-3">
            <button
              className="dash-btn-primary"
              onClick={handleMicClick}
            >
              <Mic className="w-4 h-4" />
              <span>{isRecording ? 'Stop stream' : 'Start microphone'}</span>
            </button>

            <button className="dash-btn-secondary">
              <Upload className="w-4 h-4" />
              <span>Analyze a file</span>
            </button>
          </div>
        </div>

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
