#!/usr/bin/env bun

// Curates a set of Facebook posts into JSON files consumable by the `socials`
// block. Each output file conforms to {url, date, title, thumbnail}.
//
// Downloads each curated post's thumbnail from the FB CDN on first run.
// URLs expire, so re-download only happens when the local file is missing.

import { join } from "node:path";
import { exists, fs, path, readJson, write } from "./utils.js";

const SOURCE = path("facebook-posts.json");
const POSTS_DIR = path("facebook-posts");
const FB_IMAGES_DIR = path("images", "facebook");

// Source post indices chosen for substantive, factual, or high-signal content.
const CURATED = [0, 4, 7, 15, 25, 29, 30, 37, 38, 42, 55, 57, 58, 64];

// Prefer the largest CDN variant FB gives us: for videos, `thumbnail` /
// `preferred_thumbnail` are rendered at ~960px while `image.uri` is a tiny
// preview; for photos all three point at the full-size original.
const pickMediaUrl = (post) => {
  for (const m of post.media || []) {
    const url =
      m.preferred_thumbnail?.image?.uri ||
      m.photo_image?.uri ||
      m.thumbnail ||
      m.image?.uri;
    if (url) return url;
  }
  return null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchWithRetry = async (url, attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok || (res.status !== 503 && res.status !== 429)) return res;
  }
  return null;
};

const downloadImage = async (url, dest) => {
  if (await exists(dest)) return true;
  const res = await fetchWithRetry(url);
  if (res?.ok) {
    await write(dest, res);
    return true;
  }
  const reason = res ? `Failed ${res.status}` : "Gave up after retries";
  console.warn(`${reason}: ${url.slice(0, 80)}…`);
  return false;
};

const findPublishTime = (obj, depth = 0) => {
  if (depth > 5 || !obj) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findPublishTime(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === "object") {
    if (typeof obj.publish_time === "number") return obj.publish_time;
    for (const v of Object.values(obj)) {
      const r = findPublishTime(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
};

// Posts are in reverse-chronological order. Some video posts carry a real
// publish_time; interpolate linearly between anchors for everything else so
// the sort order stays stable and dates look plausible.
const interpolateDates = (posts) => {
  const anchors = posts
    .map((p, i) => ({ i, t: findPublishTime(p) }))
    .filter((a) => a.t);

  if (anchors.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    return posts.map((_, i) => now - i * 86400 * 7);
  }

  const result = new Array(posts.length);
  for (const a of anchors) result[a.i] = a.t;

  const first = anchors[0];
  for (let i = 0; i < first.i; i++) {
    result[i] = first.t + (first.i - i) * 86400 * 2;
  }

  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k];
    const b = anchors[k + 1];
    const gap = b.i - a.i;
    if (gap <= 1) continue;
    const step = (b.t - a.t) / gap;
    for (let j = 1; j < gap; j++) {
      result[a.i + j] = Math.round(a.t + step * j);
    }
  }

  const last = anchors[anchors.length - 1];
  for (let i = last.i + 1; i < posts.length; i++) {
    result[i] = last.t - (i - last.i) * 86400 * 3;
  }

  return result;
};

const deriveTitle = (text) => {
  if (!text) return "";
  const cleaned = text
    .replace(/#[^\s#]+/g, "")
    .replace(/\\#/g, "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 140) return cleaned;
  return `${cleaned.slice(0, 137).trimEnd()}…`;
};

const slugFromDate = (timestamp, idx) => {
  const iso = new Date(timestamp * 1000).toISOString();
  return `${iso.slice(0, 10)}-${String(idx).padStart(3, "0")}`;
};

const processPost = async (post, ts, idx) => {
  if (!post) return console.warn(`No post at idx ${idx}`);

  const imageUrl = pickMediaUrl(post);
  if (!imageUrl) return console.warn(`No media URL for idx ${idx}`);

  const slug = slugFromDate(ts, idx);
  const imageName = `${slug}.jpg`;
  if (!(await downloadImage(imageUrl, join(FB_IMAGES_DIR, imageName)))) return;

  const record = {
    thumbnail: `/images/facebook/${imageName}`,
    title: deriveTitle(post.text || ""),
    date: new Date(ts * 1000).toISOString(),
    url: post.url,
  };
  await write(
    join(POSTS_DIR, `${slug}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(`${slug}.json`);
};

const main = async () => {
  if (!(await exists(SOURCE))) {
    console.error(`Missing ${SOURCE}`);
    process.exit(1);
  }

  const posts = await readJson(SOURCE);
  const dates = interpolateDates(posts);

  fs.rm(POSTS_DIR);
  fs.mkdir(POSTS_DIR);
  fs.mkdir(FB_IMAGES_DIR);

  for (const idx of CURATED) {
    await processPost(posts[idx], dates[idx], idx);
  }
};

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
