import { readFile, writeFile } from "node:fs/promises";
const demo = new URL("../demo/Prism-demo.html", import.meta.url);
const module = (await readFile(new URL("../public/session-search.js", import.meta.url), "utf8"))
  .replace("export function", "function");
const source = await readFile(demo, "utf8");
const pattern = /\/\* SESSION_SEARCH_START \*\/[\s\S]*?\/\* SESSION_SEARCH_END \*\//;
if (!pattern.test(source)) throw Error("Demo module markers are missing.");
await writeFile(demo, source.replace(pattern, () =>
  "/* SESSION_SEARCH_START */\n" + module + "/* SESSION_SEARCH_END */"));
