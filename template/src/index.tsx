import React from "react";
import { registerRoot } from "remotion";
import { Root } from "./Root";
import { BlogRoot } from "./BlogRoot";

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Root />
      <BlogRoot />
    </>
  );
};

registerRoot(RemotionRoot);
