// controllers/videoDownloader.js
const axios = require("axios");
const cheerio = require("cheerio");
const querystring = require("querystring");

/** =========================
 *  Config (same semantics)
 *  ========================= */
const INSTAGRAM_CONFIGS = {
  enableWebpage: true, // Try og:video from HTML
  enableGraphQL: true, // Fallback to GraphQL
  enableServerAPI: true, // Route enabled
};

/** =========================
 *  Small helpers
 *  ========================= */
const getTimedFilename = (name, ext) => {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  return `${name}-${timeStamp}.${ext}`;
};

const getIGVideoFileName = () => getTimedFilename("ig-downloader", "mp4");

const sanitizeFilename = (name) =>
  String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 120);

/** Final URL helper for axios (after redirects) */
const getFinalURLFromAxiosResponse = (resp, fallback) => {
  // Different axios/node versions expose different props
  return (
    resp?.request?.res?.responseUrl ||
    resp?.request?._redirectable?._currentUrl ||
    resp?.request?.path ||
    fallback
  );
};

/** =========================
 *  URL → shortcode/id
 *  ========================= */
const fetchReelIdFromShareURL = async (shareUrl) => {
  const resp = await axios.get(shareUrl, {
    maxRedirects: 5,
    validateStatus: () => true, // allow 3xx
  });

  const finalUrl = getFinalURLFromAxiosResponse(resp, shareUrl) || shareUrl;
  const match = String(finalUrl).match(/reel\/([a-zA-Z0-9_-]+)/);
  if (!match || !match[1]) {
    throw new Error("Reel ID not found in URL");
  }
  return match[1];
};

const getPostIdFromUrl = async (postUrl) => {
  const shareRegex =
    /^https:\/\/(?:www\.)?instagram\.com\/share\/([a-zA-Z0-9_-]+)\/?/;
  const postRegex =
    /^https:\/\/(?:www\.)?instagram\.com\/p\/([a-zA-Z0-9_-]+)\/?/;
  const reelRegex =
    /^https:\/\/(?:www\.)?instagram\.com\/reels?\/([a-zA-Z0-9_-]+)\/?/;

  if (shareRegex.test(postUrl)) {
    // resolve share → reel
    return fetchReelIdFromShareURL(postUrl);
  }

  const postMatch = postUrl.match(postRegex);
  if (postMatch?.[1]) return postMatch[1];

  const reelMatch = postUrl.match(reelRegex);
  if (reelMatch?.[1]) return reelMatch[1];

  throw new Error("Unable to extract ID");
};

/** =========================
 *  GraphQL payload (same as your code)
 *  ========================= */
const encodeGraphqlRequestData = (shortcode) => {
  const requestData = {
    av: "0",
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "3",
    __hs: "19624.HYP:instagram_web_pkg.2.1..0.0",
    dpr: "3",
    __ccg: "UNKNOWN",
    __rev: "1008824440",
    __s: "xf44ne:zhh75g:xr51e7",
    __hsi: "7282217488877343271",
    __dyn:
      "7xeUmwlEnwn8K2WnFw9-2i5U4e0yoW3q32360CEbo1nEhw2nVE4W0om78b87C0yE5ufz81s8hwGwQwoEcE7O2l0Fwqo31w9a9x-0z8-U2zxe2GewGwso88cobEaU2eUlwhEe87q7-0iK2S3qazo7u1xwIw8O321LwTwKG1pg661pwr86C1mwraCg",
    __csr:
      "gZ3yFmJkillQvV6ybimnG8AmhqujGbLADgjyEOWz49z9XDlAXBJpC7Wy-vQTSvUGWGh5u8KibG44dBiigrgjDxGjU0150Q0848azk48N09C02IR0go4SaR70r8owyg9pU0V23hwiA0LQczA48S0f-x-27o05NG0fkw",
    __comet_req: "7",
    lsd: "AVqbxe3J_YA",
    jazoest: "2957",
    __spin_r: "1008824440",
    __spin_b: "trunk",
    __spin_t: "1695523385",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisPostActionLoadPostQueryQuery",
    variables: JSON.stringify({
      shortcode: shortcode,
      fetch_comment_count: "null",
      fetch_related_profile_media_count: "null",
      parent_comment_count: "null",
      child_comment_count: "null",
      fetch_like_count: "null",
      fetch_tagged_user_count: "null",
      fetch_preview_comment_count: "null",
      has_threaded_comments: "false",
      hoisted_comment_id: "null",
      hoisted_reply_id: "null",
    }),
    server_timestamps: "true",
    doc_id: "10015901848480474",
  };

  return querystring.stringify(requestData);
};

/** =========================
 *  Instagram fetchers
 *  ========================= */
const getVideoJsonFromHTML = async (postId) => {
  const url = `https://www.instagram.com/p/${postId}`;
  const res = await axios.get(url, {
    headers: {
      accept: "*/*",
      host: "www.instagram.com",
      referer: "https://www.instagram.com/",
      DNT: "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0",
    },
    responseType: "text",
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) return null;

  const $ = cheerio.load(res.data);
  const el = $("meta[property='og:video']");
  if (el.length === 0) return null;

  const videoUrl = el.attr("content");
  if (!videoUrl) return null;

  const width = $("meta[property='og:video:width']").attr("content") ?? "";
  const height = $("meta[property='og:video:height']").attr("content") ?? "";

  return {
    filename: getIGVideoFileName(),
    width,
    height,
    videoUrl,
  };
};

const getVideoJSONFromGraphQL = async (postId) => {
  const body = encodeGraphqlRequestData(postId);

  const res = await axios.post("https://www.instagram.com/api/graphql", body, {
    headers: {
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.5",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-FB-Friendly-Name": "PolarisPostActionLoadPostQueryQuery",
      "X-CSRFToken": "RVDUooU5MYsBbS1CNN3CzVAuEP8oHB52",
      "X-IG-App-ID": "1217981644879628",
      "X-FB-LSD": "AVqbxe3J_YA",
      "X-ASBD-ID": "129477",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/14.2 Chrome/87.0.4280.141 Mobile Safari/537.36",
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) return null;

  const data = res.data;
  const media = data?.data?.xdt_shortcode_media;
  if (!media) return null;
  if (!media.is_video) {
    const err = new Error("This post is not a video");
    err.status = 400;
    throw err;
  }

  return {
    filename: getIGVideoFileName(),
    width: String(media?.dimensions?.width ?? ""),
    height: String(media?.dimensions?.height ?? ""),
    videoUrl: media.video_url,
  };
};

/** =========================
 *  Resolver: choose HTML → GraphQL
 *  ========================= */
const resolveVideoInfo = async (postId) => {
  if (INSTAGRAM_CONFIGS.enableWebpage) {
    const viaHtml = await getVideoJsonFromHTML(postId);
    if (viaHtml?.videoUrl) return viaHtml;
  }
  if (INSTAGRAM_CONFIGS.enableGraphQL) {
    const viaGraph = await getVideoJSONFromGraphQL(postId);
    if (viaGraph?.videoUrl) return viaGraph;
  }
  const err = new Error("Video link for this post is not public.");
  err.status = 401;
  throw err;
};

/** =========================
 *  Controller (POST /insta/download)
 *  Body: { url: "<instagram_link>" }
 *  Streams the video file with Content-Disposition
 *  ========================= */
const videoDownloader = async (req, res) => {
  console.log("==== /insta/download START ====");
  try {
    if (!INSTAGRAM_CONFIGS.enableServerAPI) {
      return res
        .status(501)
        .json({ status: "error", message: "Not Implemented" });
    }

    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res
        .status(400)
        .json({ status: "error", message: "Post URL is required" });
    }

    // 1) Extract post/reel id
    const postId = await getPostIdFromUrl(url);
    if (!postId) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid Post URL" });
    }

    // 2) Resolve to { filename, videoUrl }
    const { filename, videoUrl } = await resolveVideoInfo(postId);

    // 3) Fetch the actual video as a stream and pipe to client
    const vidResp = await axios.get(videoUrl, {
      responseType: "stream",
      validateStatus: () => true,
    });

    if (vidResp.status < 200 || vidResp.status >= 300 || !vidResp.data) {
      return res.status(502).json({
        status: "error",
        message: "Failed to fetch the video for download.",
      });
    }

    const contentType = vidResp.headers["content-type"] || "video/mp4";
    const contentLength = vidResp.headers["content-length"];
    const safeName = sanitizeFilename(filename);

    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);

    vidResp.data.pipe(res);
    vidResp.data.on("error", (e) => {
      try {
        res.destroy(e);
      } catch {}
    });
  } catch (err) {
    console.error("Downloader error:", err);
    const status = err?.status || 500;
    const message =
      typeof err?.message === "string" ? err.message : "Internal Server Error";
    return res.status(status).json({ status: "error", message });
  }
};

module.exports = videoDownloader;
