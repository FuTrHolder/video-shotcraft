import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { log, warn } from "./logger.mjs";
import { OUTPUT_DIR } from "./config.mjs";
import { fetchBinary } from "./fetch.mjs";

import {
  isUnsplashPageUrl,
  isLikelyImageUrl,
} from "./image-url.mjs";

import {
  magicBytesType,
  validateImageFile,
  perceptualFingerprint,
  hammingDistance,
} from "./image-validate.mjs";

async function downloadAndValidateCandidate(
  candidate,
  index,
  usedHashes,
  usedFingerprints
) {
  log(
    `  Candidate score=${candidate.score} ` +
      `source=${candidate.source} ` +
      `association=${candidate.association || "unknown"}`
  );

  log(
    `  ${candidate.url}`
  );

  const allowedAssociations =
    new Set([
      "article-og",
      "article-twitter",
      "article-meta",
      "article-body",
      "feed-content",
    ]);

  if (
    !candidate.association ||
    !allowedAssociations.has(
      candidate.association
    )
  ) {
    warn(
      "  Rejected: image is not article-specific."
    );

    return null;
  }

  if (
    isUnsplashPageUrl(
      candidate.url
    )
  ) {
    warn(
      "  Rejected: Unsplash page URL, not image URL."
    );

    return null;
  }

  if (
    !isLikelyImageUrl(
      candidate.url
    )
  ) {
    warn(
      "  Rejected: URL does not look like an image."
    );

    return null;
  }

  let downloaded;

  try {
    downloaded =
      await fetchBinary(
        candidate.url
      );
  } catch (error) {
    warn(
      `  Download failed: ${error.message}`
    );

    return null;
  }

  const extension =
    magicBytesType(
      downloaded.bytes
    ) || "img";

  const filename =
    `post-${String(index).padStart(2, "0")}.${extension}`;

  const filePath =
    path.join(
      OUTPUT_DIR,
      filename
    );

  fs.writeFileSync(
    filePath,
    downloaded.bytes
  );

  const validation =
    validateImageFile(
      filePath
    );

  if (
    !validation.valid
  ) {
    warn(
      `  Rejected: ${validation.reason}`
    );

    try {
      fs.unlinkSync(
        filePath
      );
    } catch {}

    return null;
  }

  const sha256 =
    crypto
      .createHash("sha256")
      .update(
        downloaded.bytes
      )
      .digest("hex");

  if (
    usedHashes.has(
      sha256
    )
  ) {
    warn(
      "  Rejected: exact duplicate image."
    );

    try {
      fs.unlinkSync(
        filePath
      );
    } catch {}

    return null;
  }

  const fingerprint =
    perceptualFingerprint(
      filePath
    );

  if (fingerprint) {
    for (
      const previous of
        usedFingerprints
    ) {
      const distance =
        hammingDistance(
          fingerprint,
          previous.fingerprint
        );

      if (
        distance <= 8
      ) {
        warn(
          `  Rejected: perceptual duplicate. distance=${distance}`
        );

        try {
          fs.unlinkSync(
            filePath
          );
        } catch {}

        return null;
      }
    }
  }

  usedHashes.add(
    sha256
  );

  if (fingerprint) {
    usedFingerprints.push({
      fingerprint,
      url: candidate.url,
    });
  }

  log(
    `  Accepted: ${validation.width}x${validation.height}, ` +
      `${validation.size} bytes`
  );

  return {
    localImage:
      path
        .relative(
          path.resolve(
            process.cwd(),
            "template/public"
          ),
          filePath
        )
        .split(path.sep)
        .join("/"),

    imageUrl:
      candidate.url,

    imageSource:
      candidate.source,

    imageAssociation:
      candidate.association,

    imageReason:
      candidate.reason ||
      null,

    sha256,

    perceptualFingerprint:
      fingerprint,

    width:
      validation.width,

    height:
      validation.height,

    bytes:
      validation.size,
  };
}

export {
  downloadAndValidateCandidate,
};
