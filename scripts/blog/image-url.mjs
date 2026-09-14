import {
  absoluteUrl,
  decodeEscapedUrl,
} from "./utils.mjs";

function isUnsplashPageUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "unsplash.com" ||
      parsed.hostname.endsWith(".unsplash.com")
    );
  } catch {
    return false;
  }
}

function isUnsplashImageUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname ===
        "images.unsplash.com" ||
      parsed.hostname ===
        "plus.unsplash.com"
    );
  } catch {
    return false;
  }
}

function isBloggerImageUrl(url) {
  try {
    const parsed = new URL(url);

    const hostname =
      parsed.hostname.toLowerCase();

    const pathname =
      parsed.pathname.toLowerCase();

    if (
      hostname ===
        "blogger.googleusercontent.com" &&
      pathname.includes("/img/")
    ) {
      return true;
    }

    if (
      hostname === "bp.blogspot.com" ||
      hostname.endsWith(
        ".bp.blogspot.com"
      )
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isLikelyImageUrl(url) {
  if (!url) return false;

  const value =
    decodeEscapedUrl(url);

  if (isUnsplashPageUrl(value)) {
    return false;
  }

  if (value.startsWith("data:")) {
    return false;
  }

  if (
    value.startsWith("javascript:") ||
    value.startsWith("mailto:") ||
    value.startsWith("#")
  ) {
    return false;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (
    !/^https?:$/i.test(
      parsed.protocol
    )
  ) {
    return false;
  }

  if (
    isBloggerImageUrl(value)
  ) {
    return true;
  }

  if (
    isUnsplashImageUrl(value)
  ) {
    return true;
  }

  const pathname =
    parsed.pathname.toLowerCase();

  if (
    /\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?)$/i.test(
      pathname
    )
  ) {
    return true;
  }

  if (
    parsed.hostname.includes(
      "cloudinary.com"
    ) ||
    parsed.hostname.includes(
      "images."
    ) ||
    parsed.hostname.includes(
      "image."
    ) ||
    parsed.hostname.includes(
      "img."
    )
  ) {
    return true;
  }

  return false;
}

function normalizeBloggerImageUrl(url) {
  if (!url) return null;

  const value =
    decodeEscapedUrl(url);

  if (!isBloggerImageUrl(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);

    parsed.pathname =
      parsed.pathname
        .replace(
          /\/s\d+(?:-[a-z0-9]+)?\//i,
          "/s1600/"
        )
        .replace(
          /\/w\d+(?:-h\d+)?\//i,
          "/s1600/"
        )
        .replace(
          /\/h\d+(?:-w\d+)?\//i,
          "/s1600/"
        );

    return parsed.href;
  } catch {
    return null;
  }
}

export {
  isUnsplashPageUrl,
  isUnsplashImageUrl,
  isBloggerImageUrl,
  isLikelyImageUrl,
  normalizeBloggerImageUrl,
};
