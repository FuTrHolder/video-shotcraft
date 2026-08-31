import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

export const BLOG_PROMO_FPS = 30;
export const BLOG_PROMO_SECONDS = 15;
export const BLOG_PROMO_DURATION =
  BLOG_PROMO_FPS * BLOG_PROMO_SECONDS;

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

export const BlogPromo: React.FC = () => {
  const frame = useCurrentFrame();

  // ------------------------------------------------------------
  // Scene 1
  // 0–3 sec
  // Blog entrance
  // ------------------------------------------------------------
  const introOpacity = interpolate(
    frame,
    [0, 15, 70, 90],
    [0, 1, 1, 0],
    clamp,
  );

  // ------------------------------------------------------------
  // Scene 2
  // 3–8 sec
  // Full page camera push
  // ------------------------------------------------------------
  const cameraProgress = interpolate(
    frame,
    [90, 240],
    [0, 1],
    clamp,
  );

  const scale = interpolate(
    cameraProgress,
    [0, 1],
    [1, 1.16],
    clamp,
  );

  const translateY = interpolate(
    cameraProgress,
    [0, 1],
    [0, -70],
    clamp,
  );

  // ------------------------------------------------------------
  // Scene 3
  // 8–12 sec
  // Stronger push
  // ------------------------------------------------------------
  const detailProgress = interpolate(
    frame,
    [240, 360],
    [0, 1],
    clamp,
  );

  const detailScale = interpolate(
    detailProgress,
    [0, 1],
    [1.16, 1.32],
    clamp,
  );

  const detailY = interpolate(
    detailProgress,
    [0, 1],
    [-70, -180],
    clamp,
  );

  // ------------------------------------------------------------
  // Scene 4
  // 12–15 sec
  // Outro
  // ------------------------------------------------------------
  const outroOpacity = interpolate(
    frame,
    [360, 390, 420, 450],
    [0, 0, 1, 1],
    clamp,
  );

  const outroY = interpolate(
    frame,
    [360, 420],
    [30, 0],
    clamp,
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b0b0b",
        overflow: "hidden",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* ========================================================
          BLOG SCREEN
      ======================================================== */}

      <AbsoluteFill
        style={{
          transform:
            frame < 240
              ? `scale(${scale}) translateY(${translateY}px)`
              : `scale(${detailScale}) translateY(${detailY}px)`,
          transformOrigin: "center top",
        }}
      >
        <Img
          src={staticFile("blog/home.png")}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
          }}
        />
      </AbsoluteFill>

      {/* ========================================================
          DARK CINEMATIC OVERLAY
      ======================================================== */}

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.08) 45%, rgba(0,0,0,0.65))",
        }}
      />

      {/* ========================================================
          INTRO
      ======================================================== */}

      {frame < 100 && (
        <AbsoluteFill
          style={{
            opacity: introOpacity,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              textAlign: "center",
              color: "white",
              padding: 40,
            }}
          >
            <div
              style={{
                fontSize: 24,
                letterSpacing: 7,
                textTransform: "uppercase",
                opacity: 0.75,
                marginBottom: 22,
              }}
            >
              DISCOVER
            </div>

            <div
              style={{
                fontSize: 76,
                lineHeight: 1.05,
                fontWeight: 700,
                letterSpacing: -3,
              }}
            >
              A better way
              <br />
              to explore.
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* ========================================================
          FEATURE LABEL
      ======================================================== */}

      {frame >= 120 && frame < 360 && (
        <div
          style={{
            position: "absolute",
            left: 100,
            bottom: 80,
            color: "white",
            fontSize: 20,
            letterSpacing: 3,
            textTransform: "uppercase",
            opacity: interpolate(
              frame,
              [120, 145, 320, 350],
              [0, 1, 1, 0],
              clamp,
            ),
          }}
        >
          Explore the latest articles
        </div>
      )}

      {/* ========================================================
          OUTRO
      ======================================================== */}

      {frame >= 360 && (
        <AbsoluteFill
          style={{
            opacity: outroOpacity,
            alignItems: "center",
            justifyContent: "center",
            transform: `translateY(${outroY}px)`,
          }}
        >
          <div
            style={{
              textAlign: "center",
              color: "white",
              padding: 40,
              textShadow: "0 3px 20px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                fontSize: 62,
                fontWeight: 700,
                letterSpacing: -2,
              }}
            >
              Explore more.
            </div>

            <div
              style={{
                marginTop: 22,
                fontSize: 22,
                opacity: 0.8,
                letterSpacing: 2,
              }}
            >
              Your next story starts here.
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
