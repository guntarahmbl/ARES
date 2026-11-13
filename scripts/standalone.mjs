import { readFile, writeFile } from "node:fs/promises";
let html = await readFile("dist/index.html", "utf8");
const script = html.match(
  /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/,
);
const css = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
const js = await readFile("dist" + script[1], "utf8");
const style = await readFile("dist" + css[1], "utf8");
html = html
  .replace(
    script[0],
    () =>
      `<script type="module">${js.replaceAll("</script", "<\\/script")}</script>`,
  )
  .replace(css[0], () => `<style>${style}</style>`);
await writeFile("dist/ares-path.html", html);
console.log("Standalone: dist/ares-path.html");
