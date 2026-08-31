import { registerRoot } from "remotion";
import { Root } from "./Root";
import { BlogRoot } from "./BlogRoot";

const RootWithBlog: React.FC = () => {
  return (
    <>
      <Root />
      <BlogRoot />
    </>
  );
};

registerRoot(RootWithBlog);
