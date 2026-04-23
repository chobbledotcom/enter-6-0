#!/usr/bin/env bun

// Curates a set of Facebook posts into JSON files consumable by the `socials`
// block. Each output file conforms to {url, date, title, thumbnail}.
//
// The FB CDN image URLs in facebook-posts.json expire, and in this environment
// we cannot download them. Instead we pair each curated post with an existing
// ride photo from images/ using a hand-picked mapping.

import { join } from "node:path";
import { exists, fs, path, readJson, write } from "./utils.js";

const SOURCE = path("facebook-posts.json");
const POSTS_DIR = path("facebook-posts");
const IMAGES_DIR = path("images");

// Hand-curated mapping: source post index -> local thumbnail filename.
// Chosen for posts with substantive, factual, or high-signal content.
const CURATED = [
  { idx: 0, image: "IMG_2860.jpeg" },
  { idx: 4, image: "IMG_0830.jpeg" },
  { idx: 7, image: "IMG_2835.jpeg" },
  { idx: 15, image: "IMG_0805.jpeg" },
  { idx: 25, image: "IMG_0831.jpeg" },
  { idx: 29, image: "IMG_2819.jpeg" },
  { idx: 30, image: "IMG_0249.jpeg" },
  { idx: 37, image: "IMG_2825.jpeg" },
  { idx: 38, image: "IMG_2845.jpeg" },
  { idx: 42, image: "IMG_1146.jpeg" },
  { idx: 55, image: "IMG_0806.jpeg" },
  { idx: 57, image: "IMG_0807.jpeg" },
  { idx: 58, image: "IMG_1079.jpeg" },
  { idx: 64, image: "IMG_0870.png" },
];

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

const main = async () => {
  if (!(await exists(SOURCE))) {
    console.error(`Missing ${SOURCE}`);
    process.exit(1);
  }

  const posts = await readJson(SOURCE);
  const dates = interpolateDates(posts);

  fs.mkdir(POSTS_DIR);

  for (const { idx, image } of CURATED) {
    const post = posts[idx];
    if (!post) {
      console.warn(`No post at idx ${idx}`);
      continue;
    }
    const imagePath = join(IMAGES_DIR, image);
    if (!(await exists(imagePath))) {
      console.warn(`Missing image ${image} for idx ${idx}`);
      continue;
    }

    const ts = dates[idx];
    const slug = slugFromDate(ts, idx);
    const record = {
      thumbnail: `/images/${image}`,
      title: deriveTitle(post.text || ""),
      date: new Date(ts * 1000).toISOString(),
      url: post.url,
    };

    await write(
      join(POSTS_DIR, `${slug}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    console.log(`${slug}.json`);
  }
};

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
