// Render del dossier → PNG por slide o PDF. Rutas relativas al repo.
// Uso:
//   node scripts/_dossier-render.mjs dossier/dossier.html pdf [dossier/Dossier-Salamandra-CRM.pdf]
//   node scripts/_dossier-render.mjs dossier/dossier.html png
// Requiere puppeteer (no está en package.json; instalar con `npm i puppeteer --no-save`).
import puppeteer from "puppeteer";
import path from "node:path";

const input = process.argv[2] || "dossier/dossier.html";
const mode = process.argv[3] || "pdf";
const outArg = process.argv[4];

const inputAbs = path.resolve(process.cwd(), input);
const dir = path.dirname(inputAbs);
const fileUrl = "file:///" + inputAbs.replace(/\\/g, "/");

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
await page.goto(fileUrl, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");

if (mode === "png") {
  const slides = await page.$$(".slide");
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: path.join(dir, `slide-${i + 1}.png`) });
  }
  console.log("PNG OK:", slides.length, "slides");
} else {
  const out = outArg
    ? path.resolve(process.cwd(), outArg)
    : inputAbs.replace(/\.html$/, ".pdf");
  await page.pdf({ path: out, width: "1280px", height: "720px", printBackground: true });
  console.log("PDF OK:", out);
}
await browser.close();
