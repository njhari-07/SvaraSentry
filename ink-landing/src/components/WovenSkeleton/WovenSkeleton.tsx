import React from 'react';
import './WovenSkeleton.css';

export interface WovenSkeletonProps {
  variant?: 'timeline' | 'text';
  color?: 'blue' | 'red';
  copy?: string;
  className?: string;
  style?: React.CSSProperties;
}

// 40 window bar heights approximating a real risk baseline with subtle anomaly hint
const TIMELINE_BAR_CONFIGS = [
  { h: '20%', c: 'blue' },
  { h: '24%', c: 'blue' },
  { h: '18%', c: 'blue' },
  { h: '26%', c: 'blue' },
  { h: '22%', c: 'blue' },
  { h: '19%', c: 'blue' },
  { h: '25%', c: 'blue' },
  { h: '28%', c: 'blue' },
  { h: '21%', c: 'blue' },
  { h: '17%', c: 'blue' },
  { h: '23%', c: 'blue' },
  { h: '27%', c: 'blue' },
  { h: '20%', c: 'blue' },
  { h: '24%', c: 'blue' },
  { h: '29%', c: 'blue' },
  { h: '22%', c: 'blue' },
  { h: '18%', c: 'blue' },
  { h: '25%', c: 'blue' },
  { h: '23%', c: 'blue' },
  { h: '21%', c: 'blue' },
  { h: '26%', c: 'blue' },
  { h: '30%', c: 'blue' },
  { h: '25%', c: 'blue' },
  { h: '28%', c: 'blue' },
  { h: '34%', c: 'blue' },
  { h: '46%', c: 'red' },
  { h: '58%', c: 'red' },
  { h: '68%', c: 'red' },
  { h: '62%', c: 'red' },
  { h: '48%', c: 'red' },
  { h: '38%', c: 'red' },
  { h: '30%', c: 'blue' },
  { h: '26%', c: 'blue' },
  { h: '22%', c: 'blue' },
  { h: '25%', c: 'blue' },
  { h: '19%', c: 'blue' },
  { h: '24%', c: 'blue' },
  { h: '22%', c: 'blue' },
  { h: '18%', c: 'blue' },
  { h: '21%', c: 'blue' },
];

export const WovenSkeleton: React.FC<WovenSkeletonProps> = ({
  variant = 'timeline',
  color = 'blue',
  copy = 'Awaiting session telemetry & risk analysis stream…',
  className = '',
  style,
}) => {
  if (variant === 'text') {
    return (
      <div
        className={`woven-skeleton ws-text ws-${color} ${className}`}
        data-variant="text"
        data-color={color}
        style={style}
        role="status"
        aria-label="Loading..."
      >
        <div className="ws-line" />
        <div className="ws-line" />
      </div>
    );
  }

  // Variant: Timeline (40 vertical window bars)
  return (
    <div
      className={`woven-skeleton ws-timeline ws-${color} ${className}`}
      data-variant="timeline"
      data-color={color}
      style={style}
      role="status"
      aria-label="Loading risk timeline..."
    >
      <div className="ws-bars" aria-hidden="true">
        {TIMELINE_BAR_CONFIGS.map((bar, i) => {
          const barColorClass = color === 'red' ? 'ws-bar-red' : (bar.c === 'red' ? 'ws-bar-red' : 'ws-bar-blue');
          return (
            <div
              key={i}
              className={`ws-bar ${barColorClass}`}
              style={{
                ['--h' as string]: bar.h,
                ['--i' as string]: i,
              }}
            />
          );
        })}
      </div>
      {copy && <p className="ws-copy">{copy}</p>}
    </div>
  );
};

export default WovenSkeleton;
