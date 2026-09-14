import fs from "node:fs";
import { execFileSync } from "node:child_process";

import {
  MIN_FILE_SIZE,
  MIN_WIDTH,
  MIN_HEIGHT,
} from "./config.mjs";

import {
  log,
} from "./logger.mjs";

/* -------------------------------------------------------------------------- */
/* ImageMagick detection                                                      */
/* -------------------------------------------------------------------------- */

function detectImageMagick() {
  /*
   * Prefer the classic ImageMagick commands:
   *
   *   identify
   *   convert
   *
   * GitHub Ubuntu runners may expose ImageMagick 6 where
   * "magick identify ..." is interpreted incorrectly.
   */

  try {
    execFileSync(
      "identify",
      ["-version"],
      {
        stdio: "ignore",
      }
    );

    execFileSync(
      "convert",
      ["-version"],
      {
        stdio: "ignore",
      }
    );

    return {
      identifyCommand: "identify",
      convertCommand: "convert",
    };
  } catch {
    /*
     * Fallback for ImageMagick 7 environments where
     * the "magick" executable is available.
     */

    try {
      execFileSync(
        "magick",
        ["-version"],
        {
          stdio: "ignore",
        }
      );

      /*
       * IMPORTANT:
       *
       * Do not assume that "magick identify" works.
       * Verify it explicitly.
       */

      execFileSync(
        "magick",
        [
          "identify",
          "-version",
        ],
        {
          stdio: "ignore",
        }
      );

      return {
        identifyCommand: "magick-identify",
        convertCommand: "magick",
      };
    } catch {
      throw new Error(
        "ImageMagick was not found or its identify command could not be executed."
      );
    }
  }
}

const imageMagick =
  detectImageMagick();

log(
  `ImageMagick identify command: ${imageMagick.identifyCommand}`
);

log(
  `ImageMagick convert command: ${imageMagick.convertCommand}`
);

/* -------------------------------------------------------------------------- */
/* Magic bytes                                                                */
/* -------------------------------------------------------------------------- */

function magicBytesType(buffer) {
  if (
    !buffer ||
    buffer.length < 12
  ) {
    return null;
  }

  /*
   * JPEG
   */

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  /*
   * PNG
   */

  if (
    buffer[0] === 0x89 &&
    buffer.toString(
      "ascii",
      1,
      4
    ) === "PNG"
  ) {
    return "png";
  }

  /*
   * GIF
   */

  if (
    buffer.toString(
      "ascii",
      0,
      6
    ) === "GIF87a" ||
    buffer.toString(
      "ascii",
      0,
      6
    ) === "GIF89a"
  ) {
    return "gif";
  }

  /*
   * WEBP
   */

  if (
    buffer.toString(
      "ascii",
      0,
      4
    ) === "RIFF" &&
    buffer.toString(
      "ascii",
      8,
      12
    ) === "WEBP"
  ) {
    return "webp";
  }

  /*
   * AVIF / HEIF
   */

  if (
    buffer.toString(
      "ascii",
      4,
      8
    ) === "ftyp"
  ) {
    const brand =
      buffer
        .toString(
          "ascii",
          8,
          16
        )
        .toLowerCase();

    if (
      brand.includes("avif") ||
      brand.includes("avis") ||
      brand.includes("heic") ||
      brand.includes("heix") ||
      brand.includes("mif1")
    ) {
      return "avif";
    }
  }

  /*
   * SVG
   */

  const beginning =
    buffer
      .toString(
        "utf8",
        0,
        Math.min(
          buffer.length,
          1000
        )
      )
      .trim()
      .toLowerCase();

  if (
    beginning.startsWith(
      "<svg"
    ) ||
    (
      beginning.startsWith(
        "<?xml"
      ) &&
      beginning.includes(
        "<svg"
      )
    )
  ) {
    return "svg";
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Image validation                                                           */
/* -------------------------------------------------------------------------- */

function validateImageFile(
  filePath
) {
  if (
    !fs.existsSync(
      filePath
    )
  ) {
    return {
      valid: false,
      reason:
        "file-not-found",
    };
  }

  const stat =
    fs.statSync(
      filePath
    );

  if (
    stat.size <
    MIN_FILE_SIZE
  ) {
    return {
      valid: false,
      reason:
        `file-too-small:${stat.size}`,
    };
  }

  const buffer =
    fs.readFileSync(
      filePath
    );

  const magicType =
    magicBytesType(
      buffer
    );

  if (!magicType) {
    return {
      valid: false,
      reason:
        "invalid-image-magic-bytes",
    };
  }

  let output;

  try {
    if (
      imageMagick.identifyCommand ===
      "identify"
    ) {
      /*
       * ImageMagick 6 / standard identify
       */

      output =
        execFileSync(
          "identify",
          [
            "-format",
            "%m|%w|%h",
            filePath,
          ],
          {
            encoding:
              "utf8",

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        ).trim();
    } else {
      /*
       * ImageMagick 7
       */

      output =
        execFileSync(
          "magick",
          [
            "identify",
            "-format",
            "%m|%w|%h",
            filePath,
          ],
          {
            encoding:
              "utf8",

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        ).trim();
    }

    const [
      format,
      widthText,
      heightText,
    ] =
      output.split("|");

    const width =
      Number(widthText);

    const height =
      Number(heightText);

    if (
      !Number.isFinite(
        width
      ) ||
      !Number.isFinite(
        height
      )
    ) {
      return {
        valid: false,
        reason:
          "invalid-image-dimensions",
      };
    }

    if (
      width < MIN_WIDTH ||
      height < MIN_HEIGHT
    ) {
      return {
        valid: false,
        reason:
          `image-too-small:${width}x${height}`,
      };
    }

    return {
      valid: true,

      magicType,

      format,

      width,

      height,

      size:
        stat.size,
    };
  } catch (error) {
    return {
      valid: false,
      reason:
        `imagemagick-validation-failed:${error.message}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Perceptual fingerprint                                                     */
/* -------------------------------------------------------------------------- */

function perceptualFingerprint(
  filePath
) {
  try {
    const args = [
      filePath,
      "-resize",
      "16x16!",
      "-colorspace",
      "Gray",
      "-depth",
      "8",
      "txt:-",
    ];

    let output;

    if (
      imageMagick.convertCommand ===
      "convert"
    ) {
      output =
        execFileSync(
          "convert",
          args,
          {
            encoding:
              "utf8",

            maxBuffer:
              10 * 1024 * 1024,
          }
        );
    } else {
      output =
        execFileSync(
          "magick",
          args,
          {
            encoding:
              "utf8",

            maxBuffer:
              10 * 1024 * 1024,
          }
        );
    }

    const values = [];

    for (
      const line of
        output.split("\n")
    ) {
      const match =
        line.match(
          /gray\((\d+)\)/i
        );

      if (match) {
        values.push(
          Number(
            match[1]
          )
        );
      }
    }

    if (!values.length) {
      return null;
    }

    const average =
      values.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
      values.length;

    return values
      .map(
        (value) =>
          value >= average
            ? "1"
            : "0"
      )
      .join("");
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Hamming distance                                                           */
/* -------------------------------------------------------------------------- */

function hammingDistance(
  a,
  b
) {
  if (
    !a ||
    !b ||
    a.length !==
      b.length
  ) {
    return Infinity;
  }

  let distance = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    if (
      a[i] !== b[i]
    ) {
      distance++;
    }
  }

  return distance;
}

export {
  validateImageFile,
  perceptualFingerprint,
  hammingDistance,
  detectImageMagick,
  magicBytesType,
};