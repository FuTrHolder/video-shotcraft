import { BLOG_URL } from "./config.mjs";

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );
}

function normalizeComparableText(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .toLowerCase()
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#x3D;/gi, "=")
    .replace(/&#61;/gi, "=")
    .replace(/&nbsp;/gi, " ");
}

function decodeEscapedUrl(value) {
  let result = String(value || "");

  result = result
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/gi, "&");

  return decodeHtml(result).trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function absoluteUrl(url, base = BLOG_URL) {
  if (!url) return null;

  let value = decodeEscapedUrl(url)
    .replace(/^['"]+|['"]+$/g, "")
    .trim();

  if (!value) return null;

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export {
  normalizeWhitespace,
  normalizeText,
  normalizeComparableText,
  decodeHtml,
  decodeEscapedUrl,
  escapeRegExp,
  absoluteUrl,
  sleep,
};
