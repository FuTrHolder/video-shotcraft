import React from "react";
import { Composition } from "remotion";
import { BlogPromo, BLOG_PROMO_DURATION } from "./blog/BlogPromo";

export const BlogRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BlogPromo"
        component={BlogPromo}
        durationInFrames={BLOG_PROMO_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
