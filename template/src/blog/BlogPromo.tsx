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
  excerpt: string;
  image: string;
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

  analysis?: BlogAnalysis;
};

const safe = (
  value: string | undefined,
  fallback: string,
) => {
  const text = (value || "").trim();

  return text || fallback;
};

const truncate = (
  value: string | undefined,
  length: number,
) => {
  const text = safe(value, "");

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

const opacityIn = (
  frame: number,
  start: number,
  duration = 15,
) =>
  interpolate(
    frame,
    [start, start + duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

const opacityOut = (
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
  end: number,
) =>
  opacityIn(
    frame,
    0,
    12,
  ) *
  opacityOut(
    frame,
    end,
    12,
  );

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

export const BlogPromo: React.FC = () => {
  const frame =
    useCurrentFrame();

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
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : String(err),
        ),
      );
  }, []);

  if (error) {
    return (
      <AbsoluteFill
        style={{
          background:
            "#0b0b0b",
          color: "white",
          alignItems:
            "center",
          justifyContent:
            "center",
          fontFamily:
            "Arial, sans-serif",
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
            opacity: 0.7,
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
            "#0b0b0b",
          color: "white",
          alignItems:
            "center",
          justifyContent:
            "center",
          fontFamily:
            "Arial, sans-serif",
          fontSize: 34,
        }}
      >
        Analyzing blog…
      </AbsoluteFill>
    );
  }

  const posts =
    (data.posts || [])
      .slice(0, 3);

  const analysis =
    data.analysis || {
      topics: [
        "General Insights",
      ],

      audience:
        "Readers looking for useful insights",

      contentStyle:
        "Analysis and commentary",

      valueProposition:
        "Useful ideas and insights in one place.",
    };

  return (
    <AbsoluteFill
      style={{
        background:
          "#090909",

        color:
          "#ffffff",

        fontFamily:
          "Arial, Helvetica, sans-serif",

        overflow:
          "hidden",
      }}
    >
      {/* 0s - 4s */}
      <Sequence
        from={0}
        durationInFrames={120}
      >
        <Intro
          data={data}
        />
      </Sequence>

      {/* 4s - 7s */}
      <Sequence
        from={120}
        durationInFrames={90}
      >
        <Positioning
          data={data}
          analysis={analysis}
        />
      </Sequence>

      {/* 7s - 17s */}
      {posts.map(
        (
          post,
          index,
        ) => (
          <Sequence
            key={
              post.url ||
              "post-" +
                index
            }
            from={
              210 +
              index *
                100
            }
            durationInFrames={
              100
            }
          >
            <PostCard
              post={post}
              index={
                index
              }
            />
          </Sequence>
        ),
      )}

      {/* 17s - 21s */}
      <Sequence
        from={510}
        durationInFrames={120}
      >
        <AnalysisScene
          data={data}
          analysis={analysis}
        />
      </Sequence>

      {/* 21s - 24s */}
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
   0 - 4 seconds
========================================================= */

const Intro: React.FC<{
  data: BlogData;
}> = ({ data }) => {
  const frame =
    useCurrentFrame();

  const opacity =
    sceneOpacity(
      frame,
      120,
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

        padding: 90,
      }}
    >
      <div
        style={{
          fontSize: 24,
          letterSpacing: 8,
          opacity: 0.55,
          marginBottom: 28,
        }}
      >
        DISCOVER
      </div>

      <div
        style={{
          fontSize: 88,
          lineHeight: 1,
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
          marginTop: 32,
          maxWidth: 1100,
          fontSize: 28,
          lineHeight: 1.45,
          opacity: 0.7,
        }}
      >
        {truncate(
          safe(
            data.description,
            "Explore useful stories, ideas and insights.",
          ),
          150,
        )}
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   POSITIONING
   4 - 7 seconds
========================================================= */

const Positioning: React.FC<{
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

  const topics =
    analysis.topics.slice(
      0,
      3,
    );

  return (
    <AbsoluteFill
      style={{
        opacity,

        padding:
          "90px 120px",

        justifyContent:
          "center",
      }}
    >
      <div
        style={{
          fontSize: 22,
          letterSpacing: 5,
          opacity: 0.5,
          marginBottom: 25,
        }}
      >
        WHY FOLLOW THIS BLOG
      </div>

      <div
        style={{
          fontSize: 55,
          lineHeight: 1.12,
          fontWeight: 850,
          maxWidth: 1300,
        }}
      >
        {truncate(
          analysis.valueProposition,
          170,
        )}
      </div>

      <div
        style={{
          display:
            "flex",

          gap: 16,

          marginTop: 40,

          flexWrap:
            "wrap",
        }}
      >
        {topics.map(
          (topic) => (
            <div
              key={
                topic
              }
              style={{
                border:
                  "1px solid rgba(255,255,255,0.3)",

                borderRadius:
                  999,

                padding:
                  "12px 22px",

                fontSize:
                  20,

                opacity:
                  0.8,
              }}
            >
              {topic}
            </div>
          ),
        )}
      </div>

      <div
        style={{
          marginTop: 28,
          fontSize: 20,
          opacity: 0.5,
        }}
      >
        {truncate(
          analysis.audience,
          120,
        )}
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   POST CARD
   7 - 17 seconds
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

  const opacity =
    sceneOpacity(
      frame,
      100,
    );

  const image =
    post.localScreenshot
      ? staticFile(
          post.localScreenshot,
        )
      : staticFile(
          "blog/home.png",
        );

  const scale =
    interpolate(
      frame,
      [0, 100],
      [1.04, 1],
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
      <Img
        src={image}
        style={{
          position:
            "absolute",

          inset: 0,

          width:
            "100%",

          height:
            "100%",

          objectFit:
            "cover",

          transform:
            `scale(${scale})`,

          filter:
            "brightness(0.34)",
        }}
      />

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.92), rgba(0,0,0,0.55), rgba(0,0,0,0.28))",
        }}
      />

      <div
        style={{
          position:
            "absolute",

          left: 115,

          right: 115,

          top: 95,

          bottom: 95,

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
            fontSize: 20,
            letterSpacing: 5,
            opacity: 0.5,
            marginBottom: 24,
          }}
        >
          FEATURED ARTICLE{" "}
          {index + 1}
        </div>

        <div
          style={{
            fontSize: 60,
            fontWeight: 900,
            lineHeight: 1.08,
            maxWidth: 1350,
          }}
        >
          {truncate(
            safe(
              post.title,
              "Featured article",
            ),
            82,
          )}
        </div>

        {post.date ? (
          <div
            style={{
              marginTop: 18,
              fontSize: 19,
              opacity: 0.5,
            }}
          >
            {post.date}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 28,
            fontSize: 24,
            lineHeight: 1.5,
            maxWidth: 1100,
            opacity: 0.72,
          }}
        >
          {truncate(
            safe(
              post.excerpt,
              "Read the full article for more insights.",
            ),
            190,
          )}
        </div>

        <div
          style={{
            marginTop: 38,
            fontSize: 18,
            letterSpacing: 2,
            opacity: 0.55,
          }}
        >
          READ MORE →
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   BLOG ANALYSIS
   17 - 21 seconds
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
      120,
    );

  return (
    <AbsoluteFill
      style={{
        opacity,

        padding:
          "90px 120px",

        justifyContent:
          "center",
      }}
    >
      <div
        style={{
          fontSize: 22,
          letterSpacing: 5,
          opacity: 0.5,
          marginBottom: 28,
        }}
      >
        THE BLOG AT A GLANCE
      </div>

      <div
        style={{
          display:
            "flex",

          gap: 90,

          alignItems:
            "flex-start",
        }}
      >
        <div
          style={{
            flex: 1,
          }}
        >
          <div
            style={{
              fontSize: 25,
              opacity: 0.55,
              marginBottom: 15,
            }}
          >
            CONTENT
          </div>

          <div
            style={{
              fontSize: 43,
              fontWeight: 800,
              lineHeight: 1.15,
            }}
          >
            {truncate(
              analysis.contentStyle,
              70,
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
          }}
        >
          <div
            style={{
              fontSize: 25,
              opacity: 0.55,
              marginBottom: 15,
            }}
          >
            TOPICS
          </div>

          <div
            style={{
              fontSize: 31,
              lineHeight: 1.5,
              fontWeight: 700,
            }}
          >
            {analysis.topics
              .slice(
                0,
                3,
              )
              .join(
                "  •  ",
              )}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 55,
          fontSize: 21,
          opacity: 0.5,
        }}
      >
        {
          data.postCount
        }{" "}
        recent articles analyzed
      </div>
    </AbsoluteFill>
  );
};

/* =========================================================
   OUTRO
   21 - 24 seconds
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

        padding: 80,
      }}
    >
      <div
        style={{
          fontSize: 22,
          letterSpacing: 7,
          opacity: 0.5,
          marginBottom: 28,
        }}
      >
        KEEP EXPLORING
      </div>

      <div
        style={{
          fontSize: 76,
          fontWeight: 900,
          lineHeight: 1.05,
          maxWidth: 1400,
        }}
      >
        {truncate(
          safe(
            data.siteTitle,
            "Discover something new.",
          ),
          48,
        )}
      </div>

      <div
        style={{
          marginTop: 28,
          fontSize: 25,
          opacity: 0.62,
        }}
      >
        Visit the blog for the latest insights.
      </div>

      <div
        style={{
          marginTop: 42,

          border:
            "1px solid rgba(255,255,255,0.35)",

          borderRadius:
            999,

          padding:
            "16px 34px",

          fontSize: 19,

          letterSpacing: 2,
        }}
      >
        VISIT BLOG
      </div>
    </AbsoluteFill>
  );
};
