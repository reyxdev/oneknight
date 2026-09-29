// Converts source PNG captures into AVIF + WebP at the sizes the site uses.
// usage: node scripts/optimize-images.mjs <srcDir> <outDir> <name>:<file>:<width>[,<width>...] ...
import sharp from "sharp";
import path from "node:path";

const [src, out, ...jobs] = process.argv.slice(2);
for (const job of jobs) {
  const [name, file, widths] = job.split(":");
  for (const w of widths.split(",").map(Number)) {
    const img = sharp(path.join(src, file)).resize({ width: w });
    await img.clone().avif({ quality: 52, effort: 6 }).toFile(path.join(out, `${name}-${w}.avif`));
    await img.clone().webp({ quality: 74 }).toFile(path.join(out, `${name}-${w}.webp`));
  }
  console.log("ok", name);
}
