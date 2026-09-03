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
---------------------------------------------------------
0–3s    BLOG IDENTITY
3–6s    CORE FIELDS
6–18s   FIVE RECENT POSTS
18–21s  BLOG VALUE
21–24s  CTA

1920 × 1080
30 FPS
720 FRAMES
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
  url: string;
  date?: string;
  published?: string;
  excerpt?: string;
  image?: string;
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

  ogImage?: string;

  language?: string;

  postCount?: number;

  analysis?: BlogAnalysis;

  posts: BlogPost[];
};

/* ======================================================
   DESIGN SYSTEM
====================================================== */

const COLORS = {
  background: "#08090b",
  background2: "#101318",

  white: "#ffffff",

  text: "#f5f7fa",

  muted:
    "rgba(245,247,250,0.68)",

  soft:
    "rgba(245,247,250,0.48)",

  faint:
    "rgba(245,247,250,0.22)",

  line:
    "rgba(255,255,255,0.13)",

  panel:
    "rgba(18,21,27,0.94)",

  accent:
    "#6ea8ff",
};

/* ======================================================
   HELPERS
====================================================== */

const safe = (
  value:
    | string
    | undefined,
  fallback = "",
) => {
  const text =
    String(
      value || "",
    ).trim();

  return (
    text || fallback
  );
};

const truncate = (
  value:
    | string
    | undefined,
  length: number,
) => {
  const text =
    safe(value);

  if (
    text.length <=
    length
  ) {
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
  duration = 16,
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
  duration = 16,
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
  distance = 60,
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
   DATA LOADER
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
   IMAGE SOURCE
====================================================== */

const getImageSource = (
  post: BlogPost,
) => {
  if (
    post.localImage
  ) {
    return staticFile(
      post.localImage,
    );
  }

  if (
    post.image
  ) {
    return post.image;
  }

  return staticFile(
    "blog/home.png",
  );
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
      React.useState<BlogData | null>(
        null,
      );

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
          .then(
            setData,
          )
          .catch(
            (err) => {
              setError(
                err instanceof
                  Error
                  ? err.message
                  : String(
                      err,
                    ),
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
            padding: 80,
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 800,
            }}
          >
            Blog data error
          </div>

          <div
            style={{
              marginTop: 20,
              fontSize: 22,
              color:
                COLORS.muted,
              textAlign:
                "center",
              maxWidth: 1200,
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
      (
        data.posts ||
        []
      ).slice(0, 5);

    const analysis =
      data.analysis ||
      {};

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
        {/* ============================================
            0–3s
            IDENTITY
        ============================================ */}

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

        {/* ============================================
            3–6s
            CORE FIELDS
        ============================================ */}

        <Sequence
          from={90}
          durationInFrames={90}
        >
          <TopicsScene
            topics={topics}
            analysis={
              analysis
            }
          />
        </Sequence>

        {/* ============================================
            6–18s
            POSTS
        ============================================ */}

        {posts.map(
          (
            post,
            index,
          ) => (
            <Sequence
              key={
                post.url ||
                `post-${index}`
              }
              from={
                180 +
                index * 72
              }
              durationInFrames={
                72
              }
            >
              <PostScene
                post={post}
                index={
                  index
                }
                total={
                  posts.length
                }
              />
            </Sequence>
          ),
        )}

        {/* ============================================
            18–21s
            VALUE
        ============================================ */}

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

        {/* ============================================
            21–24s
            CTA
        ============================================ */}

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
   COMMON BACKGROUND
====================================================== */

const PremiumBackground: React.FC<{
  image?: string;
  imageOpacity?: number;
}> = ({
  image,
  imageOpacity = 0.18,
}) => {
  return (
    <>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, #07080a 0%, #11151c 48%, #08090b 100%)",
        }}
      />

      {image && (
        <AbsoluteFill
          style={{
            opacity:
              imageOpacity,
            overflow:
              "hidden",
          }}
        >
          <Img
            src={image}
            style={{
              width:
                "100%",
              height:
                "100%",
              objectFit:
                "cover",
              filter:
                "blur(2px)",
              transform:
                "scale(1.06)",
            }}
          />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(8,9,11,0.97) 0%, rgba(8,9,11,0.80) 48%, rgba(8,9,11,0.40) 100%)",
        }}
      />

      <AbsoluteFill
        style={{
          opacity: 0.06,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)",
          backgroundSize:
            "80px 80px",
        }}
      />
    </>
  );
};

/* ======================================================
   IDENTITY SCENE
   0–3s
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
      55,
      22,
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

  const identity =
    safe(
      analysis.identity,
      safe(
        data.description,
        `${data.siteTitle} delivers useful insights and information.`,
      ),
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <PremiumBackground />

      <div
        style={{
          position:
            "absolute",
          left: 120,
          right: 120,
          top: 100,
          bottom: 80,
          display:
            "flex",
          flexDirection:
            "column",
          justifyContent:
            "center",
          transform:
            `translateY(${y}px) scale(${scale})`,
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: 7,
            fontWeight: 700,
            color:
              COLORS.soft,
            marginBottom: 26,
          }}
        >
          {primaryTopic}
        </div>

        <div
          style={{
            fontSize: 88,
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
            width: 120,
            height: 4,
            marginTop: 32,
            background:
              COLORS.white,
          }}
        />

        <div
          style={{
            marginTop: 26,
            maxWidth: 1200,
            fontSize: 28,
            lineHeight: 1.4,
            color:
              COLORS.muted,
          }}
        >
          {truncate(
            identity,
            150,
          )}
        </div>

        <div
          style={{
            marginTop: 34,
            fontSize: 15,
            letterSpacing: 4,
            color:
              COLORS.soft,
          }}
        >
          DISCOVER THE BLOG
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   TOPICS SCENE
   3–6s
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

  return (
    <AbsoluteFill
      style={{
        opacity,
        background:
          COLORS.background,
      }}
    >
      <PremiumBackground />

      <div
        style={{
          position:
            "absolute",
          left: 120,
          top: 120,
          right: 120,
          bottom: 100,
        }}
      >
        <div
          style={{
            fontSize: 16,
            letterSpacing: 6,
            color:
              COLORS.soft,
            fontWeight: 700,
          }}
        >
          CORE FIELDS
        </div>

        <div
          style={{
            marginTop: 22,
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: -2,
          }}
        >
          What this blog covers
        </div>

        <div
          style={{
            marginTop: 55,
            display:
              "flex",
            gap: 20,
            flexWrap:
              "wrap",
            maxWidth: 1500,
          }}
        >
          {topics.map(
            (
              topic,
              index,
            ) => {
              const localFrame =
                frame -
                index * 5;

              const itemOpacity =
                fadeIn(
                  localFrame,
                  14,
                );

              const x =
                slideLeft(
                  localFrame,
                  55,
                  18,
                );

              return (
                <div
                  key={topic}
                  style={{
                    opacity:
                      itemOpacity,
                    transform:
                      `translateX(${x}px)`,
                    padding:
                      "22px 30px",
                    border:
                      `1px solid ${COLORS.line}`,
                    borderRadius:
                      18,
                    background:
                      "rgba(255,255,255,0.045)",
                    minWidth:
                      280,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      color:
                        COLORS.soft,
                      letterSpacing: 3,
                    }}
                  >
                    0
                    {index +
                      1}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      fontSize: 30,
                      fontWeight: 800,
                    }}
                  >
                    {topic}
                  </div>
                </div>
              );
            },
          )}
        </div>

        <div
          style={{
            position:
              "absolute",
            left: 0,
            bottom: 0,
            fontSize: 22,
            color:
              COLORS.muted,
            maxWidth: 1250,
          }}
        >
          {truncate(
            safe(
              analysis.audience,
              "For readers looking for useful insights.",
            ),
            125,
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   POST SCENE
   6–18s
---------------------------------------------------------
Each post gets 72 frames = 2.4 seconds.
Image is intentionally large.
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

  const image =
    getImageSource(
      post,
    );

  const imageScale =
    interpolate(
      frame,
      [0, 72],
      [
        1.02,
        1.08,
      ],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const imageX =
    index % 2 === 0
      ? interpolate(
          frame,
          [0, 72],
          [0, -18],
          {
            extrapolateLeft:
              "clamp",
            extrapolateRight:
              "clamp",
          },
        )
      : interpolate(
          frame,
          [0, 72],
          [18, 0],
          {
            extrapolateLeft:
              "clamp",
            extrapolateRight:
              "clamp",
          },
        );

  const titleY =
    slideUp(
      frame,
      35,
      17,
    );

  const excerptY =
    slideUp(
      Math.max(
        0,
        frame - 7,
      ),
      30,
      17,
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            COLORS.background,
        }}
      />

      {/* ============================================
          LARGE IMAGE
      ============================================ */}

      <div
        style={{
          position:
            "absolute",
          left: 70,
          top: 70,
          width: 1120,
          height: 940,
          overflow:
            "hidden",
          borderRadius:
            24,
          border:
            `1px solid ${COLORS.line}`,
          background:
            "#111",
        }}
      >
        <Img
          src={image}
          style={{
            width:
              "100%",
            height:
              "100%",
            objectFit:
              "cover",
            transform:
              `translateX(${imageX}px) scale(${imageScale})`,
          }}
        />

        {/* Subtle image protection */}
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.08) 45%, rgba(0,0,0,0.32) 100%)",
          }}
        />
      </div>

      {/* ============================================
          RIGHT INFORMATION PANEL
      ============================================ */}

      <div
        style={{
          position:
            "absolute",
          left: 1240,
          top: 100,
          right: 95,
          bottom: 100,
          display:
            "flex",
          flexDirection:
            "column",
          justifyContent:
            "center",
        }}
      >
        <div
          style={{
            fontSize: 15,
            letterSpacing: 4,
            color:
              COLORS.soft,
            fontWeight: 700,
          }}
        >
          FEATURE
          {"  "}
          {String(
            index + 1,
          ).padStart(2, "0")}
          {" / "}
          {String(
            total,
          ).padStart(2, "0")}
        </div>

        <div
          style={{
            marginTop: 22,
            opacity:
              fadeIn(
                frame,
                14,
              ),
            transform:
              `translateY(${titleY}px)`,
            fontSize: 48,
            lineHeight: 1.08,
            fontWeight: 900,
            letterSpacing: -1.5,
          }}
        >
          {truncate(
            post.title,
            95,
          )}
        </div>

        {post.date && (
          <div
            style={{
              marginTop: 20,
              fontSize: 17,
              color:
                COLORS.soft,
              letterSpacing: 1,
            }}
          >
            {post.date}
          </div>
        )}

        <div
          style={{
            marginTop: 25,
            height: 1,
            width: "100%",
            background:
              COLORS.line,
          }}
        />

        <div
          style={{
            marginTop: 25,
            opacity:
              fadeIn(
                Math.max(
                  0,
                  frame - 7,
                ),
                15,
              ),
            transform:
              `translateY(${excerptY}px)`,
            fontSize: 20,
            lineHeight: 1.45,
            color:
              COLORS.muted,
          }}
        >
          {truncate(
            post.excerpt,
            190,
          )}
        </div>

        <div
          style={{
            marginTop: 30,
            display:
              "flex",
            gap: 9,
            flexWrap:
              "wrap",
          }}
        >
          {(
            post.categories ||
            []
          )
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
                    fontSize: 13,
                    padding:
                      "8px 12px",
                    border:
                      `1px solid ${COLORS.line}`,
                    borderRadius:
                      999,
                    color:
                      COLORS.soft,
                  }}
                >
                  {category}
                </div>
              ),
            )}
        </div>
      </div>

      {/* ============================================
          PROGRESS
      ============================================ */}

      <div
        style={{
          position:
            "absolute",
          left: 70,
          right: 95,
          bottom: 38,
          height: 3,
          background:
            "rgba(255,255,255,0.12)",
        }}
      >
        <div
          style={{
            width: `${
              ((index + 1) /
                total) *
              100
            }%`,
            height: "100%",
            background:
              COLORS.white,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/* ======================================================
   VALUE SCENE
   18–21s
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
      40,
      20,
    );

  const primary =
    topics[0] ||
    "Insights";

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      <PremiumBackground />

      <div
        style={{
          position:
            "absolute",
          left: 120,
          right: 120,
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
            fontSize: 16,
            letterSpacing: 6,
            color:
              COLORS.soft,
            fontWeight: 700,
          }}
        >
          WHY FOLLOW
        </div>

        <div
          style={{
            marginTop: 25,
            fontSize: 68,
            fontWeight: 900,
            letterSpacing: -2,
          }}
        >
          {truncate(
            safe(
              analysis.valueProposition,
              `Clear ${primary.toLowerCase()} insights and practical information.`,
            ),
            105,
          )}
        </div>

        <div
          style={{
            marginTop: 40,
            display:
              "flex",
            gap: 50,
          }}
        >
          <Stat
            label="FOCUS"
            value={
              primary
            }
          />

          <Stat
            label="STYLE"
            value={truncate(
              safe(
                analysis.contentStyle,
                "Analysis",
              ),
              28,
            )}
          />

          <Stat
            label="POSTS"
            value={String(
              data.postCount ||
                data.posts
                  ?.length ||
                0,
            )}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{
  label: string;
  value: string;
}> = ({
  label,
  value,
}) => (
  <div
    style={{
      minWidth: 250,
    }}
  >
    <div
      style={{
        fontSize: 13,
        letterSpacing: 4,
        color:
          COLORS.soft,
      }}
    >
      {label}
    </div>

    <div
      style={{
        marginTop: 12,
        fontSize: 25,
        fontWeight: 800,
      }}
    >
      {value}
    </div>
  </div>
);

/* ======================================================
   CTA
   21–24s
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
      [0.96, 1],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const hostname =
    safe(
      data.hostname,
      (() => {
        try {
          return new URL(
            data.url,
          ).hostname.replace(
            /^www\./,
            "",
          );
        } catch {
          return "";
        }
      })(),
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
        background:
          "radial-gradient(circle at 50% 45%, #1b2431 0%, #0b0d10 55%, #050607 100%)",
        alignItems:
          "center",
        justifyContent:
          "center",
      }}
    >
      <div
        style={{
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
              COLORS.soft,
            fontWeight: 700,
          }}
        >
          {hostname}
        </div>

        <div
          style={{
            marginTop: 24,
            fontSize: 78,
            fontWeight: 900,
            letterSpacing: -3,
          }}
        >
          {truncate(
            data.siteTitle,
            40,
          )}
        </div>

        <div
          style={{
            marginTop: 25,
            fontSize: 31,
            color:
              COLORS.muted,
          }}
        >
          Stay informed.
          {" "}
          Explore what matters.
        </div>

        <div
          style={{
            display:
              "inline-flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            marginTop: 45,
            padding:
              "18px 34px",
            border:
              "1px solid rgba(255,255,255,0.32)",
            borderRadius:
              999,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 3,
            background:
              "rgba(255,255,255,0.07)",
          }}
        >
          VISIT THE BLOG
        </div>

        <div
          style={{
            marginTop: 28,
            fontSize: 15,
            color:
              COLORS.soft,
          }}
        >
          {truncate(
            data.url,
            90,
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
