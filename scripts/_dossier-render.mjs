// Render temporal del dossier (scratchpad) → PNG por slide o PDF.
// Uso: node scripts/_dossier-render.mjs <archivo.html> <png|pdf>
import puppeteer from "puppeteer";

const DIR = "C:/Users/jorge/AppData/Local/Temp/claude/C--dev-salamandra-crm-salamandra-2/172dfe3e-dfc3-4598-aa5b-eb425c093156/scratchpad/dossier";
const input = process.argv[2] || "sample.html";
const mode = process.argv[3] || "png";

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.goto("file:///" + DIR + "/" + input, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");

if (mode === "png") {
  const slides = await page.$$(".slide");
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: `${DIR}/slide-${i + 1}.png` });
  }
  console.log("PNG OK:", slides.length, "slides");
} else {
  const out = input.replace(/\.html$/, ".pdf");
  await page.pdf({ path: `${DIR}/${out}`, width: "1280px", height: "720px", printBackground: true });
  console.log("PDF OK:", out);
}
await browser.close();
