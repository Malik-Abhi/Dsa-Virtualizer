"use client";
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
export default function Controls({
  index,
  count,
  playing,
  speed,
  onIndex,
  onPlay,
  onSpeed,
  disabled,
}: {
  index: number;
  count: number;
  playing: boolean;
  speed: number;
  onIndex: (index: number) => void;
  onPlay: () => void;
  onSpeed: (speed: number) => void;
  disabled: boolean;
}) {
  const unavailable = disabled || count === 0;
  return (
    <footer className="execution-controls">
      <div className="transport">
        <button
          aria-label="Restart execution"
          title="Restart"
          disabled={unavailable}
          onClick={() => onIndex(0)}
        >
          <RotateCcw size={16} />
        </button>
        <i />
        <button
          aria-label="First step"
          disabled={unavailable || index === 0}
          onClick={() => onIndex(0)}
        >
          <SkipBack size={16} />
        </button>
        <button
          aria-label="Previous step"
          title="Previous (←)"
          disabled={unavailable || index === 0}
          onClick={() => onIndex(index - 1)}
        >
          <ChevronLeft size={19} />
        </button>
        <button
          className="play-button"
          aria-label={playing ? "Pause playback" : "Play execution"}
          title="Play / pause (Space)"
          disabled={unavailable}
          onClick={onPlay}
        >
          {playing ? (
            <Pause size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
        </button>
        <button
          aria-label="Next step"
          title="Next (→)"
          disabled={unavailable || index === count - 1}
          onClick={() => onIndex(index + 1)}
        >
          <ChevronRight size={19} />
        </button>
        <button
          aria-label="Last step"
          disabled={unavailable || index === count - 1}
          onClick={() => onIndex(count - 1)}
        >
          <SkipForward size={16} />
        </button>
      </div>
      <div className="timeline">
        <div>
          <span>EXECUTION TIMELINE</span>
          <span>
            Step <strong>{count ? index + 1 : "—"}</strong> / {count || "—"}
          </span>
        </div>
        <input
          aria-label="Execution timeline"
          type="range"
          min={0}
          max={Math.max(1, count - 1)}
          value={count ? index : 0}
          disabled={unavailable}
          onChange={(e) => onIndex(Number(e.target.value))}
          style={
            {
              "--progress": `${count > 1 ? (index / (count - 1)) * 100 : 0}%`,
            } as React.CSSProperties
          }
        />
      </div>
      <div className="speed-control">
        <span>Speed</span>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </div>
      <span className="keyboard-hint">
        <kbd>space</kbd> to play
      </span>
    </footer>
  );
}
