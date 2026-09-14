import { execFileSync } from "node:child_process";

import {
  BLOG_URL,
  USER_AGENT,
  FETCH_TIMEOUT,
  IMAGE_FETCH_TIMEOUT,
  IMAGE_MAX_RETRIES,
  CURL_MAX_BYTES,
} from "./config.mjs";

import { sleep } from "./utils.mjs";
import { log, warn } from "./logger.mjs";

async function fetchText(url, options = {}) {
  const maxRetries = options.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();

      const timer = setTimeout(() => {
        controller.abort();
      }, FETCH_TIMEOUT);

      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: BLOG_URL,
        },
      });

      clearTimeout(timer);

      if (response.ok) {
        return await response.text();
      }

      if (
        (response.status === 429 ||
          response.status === 408 ||
          response.status >= 500) &&
        attempt < maxRetries
      ) {
        const delay = 1500 * Math.pow(2, attempt);

        warn(
          `HTTP ${response.status} for ${url}. ` +
            `Retrying in ${delay}ms...`
        );

        await sleep(delay);
        continue;
      }

      throw new Error(
        `HTTP ${response.status} ${response.statusText}`
      );
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      const delay = 1500 * Math.pow(2, attempt);

      warn(
        `Fetch failed: ${url}\n` +
          `Reason: ${error.message}\n` +
          `Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  throw new Error(`Unable to fetch ${url}`);
}

async function fetchBinary(url) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= IMAGE_MAX_RETRIES;
    attempt++
  ) {
    let timer = null;

    try {
      const controller = new AbortController();

      timer = setTimeout(() => {
        controller.abort();
      }, IMAGE_FETCH_TIMEOUT);

      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Connection: "keep-alive",
        },
      });

      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());

        if (!bytes.length) {
          throw new Error(
            "HTTP 200 but response body was empty"
          );
        }

        log(
          `  Image download succeeded via Node fetch ` +
            `(attempt ${attempt}/${IMAGE_MAX_RETRIES}, ` +
            `${bytes.length} bytes, HTTP ${response.status}, ` +
            `Content-Type=${response.headers.get("content-type") || "unknown"})`
        );

        return {
          bytes,
          contentType:
            response.headers.get("content-type") || "",
          finalUrl: response.url || url,
          method: "node-fetch",
        };
      }

      const status = response.status;
      const statusText = response.statusText || "";

      lastError = new Error(
        `HTTP ${status} ${statusText}`.trim()
      );

      warn(
        `  Image download attempt ${attempt}/${IMAGE_MAX_RETRIES} ` +
          `returned HTTP ${status} for ${url}`
      );

      if (
        !(
          status === 408 ||
          status === 425 ||
          status === 429 ||
          status >= 500
        )
      ) {
        break;
      }
    } catch (error) {
      lastError = error;

      warn(
        `  Image download attempt ${attempt}/${IMAGE_MAX_RETRIES} failed.`
      );
      warn(`    URL: ${url}`);
      warn(`    Error: ${error?.message || error}`);
      warn(`    Name: ${error?.name || "unknown"}`);

      if (error?.cause) {
        warn(
          `    Cause: ${error.cause.code || "unknown"} ` +
            `${error.cause.message || ""}`.trim()
        );
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    if (attempt < IMAGE_MAX_RETRIES) {
      const delay = Math.min(
        8000,
        1000 * 2 ** (attempt - 1)
      );

      warn(`    Retrying in ${delay}ms...`);

      await sleep(delay);
    }
  }

  try {
    execFileSync("curl", ["--version"], {
      stdio: "ignore",
      timeout: 5000,
    });

    log(
      "  Node image fetch failed; trying curl fallback..."
    );

    const curlArgs = [
      "--location",
      "--fail",
      "--silent",
      "--show-error",
      "--compressed",
      "--max-time",
      String(
        Math.ceil(
          IMAGE_FETCH_TIMEOUT / 1000
        )
      ),
      "--connect-timeout",
      "20",
      "--retry",
      "2",
      "--retry-delay",
      "2",
      "--retry-all-errors",
      "-A",
      USER_AGENT,
      "-H",
      "Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "-H",
      `Referer: ${BLOG_URL}`,
      url,
    ];

    const bytes = execFileSync(
      "curl",
      curlArgs,
      {
        encoding: "buffer",
        maxBuffer: CURL_MAX_BYTES,
        timeout:
          IMAGE_FETCH_TIMEOUT + 10000,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      }
    );

    if (!bytes || !bytes.length) {
      throw new Error(
        "curl returned an empty response body"
      );
    }

    log(
      `  Image download succeeded via curl ` +
        `(${bytes.length} bytes)`
    );

    return {
      bytes: Buffer.from(bytes),
      contentType: "",
      finalUrl: url,
      method: "curl",
    };
  } catch (error) {
    const curlMessage =
      error?.stderr
        ?.toString?.("utf8")
        ?.trim() ||
      error?.message ||
      String(error);

    warn(
      `  curl fallback failed: ${curlMessage}`
    );

    const detail = lastError
      ? `${lastError.name || "Error"}: ${
          lastError.message || lastError
        }`
      : "no previous Node fetch error";

    if (
      /^(?:https?:\/\/)?(?:i\.)?ibb\.co\//i.test(
        url
      )
    ) {
      const proxyUrl =
        `https://wsrv.nl/?url=${encodeURIComponent(url)}`;

      try {
        log(
          "  Direct image download failed; trying image proxy..."
        );

        log(`    Proxy: ${proxyUrl}`);

        const controller =
          new AbortController();

        const timer = setTimeout(
          () => controller.abort(),
          IMAGE_FETCH_TIMEOUT
        );

        try {
          const response =
            await fetch(proxyUrl, {
              redirect: "follow",
              signal: controller.signal,
              headers: {
                "User-Agent":
                  USER_AGENT,
                Accept:
                  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language":
                  "en-US,en;q=0.9",
              },
            });

          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status} ${
                response.statusText || ""
              }`.trim()
            );
          }

          const bytes =
            Buffer.from(
              await response.arrayBuffer()
            );

          if (!bytes.length) {
            throw new Error(
              "Image proxy returned an empty response body"
            );
          }

          log(
            `  Image download succeeded via proxy ` +
              `(${bytes.length} bytes, HTTP ${response.status}, ` +
              `Content-Type=${
                response.headers.get(
                  "content-type"
                ) || "unknown"
              })`
          );

          return {
            bytes,
            contentType:
              response.headers.get(
                "content-type"
              ) || "",
            finalUrl:
              response.url ||
              proxyUrl,
            method: "image-proxy",
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (proxyError) {
        warn(
          `  Image proxy fallback failed: ${
            proxyError?.message ||
            proxyError
          }`
        );
      }
    }

    throw new Error(
      `Unable to download image. Node fetch: ${detail}. ` +
        `curl: ${curlMessage}`
    );
  }
}

export {
  fetchText,
  fetchBinary,
};
