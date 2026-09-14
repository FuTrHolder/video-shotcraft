import {
  decodeHtml,
  decodeEscapedUrl,
} from "./utils.mjs";

function parseAttributes(tag) {
  const attributes = {};

  const attrRegex =
    /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

  let match;

  while (
    (match = attrRegex.exec(tag))
  ) {
    const name =
      match[1].toLowerCase();

    const value =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
        ? match[3]
        : match[4];

    attributes[name] =
      decodeEscapedUrl(value);
  }

  return attributes;
}

function stripHtml(value) {
  return decodeHtml(
    String(value || "")
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  );
}

function extractSrcsetUrls(value) {
  const urls = [];

  if (!value) return urls;

  const parts =
    String(value).split(",");

  for (const part of parts) {
    const trimmed = part.trim();

    if (!trimmed) continue;

    const url =
      trimmed.split(/\s+/)[0];

    if (url) {
      urls.push(url);
    }
  }

  return urls;
}

export {
  parseAttributes,
  stripHtml,
  extractSrcsetUrls,
};
