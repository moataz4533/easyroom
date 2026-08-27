/**
 * Renders docs/reception-guide.html to a PDF.
 *
 * Chromium rather than a PDF library, because the guide is Arabic: RTL,
 * ligatures and Arabic-Indic digits all come out right through the browser's
 * text shaping and would need hand-holding anywhere else. The font is the
 * app's own IBM Plex Sans Arabic, copied next to this file so the PDF looks
 * like the screens it describes and builds with no network.
 *
 *   node docs/build-guide.mjs   # يبني الاتنين
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Two guides, one pipeline: the reception one for the desk, the admin one
// for whoever owns the hotel and sets it up.
const GUIDES = [
  ["reception-guide.html", "easyroom-reception-guide.pdf"],
  ["admin-guide.html", "easyroom-admin-guide.pdf"],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
for (const [file, pdf] of GUIDES) {
  const source = resolve(import.meta.dirname, file);
  const out = resolve(import.meta.dirname, pdf);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(source).href, { waitUntil: "networkidle" });
  // The cover bleeds to the page edge, so the margins live in the @page rule
  // rather than here.
  await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
  await page.close();
  console.log(`wrote ${out}`);
}
await browser.close();
