// Inlines the demo build's JS and CSS into one HTML file (demo/eduskills-demo.html).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = "dist-demo/assets";
const files = readdirSync(dir);
const js = readFileSync(`${dir}/${files.find((f) => f.endsWith(".js"))}`, "utf8").replace(/<\/script/gi, "<\\/script");
const css = readFileSync(`${dir}/${files.find((f) => f.endsWith(".css"))}`, "utf8");
const icon = encodeURIComponent(readFileSync("public/favicon.svg", "utf8"));
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EduSkills AI</title>
<meta name="description" content="AI-Driven Soft Skills Assessment and Development System - online demo">
<link rel="icon" href="data:image/svg+xml,${icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">
<style>${css}
html,body{background:#f5f5ef;color:#0f172a}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
mkdirSync("demo", { recursive: true });
writeFileSync("demo/eduskills-demo.html", html);
// Full HTML document for GitHub Pages (docs/index.html, published on the gh-pages branch).
const page = html.replace('<div id="root"></div>', '</head>\n<body>\n<div id="root"></div>');
mkdirSync("../docs", { recursive: true });
writeFileSync("../docs/index.html", `<!doctype html>\n<html lang="en">\n<head>\n${page}</body>\n</html>\n`);
console.log(`demo/eduskills-demo.html ${(html.length / 1024).toFixed(0)} KB`);
