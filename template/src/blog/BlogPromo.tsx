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
export const BLOG_PROMO_DURATION = BLOG_PROMO_FPS * BLOG_PROMO_SECONDS;

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

const safe = (v?: string, fallback = "") => {
  const t = String(v || "").trim();
  return t || fallback;
};

const truncate = (v: string | undefined, n: number) => {
  const t = safe(v);
  return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1))}…`;
};

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const fade = (frame: number, end: number, inFrames = 14, outFrames = 14) =>
  interpolate(
    frame,
    [0, inFrames, Math.max(inFrames, end - outFrames), end],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

const enter = (frame: number, distance = 34, duration = 16) =>
  interpolate(frame, [0, duration], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const loadBlogData = async (): Promise<BlogData> => {
  const response = await fetch(staticFile("blog/blog.json"));
  if (!response.ok) {
    throw new Error(`Unable to load blog/blog.json (${response.status})`);
  }
  return response.json();
};

const imageSource = (post: BlogPost) =>
  post.localImage ? staticFile(post.localImage) : undefined;

const Base: React.FC = () => (
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
        backgroundSize: "80px 80px",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 7,
        height: "100%",
        background: C.accent,
      }}
    />
  </>
);

const IdentityScene: React.FC<{ data: BlogData; analysis: BlogAnalysis }> = ({
  data,
  analysis,
}) => {
  const f = useCurrentFrame();
  const o = fade(f, 90);
  const y = enter(f, 48);
  const topic = safe(analysis.topics?.[0], "INSIGHTS").toUpperCase();
  const identity = safe(
    analysis.identity,
    safe(data.description, `${data.siteTitle} delivers useful insights and analysis.`),
  );

  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Base />
      <div
        style={{
          position: "absolute",
          left: 130,
          right: 130,
          top: 100,
          bottom: 80,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `translateY(${y}px)`,
        }}
      >
        <div style={{ fontSize: 18, letterSpacing: 7, fontWeight: 800, color: C.accent }}>
          {topic}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 94,
            lineHeight: 0.96,
            fontWeight: 900,
            letterSpacing: -4,
          }}
        >
          {truncate(data.siteTitle, 42)}
        </div>
        <div style={{ marginTop: 30, width: 100, height: 4, background: C.white }} />
        <div
          style={{
            marginTop: 24,
            maxWidth: 1250,
            fontSize: 29,
            lineHeight: 1.4,
            color: C.muted,
          }}
        >
          {truncate(identity, 175)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TopicsScene: React.FC<{ topics: string[]; analysis: BlogAnalysis }> = ({
  topics,
  analysis,
}) => {
  const f = useCurrentFrame();
  const o = fade(f, 90);
  const y = enter(f, 40);

  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Base />
      <div
        style={{
          position: "absolute",
          left: 130,
          right: 130,
          top: 110,
          bottom: 100,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `translateY(${y}px)`,
        }}
      >
        <div style={{ fontSize: 17, letterSpacing: 6, color: C.accent, fontWeight: 800 }}>
          WHAT YOU'LL FIND
        </div>
        <div style={{ marginTop: 20, fontSize: 68, fontWeight: 900, letterSpacing: -2 }}>
          Focused fields.
        </div>
        <div style={{ marginTop: 14, color: C.muted, fontSize: 24 }}>
          {truncate(analysis.contentStyle, 88)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 48 }}>
          {topics.map((topic, i) => {
            const io = interpolate(f, [10 + i * 7, 24 + i * 7], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const iy = interpolate(f, [10 + i * 7, 24 + i * 7], [18, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={topic}
                style={{
                  opacity: io,
                  transform: `translateY(${iy}px)`,
                  padding: "18px 26px",
                  border: `1px solid ${C.line}`,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.045)",
                  fontSize: 24,
                  fontWeight: 750,
                }}
              >
                {topic}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 38, fontSize: 19, color: C.soft }}>
          {truncate(analysis.audience, 105)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PostScene: React.FC<{ post: BlogPost; index: number; total: number }> = ({
  post,
  index,
  total,
}) => {
  const f = useCurrentFrame();
  const o = fade(f, 72, 10, 10);
  const reverse = index % 2 === 1;
  const image = imageSource(post);
  const imageX = interpolate(f, [0, 18], [reverse ? -28 : 28, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textY = enter(f, 26, 16);
  const titleLength = safe(post.title).length;
  const titleSize = titleLength > 100 ? 46 : titleLength > 72 ? 52 : 60;
  const summary = truncate(post.excerpt, 105);
  const category = safe(post.categories?.[0]);
  const progress = ((index + 1) / Math.max(1, total)) * 100;

  const imagePanel = (
    <div
      style={{
        position: "absolute",
        ...(reverse ? { right: 90 } : { left: 90 }),
        top: 105,
        width: 1110,
        height: 820,
        borderRadius: 26,
        overflow: "hidden",
        background: C.panel,
        border: `1px solid ${C.line}`,
        boxShadow: "0 28px 70px rgba(0,0,0,0.42)",
        transform: `translateX(${imageX}px)`,
      }}
    >
      {image ? (
        <Img
          src={image}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            background: "#0b0f15",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 70,
            textAlign: "center",
            fontSize: 42,
            fontWeight: 850,
          }}
        >
          {truncate(post.title, 90)}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(0,0,0,0.20) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 26,
          top: 24,
          padding: "8px 12px",
          borderRadius: 999,
          background: "rgba(7,9,13,0.70)",
          border: `1px solid rgba(255,255,255,0.14)`,
          color: "rgba(255,255,255,0.82)",
          fontSize: 13,
          letterSpacing: 3,
          fontWeight: 800,
        }}
      >
        {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </div>
    </div>
  );

  const textPanel = (
    <div
      style={{
        position: "absolute",
        ...(reverse ? { left: 90 } : { right: 90 }),
        top: 135,
        width: 590,
        minHeight: 700,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        transform: `translateY(${textY}px)`,
      }}
    >
      <div
        style={{
          width: 52,
          height: 3,
          background: C.accent,
          marginBottom: 24,
        }}
      />
      {category && (
        <div style={{ fontSize: 15, letterSpacing: 4, fontWeight: 800, color: C.accent }}>
          {truncate(category, 28).toUpperCase()}
        </div>
      )}
      <div
        style={{
          marginTop: category ? 18 : 0,
          fontSize: titleSize,
          lineHeight: 1.04,
          fontWeight: 900,
          letterSpacing: -1.8,
          color: C.text,
          maxHeight: 196,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 3,
        }}
      >
        {post.title}
      </div>
      {summary && (
        <div
          style={{
            marginTop: 20,
            fontSize: 18,
            lineHeight: 1.4,
            color: C.muted,
            maxWidth: 560,
            maxHeight: 52,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {summary}
        </div>
      )}
      {post.date && (
        <div style={{ marginTop: 18, fontSize: 14, color: C.soft }}>
          {truncate(post.date, 28)}
        </div>
      )}
      <div style={{ marginTop: 30, width: 560, height: 3, background: C.line }}>
        <div style={{ width: `${progress}%`, height: "100%", background: C.accent }} />
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Base />
      {textPanel}
      {imagePanel}
    </AbsoluteFill>
  );
};

const ValueScene: React.FC<{
  data: BlogData;
  analysis: BlogAnalysis;
  topics: string[];
}> = ({ data, analysis, topics }) => {
  const f = useCurrentFrame();
  const o = fade(f, 90);
  const y = enter(f, 34);
  const shortValue = truncate(
    analysis.valueProposition,
    105,
  );

  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Base />
      <div
        style={{
          position: "absolute",
          left: 150,
          right: 150,
          top: 100,
          bottom: 100,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transform: `translateY(${y}px)`,
        }}
      >
        <div style={{ fontSize: 17, letterSpacing: 6, color: C.accent, fontWeight: 800 }}>
          WHY FOLLOW {safe(data.siteTitle).toUpperCase()}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 62,
            lineHeight: 1.06,
            fontWeight: 900,
            maxWidth: 1450,
          }}
        >
          {shortValue || "Timely ideas, useful context, and a clearer view of what matters."}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 40 }}>
          {topics.slice(0, 3).map((topic) => (
            <div
              key={topic}
              style={{
                padding: "12px 18px",
                border: `1px solid ${C.line}`,
                borderRadius: 999,
                color: C.muted,
                fontSize: 17,
                fontWeight: 700,
              }}
            >
              {topic}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CtaScene: React.FC<{ data: BlogData; analysis?: BlogAnalysis }> = ({
  data,
  analysis,
}) => {
  const f = useCurrentFrame();
  const o = fade(f, 90, 12, 10);
  const scale = interpolate(f, [0, 90], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const topics = (analysis?.topics || []).slice(0, 3).map((t) => t.toUpperCase());
  const topicLine = topics.length
    ? topics.join("  ·  ")
    : "INSIGHTS  ·  ANALYSIS  ·  TRENDS";
  const host = safe(data.hostname, safe(data.url).replace(/^https?:\/\//, "").replace(/\/.*$/, ""));

  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Base />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          transform: `scale(${scale})`,
        }}
      >
        <div style={{ fontSize: 17, letterSpacing: 7, color: C.accent, fontWeight: 850 }}>
          STAY CLOSE TO WHAT MATTERS
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 92,
            lineHeight: 0.98,
            fontWeight: 900,
            letterSpacing: -4,
          }}
        >
          {truncate(data.siteTitle, 42)}
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 25,
            fontWeight: 750,
            color: C.text,
            letterSpacing: 1.2,
          }}
        >
          {topicLine}
        </div>
        <div
          style={{
            marginTop: 34,
            padding: "18px 34px",
            borderRadius: 999,
            background: C.white,
            color: C.bg,
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: 0.5,
          }}
        >
          VISIT {truncate(host, 42).toUpperCase()}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const BlogPromo: React.FC = () => {
  const [data, setData] = React.useState<BlogData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadBlogData()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <AbsoluteFill
        style={{
          background: C.bg,
          color: C.white,
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div style={{ fontSize: 46, fontWeight: 800 }}>Blog data error</div>
        <div style={{ marginTop: 20, color: C.muted, fontSize: 22 }}>{error}</div>
      </AbsoluteFill>
    );
  }

  if (!data) {
    return (
      <AbsoluteFill
        style={{
          background: C.bg,
          color: C.white,
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 32,
        }}
      >
        Preparing blog story…
      </AbsoluteFill>
    );
  }

  const posts = (data.posts || []).slice(0, 5);
  const analysis = data.analysis || {};
  const topics = (analysis.topics || ["Insights", "Analysis", "Trends"])
    .filter(Boolean)
    .slice(0, 4);

  return (
    <AbsoluteFill
      style={{
        background: C.bg,
        color: C.white,
        fontFamily: "Arial, Helvetica, sans-serif",
        overflow: "hidden",
      }}
    >
      <Sequence from={0} durationInFrames={90}>
        <IdentityScene data={data} analysis={analysis} />
      </Sequence>
      <Sequence from={90} durationInFrames={90}>
        <TopicsScene topics={topics} analysis={analysis} />
      </Sequence>
      {posts.map((post, index) => (
        <Sequence
          key={post.url || post.title || `post-${index}`}
          from={180 + index * 72}
          durationInFrames={72}
        >
          <PostScene post={post} index={index} total={posts.length} />
        </Sequence>
      ))}
      <Sequence from={540} durationInFrames={90}>
        <ValueScene data={data} analysis={analysis} topics={topics} />
      </Sequence>
      <Sequence from={630} durationInFrames={90}>
        <CtaScene data={data} analysis={analysis} />
      </Sequence>
    </AbsoluteFill>
  );
};
