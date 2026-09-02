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

  /*
   * 반드시 최대 5개 사용.
   *
   * capture-blog.mjs에서 Blogger Feed의
   * 최신 게시물 5개를 생성한다.
   */
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
          HOOK
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
          BLOG PROFILE
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
          72 frames = 2.4 sec each
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
          "radial-gradient(circle at 70% 35%, rgba(255,255,255,0.10), transparent 35%), #080808",
      }}
    >
      {/* subtle grid */}
      <AbsoluteFill
        style={{
          opacity: 0.08,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)",
          backgroundSize:
            "80px 80px",
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
            fontSize: 20,
            letterSpacing: 7,
            fontWeight: 700,
            opacity: 0.5,
            marginBottom: 28,
          }}
        >
          {primaryTopic}
        </div>

        <div
          style={{
            fontSize: 82,
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
            opacity: 0.75,
          }}
        />

        <div
          style={{
            marginTop: 28,
            maxWidth: 1100,
            fontSize: 28,
            lineHeight: 1.4,
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
            fontSize: 18,
            letterSpacing: 3,
            opacity: 0.4,
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
          "75px 110px",
        justifyContent:
          "center",
      }}
    >
      <div
        style={{
          fontSize: 20,
          letterSpacing: 6,
          opacity: 0.42,
          marginBottom: 22,
        }}
      >
        WHY FOLLOW
      </div>

      <div
        style={{
          fontSize: 58,
          lineHeight: 1.08,
          fontWeight: 850,
          maxWidth: 1250,
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
          marginTop: 38,
          flexWrap: "wrap",
        }}
      >
        {cards.map(
          (card, index) => (
            <div
              key={card.label}
              style={{
                width:
                  index === 2
                    ? 470
                    : 330,
                minHeight: 100,
                border:
                  "1px solid rgba(255,255,255,0.18)",
                background:
                  "rgba(255,255,255,0.035)",
                borderRadius: 10,
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
                  fontSize: 14,
                  letterSpacing: 3,
                  opacity: 0.42,
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
                  opacity: 0.88,
                }}
              >
                {truncate(
                  card.value,
                  60,
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {topics.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 26,
            flexWrap: "wrap",
          }}
        >
          {topics.map(
            (topic, index) => (
              <div
                key={topic}
                style={{
                  fontSize: 17,
                  letterSpacing: 1,
                  padding:
                    "9px 16px",
                  borderRadius: 999,
                  border:
                    "1px solid rgba(255,255,255,0.22)",
                  opacity:
                    clamp(
                      0.45 +
                        index *
                          0.1,
                      0.45,
                      0.85,
                    ),
                }}
              >
                {topic}
              </div>
            ),
          )}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          right: 110,
          top: 74,
          fontSize: 15,
          letterSpacing: 2,
          opacity: 0.3,
        }}
      >
        {safe(
          normalizeUrl(
            data.url,
          ),
          "BLOG",
        ).toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   POST CARD
   2.4 seconds per post
========================================================= */

const PostCard: React.FC<{
  post: BlogPost;
  index: number;
}> = ({
  post,
  index,
}) => {
  const frame =
    useCurrentFrame();

  const duration = 72;

  const opacity =
    sceneOpacity(
      frame,
      duration,
    );

  /*
   * Each article gets a slightly different
   * camera direction.
   */
  const direction =
    index % 2 === 0
      ? 1
      : -1;

  const scale =
    interpolate(
      frame,
      [0, duration],
      [1.08, 1.0],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const translateX =
    interpolate(
      frame,
      [0, duration],
      [
        direction * 18,
        direction * -18,
      ],
      {
        extrapolateLeft:
          "clamp",
        extrapolateRight:
          "clamp",
      },
    );

  const image =
    getImageSource(post);

  const title =
    truncate(
      safe(
        post.title,
        "Featured article",
      ),
      78,
    );

  const excerpt =
    truncate(
      safe(
        post.excerpt,
        "Read the full article for more insights.",
      ),
      125,
    );

  const categories = (
    post.categories || []
  )
    .filter(Boolean)
    .slice(0, 2);

  return (
    <AbsoluteFill
      style={{
        opacity,
      }}
    >
      {/* =================================================
          BACKGROUND IMAGE
      ================================================= */}

      <Img
        src={image}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform:
            `translateX(${translateX}px) scale(${scale})`,
          filter:
            "brightness(0.38) saturate(0.85)",
        }}
      />

      {/* dark overlay */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.78) 38%, rgba(0,0,0,0.30) 100%)",
        }}
      />

      {/* bottom gradient */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(0deg, rgba(0,0,0,0.72), transparent 45%)",
        }}
      />

      {/* =================================================
          ARTICLE CONTENT
      ================================================= */}

      <div
        style={{
          position: "absolute",
          left: 105,
          right: 105,
          top: 90,
          bottom: 80,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginBottom: 24,
            transform:
              `translateX(${slideLeft(
                frame,
                45,
                16,
              )}px)`,
          }}
        >
          <div
            style={{
              fontSize: 17,
              letterSpacing: 4,
              fontWeight: 700,
              opacity: 0.55,
            }}
          >
            LATEST STORY
          </div>

          <div
            style={{
              width: 45,
              height: 1,
              background:
                "rgba(255,255,255,0.4)",
            }}
          />

          <div
            style={{
              fontSize: 16,
              opacity: 0.45,
            }}
          >
            {String(
              index + 1,
            ).padStart(2, "0")}
          </div>
        </div>

        <div
          style={{
            maxWidth: 1200,
            fontSize: 55,
            lineHeight: 1.05,
            fontWeight: 900,
            letterSpacing: -1.8,
            transform:
              `translateY(${slideUp(
                frame,
                45,
                18,
              )}px)`,
          }}
        >
          {title}
        </div>

        {post.date ? (
          <div
            style={{
              marginTop: 16,
              fontSize: 17,
              opacity: 0.42,
            }}
          >
            {post.date}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 20,
            maxWidth: 850,
            fontSize: 21,
            lineHeight: 1.42,
            opacity: 0.70,
            transform:
              `translateY(${slideUp(
                frame - 4,
                35,
                18,
              )}px)`,
          }}
        >
          {excerpt}
        </div>

        {categories.length > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 20,
            }}
          >
            {categories.map(
              (category) => (
                <div
                  key={category}
                  style={{
                    fontSize: 14,
                    letterSpacing: 1,
                    padding:
                      "7px 12px",
                    border:
                      "1px solid rgba(255,255,255,0.25)",
                    borderRadius: 999,
                    opacity: 0.55,
                  }}
                >
                  {category}
                </div>
              ),
            )}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 25,
            fontSize: 15,
            letterSpacing: 2.5,
            opacity: 0.48,
          }}
        >
          READ ARTICLE →
        </div>
      </div>

      {/* =================================================
          ARTICLE NUMBER
      ================================================= */}

      <div
        style={{
          position: "absolute",
          right: 100,
          top: 75,
          fontSize: 90,
          fontWeight: 900,
          lineHeight: 1,
          opacity: 0.09,
        }}
      >
        {String(
          index + 1,
        ).padStart(2, "0")}
      </div>

      {/* =================================================
          PROGRESS BAR
      ================================================= */}

      <div
        style={{
          position: "absolute",
          left: 105,
          right: 105,
          bottom: 38,
          height: 2,
          background:
            "rgba(255,255,255,0.14)",
        }}
      >
        <div
          style={{
            width:
              `${clamp(
                (frame /
                  duration) *
                  100,
                0,
                100,
              )}%`,
            height: "100%",
            background:
              "rgba(255,255,255,0.75)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   BLOG AT A GLANCE
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
    .slice(0, 5);

  const postCount =
    Math.max(
      0,
      Number(
        data.postCount ||
          data.posts?.length ||
          0,
      ),
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
        padding:
          "70px 110px",
        justifyContent:
          "center",
        background:
          "linear-gradient(135deg, #090909, #111111)",
      }}
    >
      <div
        style={{
          fontSize: 19,
          letterSpacing: 6,
          opacity: 0.42,
          marginBottom: 20,
        }}
      >
        THE BLOG AT A GLANCE
      </div>

      <div
        style={{
          display: "flex",
          gap: 70,
          alignItems: "flex-start",
        }}
      >
        {/* LEFT */}
        <div
          style={{
            flex: 1.15,
            transform:
              `translateY(${slideUp(
                frame,
                35,
                18,
              )}px)`,
          }}
        >
          <div
            style={{
              fontSize: 48,
              lineHeight: 1.08,
              fontWeight: 900,
              maxWidth: 850,
            }}
          >
            {truncate(
              safe(
                analysis.contentStyle,
                "Insights and analysis",
              ),
              90,
            )}
          </div>

          <div
            style={{
              marginTop: 22,
              maxWidth: 750,
              fontSize: 20,
              lineHeight: 1.45,
              opacity: 0.58,
            }}
          >
            {truncate(
              safe(
                analysis.audience,
                "For readers looking for useful information.",
              ),
              130,
            )}
          </div>

          <div
            style={{
              marginTop: 32,
              display: "flex",
              gap: 35,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                }}
              >
                {postCount}
              </div>

              <div
                style={{
                  fontSize: 13,
                  letterSpacing: 2,
                  opacity: 0.4,
                  marginTop: 4,
                }}
              >
                STORIES
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                }}
              >
                {topics.length}
              </div>

              <div
                style={{
                  fontSize: 13,
                  letterSpacing: 2,
                  opacity: 0.4,
                  marginTop: 4,
                }}
              >
                TOPICS
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div
          style={{
            flex: 0.85,
            paddingTop: 5,
          }}
        >
          <div
            style={{
              fontSize: 14,
              letterSpacing: 3,
              opacity: 0.38,
              marginBottom: 15,
            }}
          >
            KEY TOPICS
          </div>

          {topics.map(
            (topic, index) => (
              <div
                key={topic}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 15,
                  padding:
                    "12px 0",
                  borderBottom:
                    "1px solid rgba(255,255,255,0.10)",
                  transform:
                    `translateX(${slideLeft(
                      frame -
                        index * 3,
                      30,
                      15,
                    )}px)`,
                }}
              >
                <div
                  style={{
                    width: 25,
                    fontSize: 13,
                    opacity: 0.3,
                  }}
                >
                  {String(
                    index + 1,
                  ).padStart(2, "0")}
                </div>

                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 700,
                    opacity: 0.82,
                  }}
                >
                  {truncate(
                    topic,
                    38,
                  )}
                </div>
              </div>
            ),
          )}
        </div>
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
}> = ({ data }) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      90,
    );

  const url =
    safe(
      data.url,
      "",
    );

  const domain =
    normalizeUrl(
      url,
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
        alignItems:
          "center",
        justifyContent:
          "center",
        textAlign:
          "center",
        background:
          "radial-gradient(circle at center, rgba(255,255,255,0.08), transparent 40%), #080808",
        padding: 80,
      }}
    >
      <div
        style={{
          fontSize: 18,
          letterSpacing: 6,
          opacity: 0.42,
          marginBottom: 24,
          transform:
            `translateY(${slideUp(
              frame,
              30,
              18,
            )}px)`,
        }}
      >
        KEEP EXPLORING
      </div>

      <div
        style={{
          fontSize: 72,
          lineHeight: 1,
          fontWeight: 900,
          letterSpacing: -3,
          maxWidth: 1450,
          transform:
            `translateY(${slideUp(
              frame - 3,
              40,
              18,
            )}px)`,
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
          marginTop: 25,
          fontSize: 24,
          opacity: 0.62,
        }}
      >
        Discover more stories,
        insights and ideas.
      </div>

      <div
        style={{
          marginTop: 30,
          fontSize: 25,
          fontWeight: 700,
          letterSpacing: 1,
          opacity: 0.88,
        }}
      >
        {domain ||
          truncate(
            url,
            80,
          )}
      </div>

      <div
        style={{
          marginTop: 28,
          padding:
            "12px 25px",
          border:
            "1px solid rgba(255,255,255,0.45)",
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 3,
          opacity: 0.82,
        }}
      >
        VISIT BLOG →
      </div>

      <div
        style={{
          position:
            "absolute",
          left: 105,
          right: 105,
          bottom: 38,
          height: 2,
          background:
            "rgba(255,255,255,0.16)",
        }}
      >
        <div
          style={{
            width:
              `${clamp(
                (frame /
                  90) *
                  100,
                0,
                100,
              )}%`,
            height: "100%",
            background:
              "rgba(255,255,255,0.75)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
