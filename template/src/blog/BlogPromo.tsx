import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

/* =========================================================
   VIDEO SETTINGS
========================================================= */

export const BLOG_PROMO_FPS = 30;

export const BLOG_PROMO_SECONDS = 24;

export const BLOG_PROMO_DURATION =
  BLOG_PROMO_FPS * BLOG_PROMO_SECONDS;

/* =========================================================
   TYPES
========================================================= */

type BlogPost = {
  title: string;
  url: string;
  date: string;
  published?: string;
  excerpt: string;
  image: string;
  categories?: string[];
  localScreenshot?: string;
};

type BlogAnalysis = {
  topics: string[];
  audience: string;
  contentStyle: string;
  valueProposition: string;
};

type BlogData = {
  version?: number;

  url: string;

  siteTitle: string;

  description: string;

  pageHeading: string;

  ogImage: string;

  posts: BlogPost[];

  postCount: number;

  language?: string;

  analysis?: BlogAnalysis;
};

/* =========================================================
   CONSTANTS
========================================================= */

const COLORS = {
  background: "#080808",
  panel: "#101010",
  panelSoft: "#151515",
  white: "#ffffff",
  muted: "rgba(255,255,255,0.62)",
  dim: "rgba(255,255,255,0.38)",
  faint: "rgba(255,255,255,0.18)",
  border: "rgba(255,255,255,0.12)",
};

/* =========================================================
   HELPERS
========================================================= */

const safe = (
  value: string | undefined,
  fallback = "",
) => {
  const text = String(value || "").trim();

  return text || fallback;
};

const truncate = (
  value: string | undefined,
  length: number,
) => {
  const text = safe(value);

  if (!text) {
    return "";
  }

  if (text.length <= length) {
    return text;
  }

  return (
    text.slice(
      0,
      Math.max(1, length - 1),
    ) + "…"
  );
};

const clamp = (
  value: number,
  min: number,
  max: number,
) => {
  return Math.min(
    max,
    Math.max(min, value),
  );
};

const fadeIn = (
  frame: number,
  duration = 15,
) => {
  return interpolate(
    frame,
    [0, duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const fadeOut = (
  frame: number,
  end: number,
  duration = 15,
) => {
  return interpolate(
    frame,
    [end - duration, end],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const sceneOpacity = (
  frame: number,
  duration: number,
) => {
  return (
    fadeIn(frame, 14) *
    fadeOut(frame, duration, 14)
  );
};

const slideUp = (
  frame: number,
  distance = 40,
  duration = 18,
) => {
  return interpolate(
    frame,
    [0, duration],
    [distance, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const slideLeft = (
  frame: number,
  distance = 60,
  duration = 18,
) => {
  return interpolate(
    frame,
    [0, duration],
    [distance, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const normalizeUrl = (
  value: string,
) => {
  const url = safe(value);

  if (!url) {
    return "";
  }

  try {
    return new URL(url).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return url;
  }
};

const formatDate = (
  post: BlogPost,
) => {
  const directDate = safe(post.date);

  if (directDate) {
    return directDate;
  }

  const published = safe(
    post.published,
  );

  if (!published) {
    return "";
  }

  try {
    return new Date(
      published,
    ).toLocaleDateString(
      "en-US",
      {
        year: "numeric",
        month: "short",
        day: "numeric",
      },
    );
  } catch {
    return "";
  }
};

/* =========================================================
   IMAGE SOURCE
========================================================= */

const getImageSource = (
  post: BlogPost,
) => {
  if (post.localScreenshot) {
    return staticFile(
      post.localScreenshot,
    );
  }

  if (post.image) {
    return post.image;
  }

  return staticFile(
    "blog/home.png",
  );
};

/* =========================================================
   BLOG DATA LOADER
========================================================= */

const loadBlogData =
  async (): Promise<BlogData> => {
    const response =
      await fetch(
        staticFile(
          "blog/blog.json",
        ),
      );

    if (!response.ok) {
      throw new Error(
        "Unable to load blog/blog.json: " +
          response.status,
      );
    }

    return response.json();
  };

/* =========================================================
   MAIN COMPOSITION

   0–3s    INTRO
   3–6s    PROFILE
   6–18s   FIVE POSTS
   18–21s  ANALYSIS
   21–24s  CTA

   TOTAL = 24 seconds / 720 frames
========================================================= */

export const BlogPromo: React.FC = () => {
  const [data, setData] =
    React.useState<BlogData | null>(
      null,
    );

  const [error, setError] =
    React.useState<string | null>(
      null,
    );

  React.useEffect(() => {
    loadBlogData()
      .then(setData)
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : String(err),
        );
      });
  }, []);

  /* =======================================================
     ERROR
  ======================================================= */

  if (error) {
    return (
      <AbsoluteFill
        style={{
          background:
            COLORS.background,
          color: COLORS.white,
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "Arial, Helvetica, sans-serif",
          padding: 80,
        }}
      >
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
          }}
        >
          Blog data error
        </div>

        <div
          style={{
            marginTop: 20,
            fontSize: 22,
            opacity: 0.65,
            maxWidth: 1200,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      </AbsoluteFill>
    );
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (!data) {
    return (
      <AbsoluteFill
        style={{
          background:
            COLORS.background,
          color: COLORS.white,
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "Arial, Helvetica, sans-serif",
          fontSize: 32,
        }}
      >
        Preparing blog story…
      </AbsoluteFill>
    );
  }

  /* =======================================================
     POSTS
  ======================================================= */

  const posts = (
    data.posts || []
  ).slice(0, 5);

  /* =======================================================
     ANALYSIS FALLBACK
  ======================================================= */

  const analysis: BlogAnalysis =
    data.analysis || {
      topics: [
        "Insights",
        "Analysis",
        "Trends",
      ],

      audience:
        "Readers looking for useful insights",

      contentStyle:
        "Analysis and commentary",

      valueProposition:
        "Useful ideas, insights and practical information in one place.",
    };

  return (
    <AbsoluteFill
      style={{
        background:
          COLORS.background,
        color: COLORS.white,
        fontFamily:
          "Arial, Helvetica, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* =================================================
          0–3s
          INTRO
      ================================================= */}

      <Sequence
        from={0}
        durationInFrames={90}
      >
        <Intro
          data={data}
          analysis={analysis}
        />
      </Sequence>

      {/* =================================================
          3–6s
          PROFILE
      ================================================= */}

      <Sequence
        from={90}
        durationInFrames={90}
      >
        <ProfileScene
          analysis={analysis}
        />
      </Sequence>

      {/* =================================================
          6–18s
          FIVE POSTS

          72 frames = 2.4 seconds
      ================================================= */}

      {posts.map(
        (post, index) => (
          <Sequence
            key={
              post.url ||
              `post-${index}`
            }
            from={
              180 +
              index * 72
            }
            durationInFrames={72}
          >
            <PostCard
              post={post}
              index={index}
              totalPosts={
                posts.length
              }
            />
          </Sequence>
        ),
      )}

      {/* =================================================
          18–21s
          BLOG AT A GLANCE
      ================================================= */}

      <Sequence
        from={540}
        durationInFrames={90}
      >
        <AnalysisScene
          data={data}
          analysis={analysis}
        />
      </Sequence>

      {/* =================================================
          21–24s
          CTA
      ================================================= */}

      <Sequence
        from={630}
        durationInFrames={90}
      >
        <Outro
          data={data}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

/* =========================================================
   INTRO
   0–3 seconds
========================================================= */

const Intro: React.FC<{
  data: BlogData;
  analysis: BlogAnalysis;
}> = ({
  data,
  analysis,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      90,
    );

  const y =
    slideUp(
      frame,
      45,
      22,
    );

  const scale =
    interpolate(
      frame,
      [0, 90],
      [1.035, 1],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const primaryTopic =
    safe(
      analysis.topics?.[0],
      "INSIGHTS",
    ).toUpperCase();

  return (
    <AbsoluteFill
      style={{
        opacity,
        background:
          "radial-gradient(circle at 76% 35%, rgba(255,255,255,0.09), transparent 30%), #080808",
      }}
    >
      {/* Background grid */}

      <AbsoluteFill
        style={{
          opacity: 0.055,

          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)",

          backgroundSize:
            "80px 80px",
        }}
      />

      {/* Decorative circles */}

      <div
        style={{
          position: "absolute",
          width: 680,
          height: 680,
          right: -230,
          top: -150,
          border:
            "1px solid rgba(255,255,255,0.08)",
          borderRadius: "50%",
        }}
      />

      <div
        style={{
          position: "absolute",
          width: 470,
          height: 470,
          right: -90,
          top: -10,
          border:
            "1px solid rgba(255,255,255,0.055)",
          borderRadius: "50%",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          top: 90,
          bottom: 80,

          display: "flex",
          flexDirection: "column",
          justifyContent: "center",

          transform:
            `translateY(${y}px) scale(${scale})`,
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: 7,
            fontWeight: 700,
            opacity: 0.48,
            marginBottom: 28,
          }}
        >
          {primaryTopic}
        </div>

        <div
          style={{
            fontSize: 84,
            lineHeight: 0.98,
            fontWeight: 900,
            letterSpacing: -4,
            maxWidth: 1500,
          }}
        >
          {truncate(
            safe(
              data.siteTitle,
              "This Blog",
            ),
            42,
          )}
        </div>

        <div
          style={{
            width: 125,
            height: 4,
            marginTop: 34,
            background:
              COLORS.white,
            opacity: 0.72,
          }}
        />

        <div
          style={{
            marginTop: 26,
            maxWidth: 1120,
            fontSize: 27,
            lineHeight: 1.42,
            opacity: 0.65,
          }}
        >
          {truncate(
            safe(
              data.description,
              analysis.valueProposition,
            ),
            135,
          )}
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: 15,
            letterSpacing: 3,
            opacity: 0.34,
          }}
        >
          EXPLORE • READ • DISCOVER
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   PROFILE
   3–6 seconds
========================================================= */

const ProfileScene: React.FC<{
  analysis: BlogAnalysis;
}> = ({
  analysis,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      90,
    );

  const topics = (
    analysis.topics || []
  )
    .filter(Boolean)
    .slice(0, 4);

  const cards = [
    {
      label: "FOCUS",
      value:
        topics[0] ||
        "Insights",
    },

    {
      label: "STYLE",
      value:
        safe(
          analysis.contentStyle,
          "Analysis",
        ),
    },

    {
      label: "FOR",
      value:
        safe(
          analysis.audience,
          "Curious readers",
        ),
    },
  ];

  return (
    <AbsoluteFill
      style={{
        opacity,

        padding:
          "80px 110px",

        justifyContent:
          "center",

        background:
          "radial-gradient(circle at 76% 45%, rgba(255,255,255,0.055), transparent 32%), #0a0a0a",
      }}
    >
      <div
        style={{
          fontSize: 18,
          letterSpacing: 6,
          opacity: 0.4,
          marginBottom: 22,
        }}
      >
        WHY FOLLOW
      </div>

      <div
        style={{
          fontSize: 56,
          lineHeight: 1.08,
          fontWeight: 850,
          maxWidth: 1300,

          transform:
            `translateY(${slideUp(
              frame,
              35,
              18,
            )}px)`,
        }}
      >
        {truncate(
          safe(
            analysis.valueProposition,
            "Useful insights in one place.",
          ),
          150,
        )}
      </div>

      {/* Profile cards */}

      <div
        style={{
          display: "flex",
          gap: 18,
          marginTop: 40,
        }}
      >
        {cards.map(
          (card, index) => (
            <div
              key={
                card.label
              }
              style={{
                flex: 1,
                minHeight: 112,

                border:
                  "1px solid rgba(255,255,255,0.13)",

                background:
                  "rgba(255,255,255,0.035)",

                borderRadius: 12,

                padding:
                  "20px 22px",

                transform:
                  `translateY(${slideUp(
                    frame -
                      index * 4,
                    25,
                    18,
                  )}px)`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  letterSpacing: 3,
                  opacity: 0.38,
                  marginBottom: 10,
                }}
              >
                {card.label}
              </div>

              <div
                style={{
                  fontSize: 21,
                  lineHeight: 1.25,
                  fontWeight: 700,
                  opacity: 0.9,
                }}
              >
                {truncate(
                  card.value,
                  58,
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {/* Topic pills */}

      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 28,
        }}
      >
        {topics.map(
          (topic, index) => (
            <div
              key={topic}
              style={{
                padding:
                  "8px 15px",

                border:
                  "1px solid rgba(255,255,255,0.12)",

                borderRadius: 20,

                fontSize: 14,

                opacity:
                  clamp(
                    0.42 +
                      index * 0.05,
                    0.42,
                    0.65,
                  ),

                transform:
                  `translateY(${slideUp(
                    frame -
                      index * 3,
                    20,
                    16,
                  )}px)`,
              }}
            >
              {topic}
            </div>
          ),
        )}
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   POST CARD
   6–18 seconds

   IMPORTANT DESIGN CHANGE

   The post image itself is NOT covered by a large title.

   Instead:

   ┌──────────────────────────────┬──────────────────────┐
   │                              │ 01 / 05              │
   │                              │                      │
   │        FULL IMAGE            │ CATEGORY             │
   │                              │                      │
   │                              │ TITLE                │
   │                              │                      │
   │                              │ DATE                 │
   │                              │ EXCERPT              │
   │                              │                      │
   │                              │ READ ARTICLE →       │
   └──────────────────────────────┴──────────────────────┘
========================================================= */

const PostCard: React.FC<{
  post: BlogPost;
  index: number;
  totalPosts: number;
}> = ({
  post,
  index,
  totalPosts,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      72,
    );

  /* =======================================================
     IMAGE MOTION

     Very subtle Ken Burns effect.
  ======================================================= */

  const imageScale =
    interpolate(
      frame,
      [0, 72],
      [1.0, 1.045],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const imageX =
    interpolate(
      frame,
      [0, 72],
      [0, -10],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const imageY =
    interpolate(
      frame,
      [0, 72],
      [0, -5],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  /* =======================================================
     CONTENT MOTION
  ======================================================= */

  const contentX =
    slideLeft(
      frame,
      45,
      20,
    );

  const contentY =
    slideUp(
      frame,
      24,
      18,
    );

  /* =======================================================
     DATA
  ======================================================= */

  const categories = (
    post.categories || []
  )
    .filter(Boolean)
    .slice(0, 2);

  const categoryText =
    categories.length > 0
      ? categories.join(
          "  •  ",
        )
      : "LATEST STORY";

  const title =
    truncate(
      safe(
        post.title,
        "Untitled story",
      ),
      88,
    );

  const excerpt =
    truncate(
      safe(
        post.excerpt,
        "Discover the latest story and insights from this blog.",
      ),
      155,
    );

  const date =
    formatDate(post);

  const imageSource =
    getImageSource(post);

  return (
    <AbsoluteFill
      style={{
        opacity,
        background:
          COLORS.background,
      }}
    >
      {/* =================================================
          IMAGE CONTAINER
      ================================================= */}

      <div
        style={{
          position: "absolute",

          left: 58,
          top: 58,
          bottom: 58,

          width: 1035,

          overflow: "hidden",

          borderRadius: 20,

          background:
            "#111111",

          border:
            "1px solid rgba(255,255,255,0.10)",

          boxShadow:
            "0 30px 80px rgba(0,0,0,0.45)",
        }}
      >
        {/* =================================================
            BLURRED BACKGROUND

            This makes the full image look premium even
            when the original image ratio is not 16:9.
        ================================================= */}

        <Img
          src={imageSource}
          style={{
            position: "absolute",

            width: "100%",
            height: "100%",

            objectFit: "cover",

            filter:
              "blur(24px) brightness(0.58)",

            transform:
              `scale(1.10) translate(${imageX}px, ${imageY}px)`,
          }}
        />

        {/* Dark glass layer */}

        <AbsoluteFill
          style={{
            background:
              "rgba(0,0,0,0.18)",
          }}
        />

        {/* =================================================
            MAIN IMAGE

            CONTAIN = original image remains visible
            without aggressive cropping.
        ================================================= */}

        <div
          style={{
            position: "absolute",

            left: 22,
            right: 22,
            top: 22,
            bottom: 22,

            display: "flex",

            alignItems: "center",

            justifyContent:
              "center",

            overflow: "hidden",

            borderRadius: 14,

            background:
              "rgba(0,0,0,0.16)",
          }}
        >
          <Img
            src={imageSource}
            style={{
              width: "100%",
              height: "100%",

              objectFit: "contain",

              objectPosition:
                "center center",

              transform:
                `translate(${imageX}px, ${imageY}px) scale(${imageScale})`,

              filter:
                "brightness(1.08) contrast(1.02) saturate(1.04)",

              display: "block",
            }}
          />
        </div>

        {/* =================================================
            VERY LIGHT EDGE VIGNETTE

            Deliberately weak.
        ================================================= */}

        <AbsoluteFill
          style={{
            pointerEvents: "none",

            background:
              "linear-gradient(90deg, rgba(0,0,0,0.06) 0%, transparent 18%, transparent 82%, rgba(0,0,0,0.12) 100%)",
          }}
        />

        <AbsoluteFill
          style={{
            pointerEvents: "none",

            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, transparent 18%, transparent 82%, rgba(0,0,0,0.10) 100%)",
          }}
        />

        {/* =================================================
            POST NUMBER
        ================================================= */}

        <div
          style={{
            position: "absolute",

            left: 22,
            top: 22,

            padding:
              "9px 14px",

            borderRadius: 8,

            background:
              "rgba(0,0,0,0.58)",

            border:
              "1px solid rgba(255,255,255,0.20)",

            backdropFilter:
              "blur(8px)",

            fontSize: 14,

            fontWeight: 700,

            letterSpacing: 2,
          }}
        >
          {String(
            index + 1,
          ).padStart(2, "0")}

          {"  /  "}

          {String(
            totalPosts,
          ).padStart(2, "0")}
        </div>
      </div>

      {/* =================================================
          RIGHT INFORMATION PANEL
      ================================================= */}

      <div
        style={{
          position: "absolute",

          left: 1155,
          right: 62,

          top: 58,
          bottom: 58,

          display: "flex",

          flexDirection:
            "column",

          justifyContent:
            "center",

          transform:
            `translateX(${contentX}px)`,
        }}
      >
        {/* =================================================
            POST NUMBER / SECTION
        ================================================= */}

        <div
          style={{
            fontSize: 13,

            letterSpacing: 4,

            opacity: 0.34,

            marginBottom: 18,
          }}
        >
          STORY{" "}
          {String(
            index + 1,
          ).padStart(2, "0")}
          {"  /  "}
          {String(
            totalPosts,
          ).padStart(2, "0")}
        </div>

        {/* =================================================
            CATEGORY
        ================================================= */}

        <div
          style={{
            fontSize: 14,

            letterSpacing: 3.5,

            fontWeight: 700,

            opacity: 0.50,

            marginBottom: 22,

            textTransform:
              "uppercase",
          }}
        >
          {categoryText}
        </div>

        {/* =================================================
            TITLE

            This is now the ONLY large title.
            Nothing is rendered over the image.
        ================================================= */}

        <div
          style={{
            fontSize: 41,

            lineHeight: 1.08,

            fontWeight: 850,

            letterSpacing: -1.2,

            maxWidth: 690,

            transform:
              `translateY(${contentY}px)`,
          }}
        >
          {title}
        </div>

        {/* Divider */}

        <div
          style={{
            width: 70,

            height: 3,

            background:
              COLORS.white,

            opacity: 0.62,

            marginTop: 26,

            marginBottom: 20,
          }}
        />

        {/* =================================================
            DATE
        ================================================= */}

        {date && (
          <div
            style={{
              fontSize: 14,

              letterSpacing: 1.2,

              opacity: 0.36,

              marginBottom: 18,
            }}
          >
            {date}
          </div>
        )}

        {/* =================================================
            EXCERPT
        ================================================= */}

        <div
          style={{
            fontSize: 18,

            lineHeight: 1.48,

            opacity: 0.56,

            maxWidth: 650,
          }}
        >
          {excerpt}
        </div>

        {/* =================================================
            CTA
        ================================================= */}

        <div
          style={{
            marginTop: 30,

            display: "flex",

            alignItems: "center",

            gap: 13,
          }}
        >
          <div
            style={{
              fontSize: 14,

              letterSpacing: 2.5,

              fontWeight: 700,

              opacity: 0.76,
            }}
          >
            READ ARTICLE
          </div>

          <div
            style={{
              fontSize: 21,

              opacity: 0.72,

              transform:
                `translateX(${interpolate(
                  frame,
                  [0, 72],
                  [0, 5],
                  {
                    extrapolateLeft:
                      "clamp",
                    extrapolateRight:
                      "clamp",
                  },
                )}px)`,
            }}
          >
            →
          </div>
        </div>

        {/* =================================================
            POST URL
        ================================================= */}

        <div
          style={{
            position:
              "absolute",

            left: 0,

            bottom: 0,

            fontSize: 12,

            letterSpacing: 1.2,

            opacity: 0.25,

            maxWidth: 650,

            overflow: "hidden",

            whiteSpace:
              "nowrap",

            textOverflow:
              "ellipsis",
          }}
        >
          {normalizeUrl(
            post.url,
          )}
        </div>
      </div>

      {/* =================================================
          IMAGE / INFORMATION DIVIDER
      ================================================= */}

      <div
        style={{
          position: "absolute",

          left: 1135,

          top: 110,

          bottom: 110,

          width: 1,

          background:
            "rgba(255,255,255,0.08)",
        }}
      />

      {/* =================================================
          TOP PROGRESS LINE
      ================================================= */}

      <div
        style={{
          position: "absolute",

          left: 58,
          right: 62,

          top: 25,

          height: 2,

          background:
            "rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            width:
              `${((index + 1) / totalPosts) * 100}%`,

            height: "100%",

            background:
              "rgba(255,255,255,0.55)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   ANALYSIS SCENE
   18–21 seconds
========================================================= */

const AnalysisScene: React.FC<{
  data: BlogData;
  analysis: BlogAnalysis;
}> = ({
  data,
  analysis,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      90,
    );

  const topics = (
    analysis.topics || []
  )
    .filter(Boolean)
    .slice(0, 4);

  const postCount =
    data.postCount ||
    data.posts?.length ||
    0;

  return (
    <AbsoluteFill
      style={{
        opacity,

        padding:
          "75px 110px",

        justifyContent:
          "center",

        background:
          "radial-gradient(circle at 72% 35%, rgba(255,255,255,0.065), transparent 34%), #080808",
      }}
    >
      <div
        style={{
          fontSize: 18,

          letterSpacing: 6,

          opacity: 0.4,

          marginBottom: 24,
        }}
      >
        BLOG AT A GLANCE
      </div>

      <div
        style={{
          display: "flex",

          alignItems:
            "flex-end",

          justifyContent:
            "space-between",

          gap: 80,
        }}
      >
        {/* Main analysis */}

        <div
          style={{
            maxWidth: 1120,

            transform:
              `translateY(${slideUp(
                frame,
                35,
                20,
              )}px)`,
          }}
        >
          <div
            style={{
              fontSize: 57,

              lineHeight: 1.05,

              fontWeight: 850,

              letterSpacing: -2,
            }}
          >
            {truncate(
              safe(
                analysis.valueProposition,
                "Ideas, insights and useful information.",
              ),
              130,
            )}
          </div>

          <div
            style={{
              marginTop: 24,

              fontSize: 20,

              lineHeight: 1.45,

              opacity: 0.50,

              maxWidth: 980,
            }}
          >
            {truncate(
              safe(
                analysis.contentStyle,
                "Curated stories and practical insights.",
              ),
              130,
            )}
          </div>
        </div>

        {/* =================================================
            RECENT STORIES COUNTER
        ================================================= */}

        <div
          style={{
            minWidth: 220,

            padding:
              "25px 28px",

            border:
              "1px solid rgba(255,255,255,0.14)",

            borderRadius: 14,

            background:
              "rgba(255,255,255,0.035)",

            transform:
              `translateY(${slideUp(
                frame,
                25,
                18,
              )}px)`,
          }}
        >
          <div
            style={{
              fontSize: 13,

              letterSpacing: 3,

              opacity: 0.38,

              marginBottom: 8,
            }}
          >
            RECENT STORIES
          </div>

          <div
            style={{
              fontSize: 52,

              lineHeight: 1,

              fontWeight: 900,
            }}
          >
            {postCount}
          </div>
        </div>
      </div>

      {/* =================================================
          TOPICS
      ================================================= */}

      <div
        style={{
          display: "flex",

          gap: 12,

          marginTop: 38,
        }}
      >
        {topics.map(
          (topic, index) => (
            <div
              key={topic}
              style={{
                padding:
                  "11px 18px",

                border:
                  "1px solid rgba(255,255,255,0.13)",

                borderRadius: 24,

                fontSize: 15,

                opacity:
                  clamp(
                    0.42 +
                      index * 0.05,
                    0.42,
                    0.65,
                  ),

                transform:
                  `translateY(${slideUp(
                    frame -
                      index * 3,
                    20,
                    16,
                  )}px)`,
              }}
            >
              {topic}
            </div>
          ),
        )}
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   OUTRO
   21–24 seconds
========================================================= */

const Outro: React.FC<{
  data: BlogData;
}> = ({
  data,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      90,
    );

  const y =
    slideUp(
      frame,
      35,
      20,
    );

  const hostname =
    normalizeUrl(
      data.url,
    );

  const scale =
    interpolate(
      frame,
      [0, 90],
      [1.025, 1],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  return (
    <AbsoluteFill
      style={{
        opacity,

        background:
          "radial-gradient(circle at 50% 40%, rgba(255,255,255,0.085), transparent 32%), #080808",
      }}
    >
      {/* Background grid */}

      <AbsoluteFill
        style={{
          opacity: 0.055,

          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)",

          backgroundSize:
            "80px 80px",
        }}
      />

      {/* Decorative circles */}

      <div
        style={{
          position: "absolute",

          width: 720,
          height: 720,

          left:
            "50%",

          top:
            "50%",

          transform:
            "translate(-50%, -50%)",

          border:
            "1px solid rgba(255,255,255,0.06)",

          borderRadius: "50%",
        }}
      />

      <div
        style={{
          position: "absolute",

          width: 520,
          height: 520,

          left:
            "50%",

          top:
            "50%",

          transform:
            "translate(-50%, -50%)",

          border:
            "1px solid rgba(255,255,255,0.045)",

          borderRadius: "50%",
        }}
      />

      <div
        style={{
          position: "absolute",

          left: 100,
          right: 100,
          top: 80,
          bottom: 80,

          display: "flex",

          flexDirection:
            "column",

          alignItems:
            "center",

          justifyContent:
            "center",

          textAlign:
            "center",

          transform:
            `translateY(${y}px) scale(${scale})`,
        }}
      >
        <div
          style={{
            fontSize: 17,

            letterSpacing: 6,

            opacity: 0.4,

            marginBottom: 24,
          }}
        >
          DISCOVER MORE
        </div>

        <div
          style={{
            fontSize: 78,

            lineHeight: 1,

            fontWeight: 900,

            letterSpacing: -3,

            maxWidth: 1500,
          }}
        >
          {truncate(
            safe(
              data.siteTitle,
              "This Blog",
            ),
            42,
          )}
        </div>

        <div
          style={{
            width: 100,

            height: 4,

            background:
              COLORS.white,

            opacity: 0.65,

            marginTop: 34,
          }}
        />

        <div
          style={{
            marginTop: 28,

            fontSize: 25,

            opacity: 0.58,

            maxWidth: 900,
          }}
        >
          Discover more stories,
          {" "}
          insights and ideas.
        </div>

        {/* =================================================
            WEBSITE URL
        ================================================= */}

        <div
          style={{
            marginTop: 36,

            padding:
              "15px 27px",

            border:
              "1px solid rgba(255,255,255,0.18)",

            borderRadius: 8,

            background:
              "rgba(255,255,255,0.045)",

            fontSize: 19,

            letterSpacing: 1.2,

            opacity: 0.78,
          }}
        >
          {hostname}
        </div>

        <div
          style={{
            marginTop: 30,

            fontSize: 14,

            letterSpacing: 3,

            opacity: 0.28,
          }}
        >
          READ • EXPLORE • FOLLOW
        </div>
      </div>
    </AbsoluteFill>
  );
};
