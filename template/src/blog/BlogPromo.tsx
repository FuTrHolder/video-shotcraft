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
) =>
  Math.min(
    max,
    Math.max(min, value),
  );

const fadeIn = (
  frame: number,
  duration = 15,
) =>
  interpolate(
    frame,
    [0, duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

const fadeOut = (
  frame: number,
  end: number,
  duration = 15,
) =>
  interpolate(
    frame,
    [end - duration, end],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

const sceneOpacity = (
  frame: number,
  duration: number,
) =>
  fadeIn(frame, 12) *
  fadeOut(
    frame,
    duration,
    12,
  );

const slideUp = (
  frame: number,
  distance = 40,
  duration = 18,
) =>
  interpolate(
    frame,
    [0, duration],
    [distance, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

const slideLeft = (
  frame: number,
  distance = 60,
  duration = 18,
) =>
  interpolate(
    frame,
    [0, duration],
    [distance, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

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

  if (error) {
    return (
      <AbsoluteFill
        style={{
          background: "#080808",
          color: "#ffffff",
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
          background: "#080808",
          color: "#ffffff",
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

  const posts = (
    data.posts || []
  ).slice(0, 5);

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
        background: "#080808",
        color: "#ffffff",
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
          data={data}
          analysis={analysis}
        />
      </Sequence>

      {/* =================================================
          6–18s
          FIVE POSTS
          72 frames = 2.4 seconds each
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
      20,
    );

  const scale =
    interpolate(
      frame,
      [0, 90],
      [1.04, 1],
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
          "radial-gradient(circle at 72% 35%, rgba(255,255,255,0.09), transparent 32%), #080808",
      }}
    >
      {/* Background grid */}

      <AbsoluteFill
        style={{
          opacity: 0.07,

          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",

          backgroundSize:
            "80px 80px",
        }}
      />

      {/* Decorative circle */}

      <div
        style={{
          position: "absolute",

          width: 620,
          height: 620,

          right: -180,
          top: -120,

          border:
            "1px solid rgba(255,255,255,0.08)",

          borderRadius: "50%",
        }}
      />

      <div
        style={{
          position: "absolute",

          width: 430,
          height: 430,

          right: -80,
          top: -20,

          border:
            "1px solid rgba(255,255,255,0.06)",

          borderRadius: "50%",
        }}
      />

      <div
        style={{
          position: "absolute",

          left: 110,
          right: 110,
          top: 100,
          bottom: 90,

          display: "flex",
          flexDirection: "column",
          justifyContent: "center",

          transform:
            `translateY(${y}px) scale(${scale})`,
        }}
      >
        <div
          style={{
            fontSize: 19,
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

            maxWidth: 1450,
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
            width: 130,
            height: 5,

            marginTop: 36,

            background:
              "#ffffff",

            opacity: 0.72,
          }}
        />

        <div
          style={{
            marginTop: 28,

            maxWidth: 1120,

            fontSize: 27,
            lineHeight: 1.42,

            opacity: 0.68,
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
            marginTop: 38,

            fontSize: 17,

            letterSpacing: 3,

            opacity: 0.38,
          }}
        >
          EXPLORE • READ • DISCOVER
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   PROFILE SCENE
   3–6 seconds
========================================================= */

const ProfileScene: React.FC<{
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
          "radial-gradient(circle at 75% 45%, rgba(255,255,255,0.055), transparent 34%), #0a0a0a",
      }}
    >
      <div
        style={{
          fontSize: 19,
          letterSpacing: 6,
          opacity: 0.42,
          marginBottom: 22,
        }}
      >
        WHY FOLLOW
      </div>

      <div
        style={{
          fontSize: 57,
          lineHeight: 1.08,
          fontWeight: 850,

          maxWidth: 1280,

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
                  "1px solid rgba(255,255,255,0.16)",

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

                  opacity: 0.4,

                  marginBottom: 11,
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

      <div
        style={{
          marginTop: 28,

          display: "flex",

          gap: 10,
        }}
      >
        {topics.map(
          (topic) => (
            <div
              key={topic}
              style={{
                padding:
                  "8px 15px",

                border:
                  "1px solid rgba(255,255,255,0.12)",

                borderRadius: 20,

                fontSize: 14,

                opacity: 0.55,
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

   IMPORTANT:
   The image is intentionally kept large and bright.

   Layout:

   ┌───────────────────────────────┬───────────────────────┐
   │                               │                       │
   │                               │  01 / 05              │
   │       BLOG IMAGE              │                       │
   │                               │  CATEGORY             │
   │                               │                       │
   │                               │  POST TITLE           │
   │                               │                       │
   │                               │  EXCERPT              │
   │                               │                       │
   │                               │  READ ARTICLE →       │
   └───────────────────────────────┴───────────────────────┘
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

  const imageScale =
    interpolate(
      frame,
      [0, 72],
      [1.015, 1.055],
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
      [0, -12],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const contentX =
    slideLeft(
      frame,
      50,
      20,
    );

  const contentY =
    slideUp(
      frame,
      25,
      18,
    );

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
      92,
    );

  const excerpt =
    truncate(
      safe(
        post.excerpt,
        "Discover the latest story and insights from this blog.",
      ),
      175,
    );

  const date =
    safe(
      post.date,
      post.published
        ? new Date(
            post.published,
          ).toLocaleDateString(
            "en-US",
            {
              year: "numeric",
              month: "short",
              day: "numeric",
            },
          )
        : "",
    );

  return (
    <AbsoluteFill
      style={{
        opacity,

        background:
          "#090909",
      }}
    >
      {/* =================================================
          LEFT IMAGE AREA
      ================================================= */}

      <div
        style={{
          position: "absolute",

          left: 56,
          top: 56,
          bottom: 56,

          width: 1055,

          overflow: "hidden",

          borderRadius: 18,

          background:
            "#151515",

          boxShadow:
            "0 25px 70px rgba(0,0,0,0.45)",
        }}
      >
        <Img
          src={getImageSource(
            post,
          )}
          style={{
            width: "100%",
            height: "100%",

            objectFit: "cover",

            objectPosition:
              "center center",

            transform:
              `translateX(${imageX}px) scale(${imageScale})`,
          }}
        />

        {/* Very light image protection gradient.
            This is deliberately much weaker than
            the previous full-screen overlay. */}

        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.04) 65%, rgba(0,0,0,0.16) 100%)",
          }}
        />

        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.03) 0%, transparent 55%, rgba(0,0,0,0.12) 100%)",
          }}
        />

        {/* Image number badge */}

        <div
          style={{
            position: "absolute",

            left: 24,
            top: 24,

            padding:
              "9px 14px",

            borderRadius: 8,

            background:
              "rgba(0,0,0,0.58)",

            border:
              "1px solid rgba(255,255,255,0.18)",

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
          {"  "}
          /{"  "}
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

          left: 1150,
          right: 65,

          top: 56,
          bottom: 56,

          display: "flex",

          flexDirection:
            "column",

          justifyContent:
            "center",

          transform:
            `translateX(${contentX}px)`,
        }}
      >
        {/* Small section label */}

        <div
          style={{
            fontSize: 15,

            letterSpacing: 4,

            fontWeight: 700,

            opacity: 0.42,

            marginBottom: 25,
          }}
        >
          {categoryText.toUpperCase()}
        </div>

        {/* Title */}

        <div
          style={{
            fontSize: 43,

            lineHeight: 1.08,

            fontWeight: 850,

            letterSpacing: -1.5,

            maxWidth: 680,

            transform:
              `translateY(${contentY}px)`,
          }}
        >
          {title}
        </div>

        {/* Divider */}

        <div
          style={{
            width: 74,

            height: 3,

            background:
              "#ffffff",

            opacity: 0.65,

            marginTop: 28,

            marginBottom: 22,
          }}
        />

        {/* Date */}

        {date && (
          <div
            style={{
              fontSize: 15,

              letterSpacing: 1.2,

              opacity: 0.38,

              marginBottom: 20,
            }}
          >
            {date}
          </div>
        )}

        {/* Excerpt */}

        <div
          style={{
            fontSize: 19,

            lineHeight: 1.5,

            opacity: 0.58,

            maxWidth: 650,
          }}
        >
          {excerpt}
        </div>

        {/* CTA */}

        <div
          style={{
            marginTop: 34,

            display: "flex",

            alignItems: "center",

            gap: 14,
          }}
        >
          <div
            style={{
              fontSize: 15,

              letterSpacing: 2.5,

              fontWeight: 700,

              opacity: 0.72,
            }}
          >
            READ ARTICLE
          </div>

          <div
            style={{
              fontSize: 22,

              opacity: 0.72,
            }}
          >
            →
          </div>
        </div>

        {/* Bottom URL */}

        <div
          style={{
            position: "absolute",

            left: 0,
            bottom: 0,

            fontSize: 13,

            letterSpacing: 1.2,

            opacity: 0.28,

            maxWidth: 620,

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
          THIN DIVIDER BETWEEN IMAGE / CONTENT
      ================================================= */}

      <div
        style={{
          position: "absolute",

          left: 1134,

          top: 110,
          bottom: 110,

          width: 1,

          background:
            "rgba(255,255,255,0.08)",
        }}
      />
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
          "radial-gradient(circle at 70% 35%, rgba(255,255,255,0.06), transparent 35%), #080808",
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
              fontSize: 58,

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
              marginTop: 26,

              fontSize: 20,

              lineHeight: 1.45,

              opacity: 0.5,

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

        {/* Post count */}

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

      {/* Topics */}

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
                      index *
                        0.05,
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

  return (
    <AbsoluteFill
      style={{
        opacity,

        background:
          "radial-gradient(circle at 50% 40%, rgba(255,255,255,0.08), transparent 32%), #080808",
      }}
    >
      {/* Background grid */}

      <AbsoluteFill
        style={{
          opacity: 0.06,

          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",

          backgroundSize:
            "80px 80px",
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
            `translateY(${y}px)`,
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
              "#ffffff",

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
