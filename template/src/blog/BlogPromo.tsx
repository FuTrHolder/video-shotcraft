import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

export const BLOG_PROMO_FPS = 30;
export const BLOG_PROMO_SECONDS = 24;
export const BLOG_PROMO_DURATION =
  BLOG_PROMO_FPS * BLOG_PROMO_SECONDS;

type BlogPost = {
  index?: number;
  title: string;
  url?: string;
  date?: string;
  published?: string;
  excerpt?: string;
  localImage?: string;
  imageSource?: string;
  categories?: string[];
};

type BlogAnalysis = {
  identity?: string;
  topics?: string[];
  audience?: string;
  contentStyle?: string;
  valueProposition?: string;
};

type BlogData = {
  version?: number;
  capturedAt?: string;
  url: string;
  hostname?: string;
  siteTitle: string;
  description?: string;
  pageHeading?: string;
  language?: string;
  postCount?: number;
  analysis?: BlogAnalysis;
  posts: BlogPost[];
};

const C = {
  bg: "#07090d",
  panel: "#10151d",
  panel2: "#151c25",
  white: "#ffffff",
  text: "#f5f7fa",
  muted: "rgba(245,247,250,0.68)",
  soft: "rgba(245,247,250,0.46)",
  line: "rgba(255,255,255,0.12)",
  accent: "#75a9ff",
};

const safe = (
  v?: string,
  fallback = ""
) => {
  const t = String(v || "").trim();
  return t || fallback;
};

const truncate = (
  v: string | undefined,
  n: number
) => {
  const t = safe(v);

  return t.length <= n
    ? t
    : `${t.slice(
        0,
        Math.max(1, n - 1)
      )}…`;
};

const clamp = (
  v: number,
  min: number,
  max: number
) =>
  Math.min(
    max,
    Math.max(min, v)
  );

const fade = (
  frame: number,
  end: number,
  inFrames = 14,
  outFrames = 14
) =>
  interpolate(
    frame,
    [
      0,
      inFrames,
      Math.max(
        inFrames,
        end - outFrames
      ),
      end,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft:
        "clamp",
      extrapolateRight:
        "clamp",
    }
  );

const enter = (
  frame: number,
  distance = 34,
  duration = 16
) =>
  interpolate(
    frame,
    [0, duration],
    [distance, 0],
    {
      extrapolateLeft:
        "clamp",
      extrapolateRight:
        "clamp",
    }
  );

const loadBlogData =
  async (): Promise<BlogData> => {
    const response =
      await fetch(
        staticFile(
          "blog/blog.json"
        )
      );

    if (!response.ok) {
      throw new Error(
        `Unable to load blog/blog.json (${response.status})`
      );
    }

    return response.json();
  };

const imageSource = (
  post: BlogPost
) =>
  post.localImage
    ? staticFile(
        post.localImage
      )
    : undefined;

/*
 * Final defensive excerpt cleaner.
 *
 * The capture pipeline already cleans the excerpt,
 * but this protects the video renderer from:
 * - HTML tags
 * - escaped HTML
 * - comments
 * - script/style blocks
 * - Blogger metadata
 * - Unsplash attribution
 */
const cleanExcerpt = (
  value?: string
) => {
  let text = safe(value);

  if (!text) {
    return "";
  }

  text = text
    // HTML comments
    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    )

    // script/style
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )

    // Common escaped HTML
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )

    // HTML tags
    .replace(
      /<[^>]+>/g,
      " "
    )

    // Common HTML entities
    .replace(
      /&amp;/gi,
      "&"
    )

    // Unsplash attribution
    .replace(
      /Photo\s+by\s+.*?(?:on\s+)?Unsplash/gi,
      " "
    )

    // Blog metadata
    .replace(
      /📅[^|]*\|/g,
      " "
    )

    .replace(
      /^Wall Street Daily Briefing\s*/i,
      " "
    )

    // Whitespace
    .replace(
      /\s+/g,
      " "
    )
    .trim();

  return text;
};

const formatDate = (
  post: BlogPost
) => {
  const raw = safe(
    post.date ||
      post.published
  );

  if (!raw) {
    return "";
  }

  const parsed =
    new Date(raw);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return raw;
  }

  return parsed
    .toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }
    )
    .toUpperCase();
};

/* ============================================================
 * COMMON BACKGROUND
 * ============================================================ */

const Base: React.FC =
  () => (
    <>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 70% 25%, #172233 0%, #0b1017 42%, #07090d 100%)",
        }}
      />

      <AbsoluteFill
        style={{
          opacity: 0.028,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)",
          backgroundSize:
            "80px 80px",
        }}
      />

      <div
        style={{
          position:
            "absolute",
          left: 0,
          top: 0,
          width: 7,
          height: "100%",
          background:
            C.accent,
        }}
      />
    </>
  );

/* ============================================================
 * SCENE 1 — BLOG IDENTITY
 * 0–3 sec
 * ============================================================ */

const IdentityScene: React.FC<{
  data: BlogData;
  analysis: BlogAnalysis;
}> = ({
  data,
  analysis,
}) => {
  const f =
    useCurrentFrame();

  const o = fade(
    f,
    90,
    12,
    12
  );

  const y = enter(
    f,
    38,
    18
  );

  const topics = (
    analysis.topics ||
    []
  )
    .filter(Boolean)
    .slice(0, 4);

  const description =
    safe(
      data.description,
      "Market news, financial developments and investment insights."
    );

  const value =
    safe(
      analysis.valueProposition,
      "Fast summaries of market movements, signals, and major financial developments."
    );

  return (
    <AbsoluteFill
      style={{
        opacity: o,
      }}
    >
      <Base />

      <div
        style={{
          position:
            "absolute",
          left: 130,
          right: 130,
          top: 85,
          bottom: 70,
          display: "flex",
          flexDirection:
            "column",
          justifyContent:
            "center",
          transform:
            `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: 6,
            fontWeight: 850,
            color: C.accent,
          }}
        >
          FINANCIAL MARKETS · INVESTING
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: 108,
            lineHeight: 0.94,
            fontWeight: 900,
            letterSpacing: -5,
            color: C.text,
          }}
        >
          {truncate(
            data.siteTitle,
            32
          )}
        </div>

        <div
          style={{
            marginTop: 22,
            width: 130,
            height: 4,
            background:
              C.white,
          }}
        />

        <div
          style={{
            marginTop: 24,
            maxWidth: 1450,
            fontSize: 34,
            lineHeight: 1.25,
            fontWeight: 700,
            color: C.text,
          }}
        >
          {truncate(
            description,
            125
          )}
        </div>

        <div
          style={{
            marginTop: 12,
            maxWidth: 1300,
            fontSize: 21,
            lineHeight: 1.35,
            color: C.muted,
          }}
        >
          {truncate(
            value,
            120
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 25,
          }}
        >
          {topics.map(
            (
              topic,
              i
            ) => {
              const io =
                interpolate(
                  f,
                  [
                    14 +
                      i * 5,
                    26 +
                      i * 5,
                  ],
                  [0, 1],
                  {
                    extrapolateLeft:
                      "clamp",
                    extrapolateRight:
                      "clamp",
                  }
                );

              return (
                <div
                  key={`${topic}-${i}`}
                  style={{
                    opacity: io,
                    padding:
                      "9px 16px",
                    border:
                      `1px solid ${C.line}`,
                    borderRadius:
                      999,
                    background:
                      "rgba(255,255,255,0.04)",
                    color:
                      C.muted,
                    fontSize: 16,
                    fontWeight: 750,
                    letterSpacing:
                      0.5,
                  }}
                >
                  {topic.toUpperCase()}
                </div>
              );
            }
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ============================================================
 * SCENE 2 — TOPICS
 * 3–6 sec
 * ============================================================ */

const TopicsScene: React.FC<{
  topics: string[];
  analysis: BlogAnalysis;
}> = ({
  topics,
  analysis,
}) => {
  const f =
    useCurrentFrame();

  const o = fade(
    f,
    90,
    12,
    12
  );

  const y = enter(
    f,
    34,
    18
  );

  const contentStyle =
    safe(
      analysis.contentStyle,
      "Focused market coverage and concise financial analysis."
    );

  const audience =
    safe(
      analysis.audience,
      "For investors and readers following financial markets."
    );

  return (
    <AbsoluteFill
      style={{
        opacity: o,
      }}
    >
      <Base />

      <div
        style={{
          position:
            "absolute",
          left: 135,
          right: 135,
          top: 100,
          bottom: 100,
          display: "flex",
          flexDirection:
            "column",
          justifyContent:
            "center",
          transform:
            `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: 6,
            color: C.accent,
            fontWeight: 850,
          }}
        >
          WHAT YOU'LL FIND
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: 72,
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: -2,
          }}
        >
          Focused market coverage.
        </div>

        <div
          style={{
            marginTop: 16,
            maxWidth: 1280,
            color: C.muted,
            fontSize: 25,
            lineHeight: 1.35,
          }}
        >
          {truncate(
            contentStyle,
            105
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            marginTop: 42,
            maxWidth: 1500,
          }}
        >
          {topics.map(
            (
              topic,
              i
            ) => {
              const io =
                interpolate(
                  f,
                  [
                    8 +
                      i * 6,
                    22 +
                      i * 6,
                  ],
                  [0, 1],
                  {
                    extrapolateLeft:
                      "clamp",
                    extrapolateRight:
                      "clamp",
                  }
                );

              const iy =
                interpolate(
                  f,
                  [
                    8 +
                      i * 6,
                    22 +
                      i * 6,
                  ],
                  [18, 0],
                  {
                    extrapolateLeft:
                      "clamp",
                    extrapolateRight:
                      "clamp",
                  }
                );

              return (
                <div
                  key={`${topic}-${i}`}
                  style={{
                    opacity: io,
                    transform:
                      `translateY(${iy}px)`,
                    padding:
                      "15px 22px",
                    border:
                      `1px solid ${C.line}`,
                    borderRadius:
                      999,
                    background:
                      "rgba(255,255,255,0.045)",
                    fontSize: 22,
                    fontWeight: 800,
                    color:
                      C.text,
                  }}
                >
                  {topic}
                </div>
              );
            }
          )}
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: 18,
            color: C.soft,
            maxWidth: 1200,
          }}
        >
          {truncate(
            audience,
            115
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ============================================================
 * SCENE 3 — POST
 * 6–18 sec
 *
 * Image: 1110 × 580
 * Text: 590 wide
 *
 * The image remains the visual hero.
 * The text panel focuses on category, summary and date,
 * avoiding unnecessary duplication of a thumbnail headline.
 * ============================================================ */

const PostScene: React.FC<{
  post: BlogPost;
  index: number;
  total: number;
}> = ({
  post,
  index,
  total,
}) => {
  const f =
    useCurrentFrame();

  const o = fade(
    f,
    72,
    9,
    9
  );

  const reverse =
    index % 2 === 1;

  const image =
    imageSource(post);

  const imageX =
    interpolate(
      f,
      [0, 18],
      [
        reverse
          ? -24
          : 24,
        0,
      ],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      }
    );

  const textY =
    enter(
      f,
      24,
      15
    );

  const category =
    safe(
      post.categories?.[0]
    );

  const summary =
    truncate(
      cleanExcerpt(
        post.excerpt
      ),
      132
    );

  const date =
    formatDate(post);

  const progress =
    ((index + 1) /
      Math.max(
        1,
        total
      )) *
    100;

  /*
   * Instead of rendering the full title again,
   * show a compact contextual label.
   *
   * This avoids visual duplication because the generated
   * editorial thumbnails already commonly contain their
   * headline.
   */
  const articleLabel =
    `ARTICLE ${String(
      index + 1
    ).padStart(
      2,
      "0"
    )}`;

  const imagePanel =
    (
      <div
        style={{
          position:
            "absolute",

          ...(reverse
            ? { right: 90 }
            : { left: 90 }),

          top: 250,

          width: 1110,
          height: 580,

          borderRadius: 24,
          overflow:
            "hidden",

          background:
            C.panel,

          border:
            `1px solid ${C.line}`,

          boxShadow:
            "0 28px 70px rgba(0,0,0,0.42)",

          transform:
            `translateX(${imageX}px)`,
        }}
      >
        {image ? (
          <Img
            src={image}
            style={{
              width: "100%",
              height: "100%",
              objectFit:
                "cover",
              objectPosition:
                "center",
              display:
                "block",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              padding: 70,
              textAlign:
                "center",
              fontSize: 38,
              fontWeight: 850,
              color:
                C.muted,
            }}
          >
            IMAGE UNAVAILABLE
          </div>
        )}

        <div
          style={{
            position:
              "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.04) 40%, rgba(0,0,0,0.30) 100%)",
            pointerEvents:
              "none",
          }}
        />

        <div
          style={{
            position:
              "absolute",
            left: 24,
            top: 22,
            padding:
              "8px 13px",
            borderRadius:
              999,
            background:
              "rgba(7,9,13,0.72)",
            border:
              "1px solid rgba(255,255,255,0.15)",
            color:
              "rgba(255,255,255,0.88)",
            fontSize: 13,
            letterSpacing: 3,
            fontWeight: 850,
          }}
        >
          {String(
            index + 1
          ).padStart(
            2,
            "0"
          )}{" "}
          /{" "}
          {String(
            total
          ).padStart(
            2,
            "0"
          )}
        </div>
      </div>
    );

  const textPanel =
    (
      <div
        style={{
          position:
            "absolute",

          ...(reverse
            ? { left: 90 }
            : { right: 90 }),

          top: 180,

          width: 590,
          height: 700,

          display:
            "flex",
          flexDirection:
            "column",
          justifyContent:
            "center",

          transform:
            `translateY(${textY}px)`,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 44,
              height: 3,
              background:
                C.accent,
            }}
          />

          <div
            style={{
              fontSize: 14,
              letterSpacing: 3.5,
              fontWeight: 850,
              color:
                C.accent,
            }}
          >
            {articleLabel}
          </div>
        </div>

        {category && (
          <div
            style={{
              marginTop: 22,
              fontSize: 14,
              letterSpacing: 4,
              fontWeight: 850,
              color:
                C.soft,
            }}
          >
            {truncate(
              category,
              28
            ).toUpperCase()}
          </div>
        )}

        <div
          style={{
            marginTop: 18,
            fontSize: 38,
            lineHeight: 1.12,
            fontWeight: 850,
            color:
              C.text,
          }}
        >
          {summary ||
            "Latest market developments and financial insights."}
        </div>

        {date && (
          <div
            style={{
              marginTop: 24,
              fontSize: 14,
              letterSpacing: 2.5,
              fontWeight: 750,
              color:
                C.soft,
            }}
          >
            {date}
          </div>
        )}

        <div
          style={{
            marginTop: 25,
            fontSize: 15,
            letterSpacing: 3,
            fontWeight: 850,
            color:
              C.muted,
          }}
        >
          READ ARTICLE →
        </div>

        <div
          style={{
            marginTop: 28,
            width: 560,
            height: 3,
            background:
              C.line,
          }}
        >
          <div
            style={{
              width:
                `${clamp(
                  progress,
                  0,
                  100
                )}%`,
              height: "100%",
              background:
                C.accent,
            }}
          />
        </div>
      </div>
    );

  return (
    <AbsoluteFill
      style={{
        opacity: o,
      }}
    >
      <Base />

      {textPanel}

      {imagePanel}
    </AbsoluteFill>
  );
};

/* ============================================================
 * SCENE 4 — VALUE PROPOSITION
 * 18–21 sec
 * ============================================================ */

const ValueScene: React.FC<{
  data: BlogData;
  analysis: BlogAnalysis;
  topics: string[];
}> = ({
  data,
  analysis,
  topics,
}) => {
  const f =
    useCurrentFrame();

  const o = fade(
    f,
    90,
    12,
    12
  );

  const y =
    enter(
      f,
      30,
      18
    );

  const value =
    truncate(
      safe(
        analysis.valueProposition,
        "Timely ideas, useful context, and a clearer view of what matters."
      ),
      135
    );

  return (
    <AbsoluteFill
      style={{
        opacity: o,
      }}
    >
      <Base />

      <div
        style={{
          position:
            "absolute",
          left: 150,
          right: 150,
          top: 100,
          bottom: 100,

          display:
            "flex",
          flexDirection:
            "column",
          justifyContent:
            "center",

          transform:
            `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: 6,
            color:
              C.accent,
            fontWeight: 850,
          }}
        >
          WHY FOLLOW{" "}
          {safe(
            data.siteTitle
          ).toUpperCase()}
        </div>

        <div
          style={{
            marginTop: 24,
            maxWidth: 1450,
            fontSize: 60,
            lineHeight: 1.08,
            fontWeight: 900,
            letterSpacing: -1.5,
            color:
              C.text,
          }}
        >
          {value}
        </div>

        <div
          style={{
            display:
              "flex",
            gap: 12,
            marginTop: 38,
            flexWrap:
              "wrap",
          }}
        >
          {topics
            .slice(0, 3)
            .map(
              (
                topic,
                i
              ) => (
                <div
                  key={`${topic}-${i}`}
                  style={{
                    padding:
                      "11px 17px",
                    border:
                      `1px solid ${C.line}`,
                    borderRadius:
                      999,
                    color:
                      C.muted,
                    fontSize: 16,
                    fontWeight: 750,
                  }}
                >
                  {topic}
                </div>
              )
            )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ============================================================
 * SCENE 5 — CTA
 * 21–24 sec
 * ============================================================ */

const CtaScene: React.FC<{
  data: BlogData;
  analysis?: BlogAnalysis;
}> = ({
  data,
  analysis,
}) => {
  const f =
    useCurrentFrame();

  const o = fade(
    f,
    90,
    12,
    10
  );

  const scale =
    interpolate(
      f,
      [0, 90],
      [0.96, 1],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      }
    );

  const topics = (
    analysis?.topics ||
    []
  )
    .slice(0, 3)
    .map((t) =>
      t.toUpperCase()
    );

  const topicLine =
    topics.length
      ? topics.join(
          "  ·  "
        )
      : "MARKETS  ·  ANALYSIS  ·  INSIGHTS";

  const host =
    safe(
      data.hostname,
      safe(data.url)
        .replace(
          /^https?:\/\//,
          ""
        )
        .replace(
          /\/.*$/,
          ""
        )
    );

  const value =
    truncate(
      safe(
        analysis?.valueProposition,
        "Stay informed with concise market insights and financial developments."
      ),
      110
    );

  return (
    <AbsoluteFill
      style={{
        opacity: o,
      }}
    >
      <Base />

      <div
        style={{
          position:
            "absolute",
          inset: 0,

          display:
            "flex",
          flexDirection:
            "column",
          alignItems:
            "center",
          justifyContent:
            "center",

          textAlign:
            "center",

          transform:
            `scale(${scale})`,
        }}
      >
        <div
          style={{
            fontSize: 17,
            letterSpacing: 7,
            color:
              C.accent,
            fontWeight: 850,
          }}
        >
          STAY CLOSE TO WHAT MATTERS
        </div>

        <div
          style={{
            marginTop: 20,
            fontSize: 96,
            lineHeight: 0.95,
            fontWeight: 900,
            letterSpacing: -4,
            color:
              C.text,
          }}
        >
          {truncate(
            data.siteTitle,
            36
          )}
        </div>

        <div
          style={{
            marginTop: 22,
            maxWidth: 1100,
            fontSize: 25,
            lineHeight: 1.3,
            color:
              C.muted,
            fontWeight: 650,
          }}
        >
          {value}
        </div>

        <div
          style={{
            marginTop: 25,
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: 2.5,
            color:
              C.text,
          }}
        >
          {topicLine}
        </div>

        <div
          style={{
            marginTop: 32,
            padding:
              "17px 34px",
            borderRadius:
              999,
            background:
              C.white,
            color:
              C.bg,
            fontSize: 21,
            fontWeight: 900,
            letterSpacing:
              0.8,
          }}
        >
          VISIT{" "}
          {truncate(
            host,
            42
          ).toUpperCase()}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ============================================================
 * MAIN
 * ============================================================ */

export const BlogPromo: React.FC =
  () => {
    const [
      data,
      setData,
    ] =
      React.useState<BlogData | null>(
        null
      );

    const [
      error,
      setError,
    ] =
      React.useState<string | null>(
        null
      );

    React.useEffect(() => {
      loadBlogData()
        .then(setData)
        .catch((err) =>
          setError(
            err instanceof Error
              ? err.message
              : String(err)
          )
        );
    }, []);

    if (error) {
      return (
        <AbsoluteFill
          style={{
            background:
              C.bg,
            color:
              C.white,
            alignItems:
              "center",
            justifyContent:
              "center",
            fontFamily:
              "Arial, Helvetica, sans-serif",
          }}
        >
          <div
            style={{
              fontSize: 46,
              fontWeight: 800,
            }}
          >
            Blog data error
          </div>

          <div
            style={{
              marginTop: 20,
              color:
                C.muted,
              fontSize: 22,
              maxWidth: 1200,
              textAlign:
                "center",
            }}
          >
            {error}
          </div>
        </AbsoluteFill>
      );
    }

    if (!data) {
      return (
        <AbsoluteFill
          style={{
            background:
              C.bg,
            color:
              C.white,
            alignItems:
              "center",
            justifyContent:
              "center",
            fontFamily:
              "Arial, Helvetica, sans-serif",
            fontSize: 32,
          }}
        >
          Preparing blog story…
        </AbsoluteFill>
      );
    }

    const posts =
      (
        data.posts ||
        []
      ).slice(
        0,
        5
      );

    const analysis =
      data.analysis ||
      {};

    const topics =
      (
        analysis.topics ||
        [
          "Markets",
          "Analysis",
          "Insights",
        ]
      )
        .filter(Boolean)
        .slice(
          0,
          4
        );

    return (
      <AbsoluteFill
        style={{
          background:
            C.bg,
          color:
            C.white,
          fontFamily:
            "Arial, Helvetica, sans-serif",
          overflow:
            "hidden",
        }}
      >
        {/* 0–3 sec */}
        <Sequence
          from={0}
          durationInFrames={90}
        >
          <IdentityScene
            data={data}
            analysis={
              analysis
            }
          />
        </Sequence>

        {/* 3–6 sec */}
        <Sequence
          from={90}
          durationInFrames={90}
        >
          <TopicsScene
            topics={
              topics
            }
            analysis={
              analysis
            }
          />
        </Sequence>

        {/* 6–18 sec */}
        {posts.map(
          (
            post,
            index
          ) => (
            <Sequence
              key={
                post.url ||
                post.title ||
                `post-${index}`
              }
              from={
                180 +
                index *
                  72
              }
              durationInFrames={
                72
              }
            >
              <PostScene
                post={
                  post
                }
                index={
                  index
                }
                total={
                  posts.length
                }
              />
            </Sequence>
          )
        )}

        {/* 18–21 sec */}
        <Sequence
          from={540}
          durationInFrames={90}
        >
          <ValueScene
            data={data}
            analysis={
              analysis
            }
            topics={
              topics
            }
          />
        </Sequence>

        {/* 21–24 sec */}
        <Sequence
          from={630}
          durationInFrames={90}
        >
          <CtaScene
            data={data}
            analysis={
              analysis
            }
          />
        </Sequence>
      </AbsoluteFill>
    );
  };
