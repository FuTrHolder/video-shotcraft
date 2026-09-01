import React from "react";
import {registerRoot} from "remotion";
import {Root} from "./Root";
import {BlogRoot} from "./BlogRoot";

const RootWithBlog: React.FC = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Root),
    React.createElement(BlogRoot),
  );

registerRoot(RootWithBlog);
