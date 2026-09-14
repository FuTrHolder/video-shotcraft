import { log, warn } from "./logger.mjs";

import {
  normalizeWhitespace,
  decodeHtml,
  decodeEscapedUrl,
  escapeRegExp,
  absoluteUrl,
} from "./utils.mjs";

import {
  parseAttributes,
  stripHtml,
} from "./html.mjs";

import {
  addCandidate,
  extractImageCandidatesFromHtml,
} from "./candidates.mjs";

/* -------------------------------------------------------------------------- */
/* Feed tag helpers                                                           */
/* -------------------------------------------------------------------------- */

function extractTagRaw(
  xml,
  tagName
) {
  const escapedTag =
    escapeRegExp(tagName);

  const regex =
    new RegExp(
      `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`,
      "i"
    );

  const match =
    xml.match(regex);

  return match
    ? match[1]
    : "";
}

function extractTagText(
  xml,
  tagName
) {
  const raw =
    extractTagRaw(
      xml,
      tagName
    );

  return raw
    ? normalizeWhitespace(
        stripHtml(raw)
      )
    : "";
}

/* -------------------------------------------------------------------------- */
/* Feed entry extraction                                                      */
/* -------------------------------------------------------------------------- */

function extractFeedEntries(
  feedXml
) {
  const entries = [];

  if (!feedXml) {
    return entries;
  }

  const isRss =
    /<rss\b/i.test(feedXml) ||
    /<channel\b/i.test(feedXml);

  const tagName =
    isRss
      ? "item"
      : "entry";

  const entryRegex =
    new RegExp(
      `<${tagName}\\b[\\s\\S]*?<\\/${tagName}\\s*>`,
      "gi"
    );

  let entryMatch;

  while (
    (entryMatch =
      entryRegex.exec(
        feedXml
      ))
  ) {
    const entry =
      entryMatch[0];

    const title =
      extractTagText(
        entry,
        "title"
      );

    if (!title) {
      continue;
    }

    const published =
      extractTagText(
        entry,
        isRss
          ? "pubDate"
          : "published"
      ) ||
      extractTagText(
        entry,
        "updated"
      );

    const summary =
      extractTagRaw(
        entry,
        "summary"
      ) ||
      extractTagRaw(
        entry,
        "description"
      );

    const content =
      extractTagRaw(
        entry,
        "content"
      ) ||
      extractTagRaw(
        entry,
        "content:encoded"
      ) ||
      extractTagRaw(
        entry,
        "description"
      );

    /* ---------------------------------------------------------------------- */
    /* Links                                                                   */
    /* ---------------------------------------------------------------------- */

    const links = [];

    const linkRegex =
      /<link\b[^>]*>/gi;

    let linkMatch;

    while (
      (linkMatch =
        linkRegex.exec(
          entry
        ))
    ) {
      const attrs =
        parseAttributes(
          linkMatch[0]
        );

      if (!attrs.href) {
        continue;
      }

      links.push({
        rel:
          attrs.rel || "",
        type:
          attrs.type || "",
        href:
          absoluteUrl(
            attrs.href
          ),
      });
    }

    /*
     * RSS <link> is text content.
     */
    const rssLink =
      extractTagText(
        entry,
        "link"
      );

    if (
      rssLink &&
      !links.some(
        (link) =>
          link.href ===
          absoluteUrl(
            rssLink
          )
      )
    ) {
      links.push({
        rel: "alternate",
        type: "text/html",
        href:
          absoluteUrl(
            rssLink
          ),
      });
    }

    const alternate =
      links.find(
        (link) =>
          String(link.rel)
            .toLowerCase() ===
          "alternate"
      )?.href ||
      links.find(
        (link) =>
          String(link.type)
            .toLowerCase()
            .includes(
              "text/html"
            )
      )?.href ||
      links.find(
        (link) =>
          link.href
      )?.href ||
      null;

    /* ---------------------------------------------------------------------- */
    /* Categories                                                              */
    /* ---------------------------------------------------------------------- */

    const categoryMatches = [];

    const categoryRegex =
      /<category\b[^>]*>/gi;

    let categoryMatch;

    while (
      (categoryMatch =
        categoryRegex.exec(
          entry
        ))
    ) {
      const attrs =
        parseAttributes(
          categoryMatch[0]
        );

      if (attrs.term) {
        categoryMatches.push(
          attrs.term
        );
      }
    }

    /*
     * RSS categories may use element text.
     */
    const rssCategoryRegex =
      /<category\b[^>]*>([\s\S]*?)<\/category\s*>/gi;

    let rssCategoryMatch;

    while (
      (rssCategoryMatch =
        rssCategoryRegex.exec(
          entry
        ))
    ) {
      const category =
        normalizeWhitespace(
          stripHtml(
            rssCategoryMatch[1]
          )
        );

      if (
        category &&
        !categoryMatches.includes(
          category
        )
      ) {
        categoryMatches.push(
          category
        );
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Feed images                                                             */
    /* ---------------------------------------------------------------------- */

    /*
     * Feed images are extracted ONLY from actual
     * image references in THIS feed entry.
     *
     * Arbitrary href values are never treated
     * as feed images.
     */
    const decodedContent =
      decodeHtml(content);

    const decodedSummary =
      decodeHtml(summary);

    const feedCandidates = [
      ...extractImageCandidatesFromHtml(
        decodedContent,
        {
          source:
            "feed-content",
        }
      ),

      ...extractImageCandidatesFromHtml(
        decodedSummary,
        {
          source:
            "feed-summary",
        }
      ),
    ];

    /* ---------------------------------------------------------------------- */
    /* Atom media namespace                                                    */
    /* ---------------------------------------------------------------------- */

    /*
     * Blogger may expose the article thumbnail directly as:
     *
     * <media:thumbnail ...>
     * <media:content ...>
     */
    const mediaRegex =
      /<media:(?:content|thumbnail)\b[^>]*>/gi;

    let mediaMatch;

    while (
      (mediaMatch =
        mediaRegex.exec(
          entry
        ))
    ) {
      const attrs =
        parseAttributes(
          mediaMatch[0]
        );

      const mediaUrl =
        attrs.url ||
        attrs.src ||
        attrs.href ||
        "";

      if (mediaUrl) {
        addCandidate(
          feedCandidates,
          mediaUrl,
          "feed-content",
          900,
          {
            attribute:
              "media:url",

            association:
              "feed-content",
          }
        );
      }
    }

    /*
     * Every candidate from this feed entry is explicitly
     * marked as belonging to this feed entry.
     */
    for (
      const candidate of
        feedCandidates
    ) {
      candidate.association =
        "feed-content";
    }

    /* ---------------------------------------------------------------------- */
    /* Entry result                                                            */
    /* ---------------------------------------------------------------------- */

    entries.push({
      title:
        normalizeWhitespace(
          stripHtml(title)
        ),

      published,

      url:
        alternate,

      summary,

      content,

      categories:
        categoryMatches,

      imageCandidates:
        feedCandidates,
    });
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Candidate deduplication                                                    */
/* -------------------------------------------------------------------------- */

function dedupeCandidates(
  candidates
) {
  const map = new Map();

  for (
    const candidate of
      candidates || []
  ) {
    const key =
      candidate.url;

    const existing =
      map.get(key);

    if (
      !existing ||
      candidate.score >
        existing.score
    ) {
      map.set(
        key,
        candidate
      );
    }
  }

  return [
    ...map.values(),
  ].sort(
    (a, b) =>
      b.score - a.score
  );
}

export {
  extractFeedEntries,
  dedupeCandidates,
};
