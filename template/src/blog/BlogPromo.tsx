```tsx
import React, {
  useEffect,
  useState,
} from "react";

import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useDelayRender,
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

type BlogData = {
  version?: number;
  url: string;
  siteTitle: string;
  description: string;
  pageHeading: string;
  ogImage: string;
  posts: BlogPost[];
  postCount: number;
  capturedAt?: string;
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const fadeIn = (
  frame: number,
  start: number,
  duration = 15,
) =>
  interpolate(
    frame,
    [start, start + duration],
    [0, 1],
    clamp,
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
    clamp,
  );

const safeText = (
  value: string,
  fallback: string,
) => {
  const result = value?.trim();

  return result || fallback;
};

const truncate = (
  value: string,
  length: number,
) => {
  const text = safeText(value, "");

  if (text.length <= length) {
    return text;
  }

  return `${text.slice(0, length - 1)}…`;
};

/*
 * ------------------------------------------------------------
 * Blog data loader
 * ------------------------------------------------------------
 */

const useBlogData = () => {
  const [data, setData] =
    useState<BlogData | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const { delayRender, continueRender } =
    useDelayRender();

  useEffect(() => {
    const handle =
      delayRender("Loading blog.json");

    fetch(
      staticFile("blog/blog.json"),
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Could not load blog.json (${response.status})`,
          );
        }

        return response.json();
      })
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : String(err),
        );

        continueRender(handle);
      });
  }, [
    delayRender,
    continueRender,
  ]);

  return {
    data,
    error,
  };
};

/*
 * ------------------------------------------------------------
 * Main composition
 * ------------------------------------------------------------
 */

export const BlogPromo: React.FC = () => {
  const frame =
    useCurrentFrame();

  const {
    data,
    error,
  } = useBlogData();

  if (error) {
    return (
      <AbsoluteFill
        style={{
          background:
            "#111",
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
            fontSize: 34,
            fontWeight: 700,
          }}
        >
          Blog data could not be loaded
        </div>

        <div
          style={{
            marginTop: 20,
            fontSize: 20,
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
            "#111",
          color: "white",
          alignItems:
            "center",
          justifyContent:
            "center",
          fontFamily:
            "Arial, sans-serif",
          fontSize: 28,
        }}
      >
        Loading blog…
      </AbsoluteFill>
    );
  }

  const posts =
    data.posts?.slice(0, 3) || [];

  /*
   * 24 second structure
   *
   * 0–4       Intro / brand
   * 4–9       What the blog offers
   * 9–13      Post #1
   * 13–17     Post #2
   * 17–21     Post #3
   * 21–24     CTA
   */

  return (
    <AbsoluteFill
      style={{
        background:
          "#0b0b0b",
        color:
          "white",
        fontFamily:
          "Inter, Arial, sans-serif",
        overflow:
          "hidden",
      }}
    >
      <IntroScene
        data={data}
        frame={frame}
      />

      <Sequence
        from={120}
        durationInFrames={150}
      >
        <OverviewScene
          data={data}
        />
      </Sequence>

      {posts.map(
        (post, index) => (
          <Sequence
            key={`${post.url}-${index}`}
            from={270 + index * 120}
            durationInFrames={120}
          >
            <PostScene
              post={post}
              index={index}
            />
          </Sequence>
        ),
      )}

      <Sequence
        from={630}
        durationInFrames={90}
      >
        <OutroScene
          data={data}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

/*
 * ------------------------------------------------------------
 * Scene 1
 * ------------------------------------------------------------
 */

const IntroScene: React.FC<{
  data: BlogData;
  frame: number;
}> = ({
  data,
  frame,
}) => {
  const opacity =
    fadeIn(frame, 0) *
    fadeOut(frame, 105);

  const scale =
    interpolate(
      frame,
      [0, 90],
      [1.08, 1],
      clamp,
    );

  return (
    <AbsoluteFill
      style={{
        opacity,
        alignItems:
          "center",
        justifyContent:
          "center",
        transform:
          `scale(${scale})`,
        padding:
          100,
      }}
    >
      <div
        style={{
          textAlign:
            "center",
          maxWidth:
            1500,
        }}
      >
        <div
          style={{
            fontSize:
              24,
            letterSpacing:
              8,
            textTransform:
              "uppercase",
            opacity:
              0.65,
            marginBottom:
              28,
          }}
        >
          DISCOVER
        </div>

        <div
          style={{
            fontSize:
              82,
            lineHeight:
              1.05,
            fontWeight:
              800,
            letterSpacing:
              -3,
          }}
        >
          {truncate(
            safeText(
              data.siteTitle,
              "This Blog",
            ),
            45,
          )}
        </div>

        <div
          style={{
            marginTop:
              30,
            fontSize:
              28,
            lineHeight:
              1.45,
            opacity:
              0.72,
            maxWidth:
              1100,
            marginLeft:
              "auto",
            marginRight:
              "auto",
          }}
        >
          {truncate(
            safeText(
              data.description,
              "Explore useful stories, ideas and insights.",
            ),
            140,
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/*
 * ------------------------------------------------------------
 * Scene 2
 * ------------------------------------------------------------
 */

const OverviewScene: React.FC<{
  data: BlogData;
}> = ({
  data,
}) => {
  return (
    <AbsoluteFill
      style={{
        padding:
          "90px 110px",
        justifyContent:
          "center",
      }}
    >
      <div
        style={{
          fontSize:
            24,
          letterSpacing:
            5,
          textTransform:
            "uppercase",
          opacity:
            0.55,
          marginBottom:
            24,
        }}
      >
        WHAT YOU'LL FIND
      </div>

      <div
        style={{
          fontSize:
            60,
          fontWeight:
            750,
          lineHeight:
            1.1,
          maxWidth:
            1300,
        }}
      >
        Fresh ideas.
        <br />
        Useful insights.
        <br />
        New stories.
      </div>

      <div
        style={{
          marginTop:
            38,
          fontSize:
            25,
          lineHeight:
            1.5,
          opacity:
            0.7,
          maxWidth:
            1100,
        }}
      >
        {truncate(
          safeText(
            data.description,
            "Discover the latest content from this blog.",
          ),
          180,
        )}
      </div>

      <div
        style={{
          marginTop:
            45,
          display:
            "flex",
          alignItems:
            "center",
          gap:
            18,
        }}
      >
        <div
          style={{
            width:
              12,
            height:
              12,
            borderRadius:
              "50%",
            background:
              "white",
          }}
        />

        <div
          style={{
            fontSize:
              21,
            opacity:
              0.65,
          }}
        >
          {data.postCount || 0} articles available
        </div>
      </div>
    </AbsoluteFill>
  );
};

/*
 * ------------------------------------------------------------
 * Scene 3–5
 * ------------------------------------------------------------
 */

const PostScene: React.FC<{
  post: BlogPost;
  index: number;
}> = ({
  post,
  index,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    fadeIn(frame, 0, 12) *
    fadeOut(frame, 110, 10);

  const imageScale =
    interpolate(
      frame,
      [0, 120],
      [1.02, 1.08],
      clamp,
    );

  const localImage =
    post.localScreenshot;

  return (
    <AbsoluteFill
      style={{
        background:
          "#101010",
        opacity,
      }}
    >
      {localImage ? (
        <Img
          src={staticFile(
            localImage,
          )}
          style={{
            position:
              "absolute",
            inset:
              0,
            width:
              "100%",
            height:
              "100%",
            objectFit:
              "cover",
            transform:
              `scale(${imageScale})`,
            filter:
              "brightness(0.42) saturate(0.75)",
          }}
        />
      ) : (
        <Img
          src={staticFile(
            "blog/home.png",
          )}
          style={{
            position:
              "absolute",
            inset:
              0,
            width:
              "100%",
            height:
              "100%",
            objectFit:
              "cover",
            transform:
              `scale(${imageScale})`,
            filter:
              "brightness(0.35)",
          }}
        />
      )}

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.88), rgba(0,0,0,0.35), rgba(0,0,0,0.72))",
        }}
      />

      <div
        style={{
          position:
            "absolute",
          left:
            110,
          right:
            110,
          top:
            100,
          bottom:
            100,
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
            fontSize:
              20,
            letterSpacing:
              5,
            textTransform:
              "uppercase",
            opacity:
              0.6,
            marginBottom:
              25,
          }}
        >
          LATEST ARTICLE {index + 1}
        </div>

        <div
          style={{
            fontSize:
              58,
            fontWeight:
              800,
            lineHeight:
              1.1,
            maxWidth:
              1250,
            letterSpacing:
              -2,
          }}
        >
          {truncate(
            safeText(
              post.title,
              "Featured article",
            ),
            80,
          )}
        </div>

        {post.date && (
          <div
            style={{
              marginTop:
                20,
              fontSize:
                19,
              opacity:
                0.55,
            }}
          >
            {post.date}
          </div>
        )}

        {post.excerpt && (
          <div
            style={{
              marginTop:
                28,
              fontSize:
                24,
              lineHeight:
                1.45,
              opacity:
                0.72,
              maxWidth:
                1050,
            }}
          >
            {truncate(
              post.excerpt,
              180,
            )}
          </div>
        )}

        <div
          style={{
            marginTop:
              42,
            fontSize:
              19,
            letterSpacing:
              1,
            opacity:
              0.65,
          }}
        >
          READ THE FULL ARTICLE →
        </div>
      </div>
    </AbsoluteFill>
  );
};

/*
 * ------------------------------------------------------------
 * Scene 6
 * ------------------------------------------------------------
 */

const OutroScene: React.FC<{
  data: BlogData;
}> = ({
  data,
}) => {
  const frame =
    useCurrentFrame();

  const opacity =
    fadeIn(frame, 0, 15);

  const y =
    interpolate(
      frame,
      [0, 45],
      [35, 0],
      clamp,
    );

  return (
    <AbsoluteFill
      style={{
        background:
          "#0b0b0b",
        opacity,
        alignItems:
          "center",
        justifyContent:
          "center",
        transform:
          `translateY(${y}px)`,
        textAlign:
          "center",
        padding:
          80,
      }}
    >
      <div
        style={{
          fontSize:
            26,
          letterSpacing:
            7,
          textTransform:
            "uppercase",
          opacity:
            0.55,
          marginBottom:
            28,
        }}
      >
        KEEP EXPLORING
      </div>

      <div
        style={{
          fontSize:
            72,
          fontWeight:
            800,
          lineHeight:
            1.05,
          maxWidth:
            1300,
        }}
      >
        {truncate(
          safeText(
            data.siteTitle,
            "Your next story starts here.",
          ),
          50,
        )}
      </div>

      <div
        style={{
          marginTop:
            32,
          fontSize:
            24,
          opacity:
            0.65,
          maxWidth:
            1000,
        }}
      >
        Visit the blog and discover
        something new.
      </div>

      <div
        style={{
          marginTop:
            45,
          padding:
            "18px 34px",
          border:
            "1px solid rgba(255,255,255,0.35)",
          borderRadius:
            999,
          fontSize:
            20,
          letterSpacing:
            1,
        }}
      >
        VISIT BLOG
      </div>
    </AbsoluteFill>
  );
};
```
