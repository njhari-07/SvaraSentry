"use client";
import React, { useEffect } from 'react';
import { ArrowRight, X } from 'lucide-react';
// CSS included via globals.css

export interface WelcomeModalBullet {
  icon: React.ReactNode;
  text: string;
}

export interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  illustrationColor?: 'tan' | 'blue' | 'emerald';
  icon?: React.ReactNode;
  eyebrow?: string;
  title: string;
  subtitle: string;
  bullets: WelcomeModalBullet[];
  currentStep?: number;
  totalSteps?: number;
  actionLabel?: string;
}

// 42 distinct mosaic blocks with varied colors and patterns for the handwoven textile look
const MOSAIC_BLOCKS = [
  { bg: 'var(--b1)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b2)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b3)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b4)', pat: 'pat-rev-diag', span: '' },
  { bg: 'var(--b5)', pat: 'pat-fine-lines', span: '' },
  { bg: 'var(--b6)', pat: 'pat-weave', span: '' },

  { bg: 'var(--b7)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b8)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b9)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b10)', pat: 'pat-weave', span: '' },
  { bg: 'var(--b11)', pat: 'pat-fine-lines', span: '' },
  { bg: 'var(--b12)', pat: 'pat-rev-diag', span: '' },

  { bg: 'var(--b4)', pat: 'pat-weave', span: '' },
  { bg: 'var(--b6)', pat: 'pat-fine-lines', span: '' },
  { bg: 'var(--b2)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b8)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b1)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b5)', pat: 'pat-diag', span: '' },

  { bg: 'var(--b9)', pat: 'pat-rev-diag', span: '' },
  { bg: 'var(--b3)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b7)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b11)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b10)', pat: 'pat-weave', span: '' },
  { bg: 'var(--b4)', pat: 'pat-fine-lines', span: '' },

  { bg: 'var(--b2)', pat: 'pat-fine-lines', span: '' },
  { bg: 'var(--b5)', pat: 'pat-rev-diag', span: '' },
  { bg: 'var(--b12)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b1)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b8)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b6)', pat: 'pat-weave', span: '' },

  { bg: 'var(--b10)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b7)', pat: 'pat-weave', span: '' },
  { bg: 'var(--b3)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b9)', pat: 'pat-fine-lines', span: '' },
  { bg: 'var(--b4)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b11)', pat: 'pat-rev-diag', span: '' },

  { bg: 'var(--b8)', pat: 'pat-cross', span: '' },
  { bg: 'var(--b1)', pat: 'pat-diag', span: '' },
  { bg: 'var(--b5)', pat: 'pat-weave', span: '' },
  { bg: 'var(--b12)', pat: 'pat-dots', span: '' },
  { bg: 'var(--b2)', pat: 'pat-rev-diag', span: '' },
  { bg: 'var(--b7)', pat: 'pat-fine-lines', span: '' }
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  illustrationColor = 'tan',
  icon,
  eyebrow = 'Welcome',
  title,
  subtitle,
  bullets,
  currentStep = 1,
  totalSteps = 2,
  actionLabel = 'Next'
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const progressPercent = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 50;

  return (
    <div className="wm-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="wm-card" onClick={(e) => e.stopPropagation()}>
        <button className="wm-close" onClick={onClose} aria-label="Close modal">
          <X size={18} />
        </button>

        {/* Left: Woven Illustration Panel */}
        <div className={`wm-illustration-panel wm-color-${illustrationColor}`}>
          <div className="wm-mosaic" aria-hidden="true">
            {MOSAIC_BLOCKS.map((block, i) => (
              <div
                key={i}
                className={`wm-block ${block.pat}`}
                style={{ backgroundColor: block.bg }}
              />
            ))}
          </div>

          {/* Centered White Silhouette Logomark */}
          <div className="wm-silhouette-wrapper">
            {icon ? (
              icon
            ) : (
              /* Default Silhouette Badge from Reference Image 1 */
              <svg
                className="wm-silhouette-badge"
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M44 8C44 5.79086 45.7909 4 48 4H52C54.2091 4 56 5.79086 56 8V12.1889C60.4087 13.0673 64.4988 14.9392 67.9706 17.6294L71.0503 14.5497C72.6124 12.9876 75.1451 12.9876 76.7071 14.5497L79.5355 17.3782C81.0976 18.9402 81.0976 21.4729 79.5355 23.035L76.4558 26.1147C79.146 29.5865 81.0179 33.6766 81.8963 38.0853H86C88.2091 38.0853 90 39.8762 90 42.0853V46.0853C90 48.2944 88.2091 50.0853 86 50.0853H81.8963C81.0179 54.494 79.146 58.5841 76.4558 62.0559L79.5355 65.1356C81.0976 66.6977 81.0976 69.2304 79.5355 70.7924L76.7071 73.6209C75.1451 75.1829 72.6124 75.1829 71.0503 73.6209L67.9706 70.5412C64.4988 73.2314 60.4087 75.1033 56 75.9817V80.1706C56 82.3797 54.2091 84.1706 52 84.1706H48C45.7909 84.1706 44 82.3797 44 80.1706V75.9817C39.5913 75.1033 35.5012 73.2314 32.0294 70.5412L28.9497 73.6209C27.3876 75.1829 24.855 75.1829 23.2929 73.6209L20.4645 70.7924C18.9024 69.2304 18.9024 66.6977 20.4645 65.1356L23.5442 62.0559C20.854 58.5841 18.9821 54.494 18.1037 50.0853H14C11.7909 50.0853 10 48.2944 10 42.0853V42.0853C10 39.8762 11.7909 38.0853 14 38.0853H18.1037C18.9821 33.6766 20.854 29.5865 23.5442 26.1147L20.4645 23.035C18.9024 21.4729 18.9024 18.9402 20.4645 17.3782L23.2929 14.5497C24.855 12.9876 27.3876 12.9876 28.9497 14.5497L32.0294 17.6294C35.5012 14.9392 39.5913 13.0673 44 12.1889V8ZM42 38C39.7909 38 38 39.7909 38 42V48C38 50.2091 39.7909 52 42 52C44.2091 52 46 50.2091 46 48V42C46 39.7909 44.2091 38 42 38ZM58 38C55.7909 38 54 39.7909 54 42V48C54 50.2091 55.7909 52 58 52C60.2091 52 62 50.2091 62 48V42C62 39.7909 60.2091 38 58 38Z"
                  fill="#ffffff"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Right: Clean Content Panel */}
        <div className="wm-content-panel">
          <div>
            <div className="wm-header">
              <span className="wm-eyebrow">{eyebrow}</span>
              <h2 className="wm-title">{title}</h2>
              <p className="wm-subtitle">{subtitle}</p>
            </div>

            <ul className="wm-bullets">
              {bullets.map((bullet, idx) => (
                <li key={idx} className="wm-bullet">
                  <div className="wm-bullet-icon">{bullet.icon}</div>
                  <div className="wm-bullet-text">{bullet.text}</div>
                </li>
              ))}
            </ul>
          </div>

          <div className="wm-footer">
            <div className="wm-progress-rail" aria-label={`Step ${currentStep} of ${totalSteps}`}>
              <div className="wm-progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>

            <button className="wm-action-btn" onClick={onConfirm}>
              <span>{actionLabel}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default WelcomeModal;
