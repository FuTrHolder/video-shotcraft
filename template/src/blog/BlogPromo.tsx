import React from "react";

import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

/*
=========================================================
BLOG PROMO
=========================================================

0–3s     Blog identity
3–6s     Core fields
6–18s    Recent posts 1–5
18–21s   Value proposition
21–24s   CTA

1920 × 1080
30 FPS
720 FRAMES

Data:
  /public/blog/blog.json

Images:
  /public/blog/posts/*
=========================================================
*/

export const BLOG_PROMO_FPS = 30;

export const BLOG_PROMO_SECONDS = 24;

export const BLOG_PROMO_DURATION =
  BLOG_PROMO_FPS *
  BLOG_PROMO_SECONDS;

/* ======================================================
   TYPES
====================================================== */

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

/* ======================================================
   DESIGN
====================================================== */

const COLORS = {
  background: "#07090d",
  panel: "#10141b",
  panelLight: "#171d26",
  white: "#ffffff",
  text: "#f5f7fa",
  muted: "rgba(245,247,250,0.70)",
  soft: "rgba(245,247,250,0.48)",
  faint: "rgba(245,247,250,0.20)",
  line: "rgba(255,255,255,0.12)",
  accent: "#75a9ff",
};

/* ======================================================
   HELPERS
====================================================== */

const safe = (
  value?: string,
  fallback = "",
) => {
  const text =
    String(value || "").trim();

  return text || fallback;
};

const truncate = (
  value: string | undefined,
  length: number,
) => {
  const text =
    safe(value);

  if (text.length <= length) {
    return text;
  }

  return (
    text.slice(
      0,
      Math.max(
        1,
        length - 1,
      ),
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
    Math.max(
      min,
      value,
    ),
  );

const fadeIn = (
  frame: number,
  duration = 18,
) =>
  interpolate(
    frame,
    [0, duration],
    [0, 1],
    {
      extrapolateLeft:
        "clamp",
      extrapolateRight:
        "clamp",
    },
  );

const fadeOut = (
  frame: number,
  end: number,
  duration = 18,
) =>
  interpolate(
    frame,
    [
      Math.max(
        0,
        end - duration,
      ),
      end,
    ],
    [1, 0],
    {
      extrapolateLeft:
        "clamp",
      extrapolateRight:
        "clamp",
    },
  );

const sceneOpacity = (
  frame: number,
  duration: number,
) =>
  fadeIn(frame) *
  fadeOut(
    frame,
    duration,
  );

const slideUp = (
  frame: number,
  distance = 45,
  duration = 20,
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
    },
  );

const slideLeft = (
  frame: number,
  distance = 50,
  duration = 20,
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
    },
  );

/* ======================================================
   DATA
====================================================== */

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
        `Unable to load blog/blog.json (${response.status})`,
      );
    }

    return response.json();
  };

/* ======================================================
   IMAGE
====================================================== */

const getImageSource = (
  post: BlogPost,
) => {
  if (post.localImage) {
    return staticFile(
      post.localImage,
    );
  }

  return undefined;
};

/* ======================================================
   ROOT
====================================================== */

export const BlogPromo: React.FC =
  () => {
    const [
      data,
      setData,
    ] =
      React.useState<
        BlogData | null
      >(null);

    const [
      error,
      setError,
    ] =
      React.useState<
        string | null
      >(null);

    React.useEffect(
      () => {
        loadBlogData()
          .then(setData)
          .catch(
            (err) => {
              setError(
                err instanceof Error
                  ? err.message
                  : String(err),
              );
            },
          );
      },
      [],
    );

    if (error) {
      return (
        <AbsoluteFill
          style={{
            background:
              COLORS.background,
            color:
              COLORS.white,
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
                COLORS.muted,
              fontSize: 22,
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
              COLORS.background,
            color:
              COLORS.white,
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
      (data.posts || [])
        .slice(0, 5);

    const analysis =
      data.analysis || {};

    const topics =
      (
        analysis.topics ||
        [
          "Insights",
          "Analysis",
          "Trends",
        ]
      )
        .filter(Boolean)
        .slice(0, 4);

    return (
      <AbsoluteFill
        style={{
          background:
            COLORS.background,
          color:
            COLORS.white,
          fontFamily:
            "Arial, Helvetica, sans-serif",
          overflow:
            "hidden",
        }}
      >
        {/* IDENTITY */}

        <Sequence
          from={0}
          durationInFrames={90}
        >
          <IdentityScene
            data={data}
            analysis={analysis}
          />
        </Sequence>

        {/* TOPICS */}

        <Sequence
          from={90}
          durationInFrames={90}
        >
          <TopicsScene
            topics={topics}
            analysis={analysis}
          />
        </Sequence>

        {/* POSTS */}

        {posts.map(
          (
            post,
            index,
          ) => (
            <Sequence
              key={
                post.url ||
                post.title ||
                `post-${index}`
              }
              from={
                180 +
                index * 72
              }
              durationInFrames={72}
            >
              <PostScene
                post={post}
                index={index}
                total={
                  posts.length
                }
              />
            </Sequence>
          ),
        )}

        {/* VALUE */}

        <Sequence
          from={540}
          durationInFrames={90}
        >
          <ValueScene
            data={data}
            analysis={analysis}
            topics={topics}
          />
        </Sequence>

        {/* CTA */}

        <Sequence
          from={630}
          durationInFrames={90}
        >
          <CtaScene
            data={data}
          />
        </Sequence>
      </AbsoluteFill>
    );
  };

/* ======================================================
   BACKGROUND
====================================================== */

const BaseBackground: React.FC = () => {
  return (
    <>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, #07090d 0%, #101720 55%, #07090d 100%)",
        }}
      />

      <AbsoluteFill
        style={{
          opacity: 0.035,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
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
          width: 8,
          height:
            "100%",
          background:
            COLORS.accent,
          opacity: 0.8,
        }}
      />
    </>
  );
};

/* ======================================================
   IDENTITY
====================================================== */

const IdentityScene: React.FC<{
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
      60,
      24,
    );

  const topic =
    safe(
      analysis.topics?.[0],
      "INSIGHTS",
    ).toUpperCase();

  const identity =
    safe(
      analysis.identity,
      safe(
        data.description,
        `${data.siteTitle} delivers useful insights and analysis.`,
      ),
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <BaseBackground />

      <div
        style={{
          position:
            "absolute",
          left: 130,
          right: 130,
          top: 100,
          bottom: 80,
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
            letterSpacing: 8,
            fontWeight: 700,
            color:
              COLORS.accent,
            marginBottom: 28,
          }}
        >
          {topic}
        </div>

        <div
          style={{
            fontSize: 92,
            lineHeight: 0.98,
            fontWeight: 900,
            letterSpacing: -4,
            maxWidth: 1500,
          }}
        >
          {truncate(
            data.siteTitle,
            42,
          )}
        </div>

        <div
          style={{
            marginTop: 34,
            width: 110,
            height: 4,
            background:
              COLORS.white,
          }}
        />

        <div
          style={{
            marginTop: 28,
            maxWidth: 1250,
            fontSize: 29,
            lineHeight: 1.42,
            color:
              COLORS.muted,
          }}
        >
          {truncate(
            identity,
            180,
          )}
        </div>

        <div
          style={{
            marginTop: 32,
            fontSize: 15,
            letterSpacing: 4,
            color:
              COLORS.soft,
          }}
        >
          A BLOG BUILT AROUND INSIGHT
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   TOPICS
====================================================== */

const TopicsScene: React.FC<{
  topics: string[];
  analysis: BlogAnalysis;
}> = ({
  topics,
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

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <BaseBackground />

      <div
        style={{
          position:
            "absolute",
          left: 130,
          right: 130,
          top: 110,
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
            fontSize: 17,
            letterSpacing: 6,
            color:
              COLORS.accent,
            fontWeight: 700,
          }}
        >
          WHAT YOU'LL FIND
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: -2,
          }}
        >
          Focused fields.
        </div>

        <div
          style={{
            marginTop: 14,
            color:
              COLORS.muted,
            fontSize: 25,
          }}
        >
          {truncate(
            analysis.contentStyle,
            90,
          )}
        </div>

        <div
          style={{
            display:
              "flex",
            flexWrap:
              "wrap",
            gap: 18,
            marginTop: 52,
            maxWidth: 1500,
          }}
        >
          {topics.map(
            (
              topic,
              index,
            ) => {
              const chipOpacity =
                interpolate(
                  frame,
                  [
                    12 +
                      index * 8,
                    28 +
                      index * 8,
                  ],
                  [0, 1],
                  {
                    extrapolateLeft:
                      "clamp",
                    extrapolateRight:
                      "clamp",
                  },
                );

              const chipY =
                interpolate(
                  frame,
                  [
                    12 +
                      index * 8,
                    28 +
                      index * 8,
                  ],
                  [20, 0],
                  {
                    extrapolateLeft:
                      "clamp",
                    extrapolateRight:
                      "clamp",
                  },
                );

              return (
                <div
                  key={
                    topic
                  }
                  style={{
                    opacity:
                      chipOpacity,
                    transform:
                      `translateY(${chipY}px)`,
                    padding:
                      "20px 28px",
                    border:
                      `1px solid ${COLORS.line}`,
                    borderRadius:
                      999,
                    background:
                      "rgba(255,255,255,0.045)",
                    fontSize:
                      24,
                    fontWeight:
                      700,
                  }}
                >
                  {topic}
                </div>
              );
            },
          )}
        </div>

        <div
          style={{
            marginTop: 42,
            fontSize: 20,
            color:
              COLORS.soft,
          }}
        >
          {truncate(
            analysis.audience,
            110,
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   POST SCENE
====================================================== */

const PostScene: React.FC<{
  post: BlogPost;
  index: number;
  total: number;
}> = ({
  post,
  index,
  total,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      72,
    );

  const imageX =
    slideLeft(
      frame,
      80,
      20,
    );

  const textY =
    slideUp(
      frame,
      35,
      20,
    );

  const image =
    getImageSource(post);

  const progress =
    clamp(
      (index + 1) /
        Math.max(
          1,
          total,
        ),
      0,
      1,
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <BaseBackground />

      {/* IMAGE PANEL */}

      <div
        style={{
          position:
            "absolute",
          left: 100,
          top: 110,
          width: 1030,
          height: 820,
          borderRadius: 26,
          overflow:
            "hidden",
          background:
            COLORS.panel,
          border:
            `1px solid ${COLORS.line}`,
          transform:
            `translateX(${-imageX}px)`,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.45)",
        }}
      >
        {image ? (
          <Img
            src={image}
            style={{
              width:
                "100%",
              height:
                "100%",
              objectFit:
                "cover",
              display:
                "block",
            }}
          />
        ) : (
          <div
            style={{
              width:
                "100%",
              height:
                "100%",
              display:
                "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              padding: 60,
              textAlign:
                "center",
              fontSize: 36,
              fontWeight: 800,
            }}
          >
            {truncate(
              post.title,
              80,
            )}
          </div>
        )}

        {/* IMAGE OVERLAY */}

        <div
          style={{
            position:
              "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.02) 40%, rgba(0,0,0,0.48) 100%)",
          }}
        />

        <div
          style={{
            position:
              "absolute",
            left: 28,
            bottom: 26,
            fontSize: 15,
            letterSpacing: 4,
            fontWeight: 700,
            color:
              "rgba(255,255,255,0.86)",
          }}
        >
          FEATURED POST
        </div>
      </div>

      {/* TEXT PANEL */}

      <div
        style={{
          position:
            "absolute",
          left: 1190,
          right: 95,
          top: 130,
          bottom: 120,
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
            fontSize: 18,
            letterSpacing: 5,
            color:
              COLORS.accent,
            fontWeight: 800,
          }}
        >
          {String(
            index + 1,
          ).padStart(2, "0")}{" "}
          /{" "}
          {String(
            total,
          ).padStart(2, "0")}
        </div>

        <div
          style={{
            marginTop: 24,
            fontSize: 48,
            lineHeight: 1.08,
            fontWeight: 900,
            letterSpacing: -1.5,
          }}
        >
          {truncate(
            post.title,
            105,
          )}
        </div>

        <div
          style={{
            marginTop: 24,
            fontSize: 21,
            lineHeight: 1.5,
            color:
              COLORS.muted,
          }}
        >
          {truncate(
            post.excerpt,
            240,
          )}
        </div>

        {post.categories &&
          post.categories.length >
            0 && (
            <div
              style={{
                display:
                  "flex",
                flexWrap:
                  "wrap",
                gap: 9,
                marginTop: 26,
              }}
            >
              {post.categories
                .slice(0, 3)
                .map(
                  (
                    category,
                  ) => (
                    <div
                      key={
                        category
                      }
                      style={{
                        fontSize:
                          14,
                        color:
                          COLORS.soft,
                        border:
                          `1px solid ${COLORS.line}`,
                        borderRadius:
                          999,
                        padding:
                          "7px 13px",
                      }}
                    >
                      {category}
                    </div>
                  ),
                )}
            </div>
          )}

        {post.date && (
          <div
            style={{
              marginTop: 26,
              fontSize: 16,
              color:
                COLORS.soft,
            }}
          >
            {post.date}
          </div>
        )}

        {/* PROGRESS */}

        <div
          style={{
            marginTop: 40,
            width:
              "100%",
            height: 3,
            background:
              COLORS.faint,
          }}
        >
          <div
            style={{
              width:
                `${progress * 100}%`,
              height:
                "100%",
              background:
                COLORS.accent,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   VALUE
====================================================== */

const ValueScene: React.FC<{
  data: BlogData;
  analysis: BlogAnalysis;
  topics: string[];
}> = ({
  data,
  analysis,
  topics,
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

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <BaseBackground />

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
              COLORS.accent,
            fontWeight: 800,
          }}
        >
          WHY FOLLOW {safe(
            data.siteTitle,
          ).toUpperCase()}
        </div>

        <div
          style={{
            marginTop: 28,
            fontSize: 66,
            lineHeight: 1.05,
            fontWeight: 900,
            maxWidth: 1500,
          }}
        >
          {truncate(
            analysis.valueProposition,
            150,
          )}
        </div>

        <div
          style={{
            display:
              "flex",
            gap: 14,
            marginTop: 48,
          }}
        >
          {topics
            .slice(0, 3)
            .map(
              (
                topic,
              ) => (
                <div
                  key={
                    topic
                  }
                  style={{
                    fontSize:
                      18,
                    fontWeight:
                      700,
                    color:
                      COLORS.muted,
                    padding:
                      "13px 20px",
                    border:
                      `1px solid ${COLORS.line}`,
                    borderRadius:
                      999,
                  }}
                >
                  {topic}
                </div>
              ),
            )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   CTA
====================================================== */

const CtaScene: React.FC<{
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

  const scale =
    interpolate(
      frame,
      [0, 90],
      [0.94, 1],
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
      }}
    >
      <BaseBackground />

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
            fontSize: 18,
            letterSpacing: 7,
            color:
              COLORS.accent,
            fontWeight: 800,
          }}
        >
          EXPLORE MORE
        </div>

        <div
          style={{
            marginTop: 26,
            fontSize: 90,
            fontWeight: 900,
            letterSpacing: -4,
          }}
        >
          {truncate(
            data.siteTitle,
            42,
          )}
        </div>

        <div
          style={{
            marginTop: 24,
            fontSize: 26,
            color:
              COLORS.muted,
          }}
        >
          Discover the latest posts,
          insights and analysis.
        </div>

        <div
          style={{
            marginTop: 44,
            padding:
              "18px 34px",
            borderRadius:
              999,
            background:
              COLORS.white,
            color:
              COLORS.background,
            fontSize: 21,
            fontWeight: 800,
          }}
        >
          {truncate(
            data.hostname ||
              data.url,
            70,
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
