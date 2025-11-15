import React, { useEffect, useRef } from "react";

const THEME_LIGHT = {
  bg: "#f5f5f7",
  surface: "#ffffff",
  text: "#111827",
  subtle: "#6b7280",
  border: "#d1d5db",
};

export default function BubbleMakerMaintenance() {
  const bubblesRef = useRef(null);

  // create bubbles once
  useEffect(() => {
    const container = bubblesRef.current;
    if (!container) return;

    const BUBBLE_COUNT = 26;
    const created = [];

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const bubble = document.createElement("span");
      bubble.className = "bm-bubble";

      const size = Math.random() * 80 + 40; // 40–120px
      const left = Math.random() * 100; // vw
      const delay = Math.random() * 10; // s
      const duration = Math.random() * 18 + 16; // 16–34s
      const blur = Math.random() * 1.5; // px
      const opacity = Math.random() * 0.25 + 0.2;

      bubble.style.width = `${size}px`;
      bubble.style.height = `${size}px`;
      bubble.style.left = `${left}vw`;
      bubble.style.bottom = "-120px";
      bubble.style.animationDuration = `${duration}s`;
      bubble.style.animationDelay = `-${delay}s`;
      bubble.style.filter = `blur(${blur}px)`;
      bubble.style.opacity = opacity.toString();

      container.appendChild(bubble);
      created.push(bubble);
    }

    // clean up on unmount
    return () => {
      created.forEach((b) => b.remove());
    };
  }, []);

  return (
    <>
      {/* local styles – still using your theme */}
      <style>{`
        :root {
          --bm-bg: ${THEME_LIGHT.bg};
          --bm-surface: ${THEME_LIGHT.surface};
          --bm-text: ${THEME_LIGHT.text};
          --bm-subtle: ${THEME_LIGHT.subtle};
          --bm-border: ${THEME_LIGHT.border};
        }

        html, body, #root {
          height: 100%;
        }

        .bm-app {
          min-height: 100%;
          font-family: system-ui, -apple-system, BlinkMacSystemFont,
            "SF Pro Text", "Segoe UI", sans-serif;
          background: var(--bm-bg);
          color: var(--bm-text);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .bm-bubbles {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }

        .bm-bubble {
          position: absolute;
          border-radius: 9999px;
          background: radial-gradient(circle at 30% 30%, #ffffff, #e5e7eb);
          border: 1px solid rgba(209, 213, 219, 0.8);
          opacity: 0.45;
          filter: blur(0.3px);
          animation-name: bm-floatUp;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }

        @keyframes bm-floatUp {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          100% { transform: translate3d(0, -120vh, 0) scale(1.1); }
        }

        .bm-card {
          position: relative;
          z-index: 1;
          background: var(--bm-surface);
          border-radius: 24px;
          border: 1px solid var(--bm-border);
          padding: 32px 28px;
          max-width: 420px;
          width: min(90vw, 420px);
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(6px);
        }

        .bm-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 500;
          background: #f9fafb;
          border: 1px solid var(--bm-border);
          color: var(--bm-subtle);
          margin-bottom: 12px;
        }

        .bm-badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e33;
          box-shadow: 0 0 0 4px #22c55e11;
        }

        .bm-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .bm-subtitle {
          font-size: 14px;
          color: var(--bm-subtle);
          line-height: 1.5;
          margin-bottom: 18px;
        }

        .bm-status-box {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px dashed var(--bm-border);
          background: #f9fafb;
          margin-bottom: 10px;
        }

        .bm-status-icon {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid var(--bm-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: var(--bm-subtle);
          background: var(--bm-surface);
        }

        .bm-status-text {
          font-size: 12px;
          color: var(--bm-subtle);
        }

        .bm-footer {
          font-size: 11px;
          color: var(--bm-subtle);
          opacity: 0.9;
          margin-top: 6px;
        }
      `}</style>

      <div className="bm-app">
        <div className="bm-bubbles" ref={bubblesRef} aria-hidden="true" />

        <main className="bm-card" role="main" aria-live="polite">
          <div className="bm-badge">
            <span className="bm-badge-dot" />
            <span>Bubble Maker v1.0</span>
          </div>

          <h1 className="bm-title">We’re doing a quick refresh</h1>
          <p className="bm-subtitle">
            The app is temporarily in maintenance mode while we recalibrate the
            bubbles. You can safely close this window and come back in a bit.
          </p>

          <div className="bm-status-box">
            <div className="bm-status-icon">◎</div>
            <div className="bm-status-text">
              Status: <strong>Maintenance</strong> — core systems are healthy,
              visuals are updating.
            </div>
          </div>

          <p className="bm-footer">
            Bubble Maker v1.0 · UI maintenance screen · Theme: <code>LIGHT</code>
          </p>
        </main>
      </div>
    </>
  );
}
