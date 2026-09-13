import { readFile, writeFile } from "node:fs/promises";
const demo = new URL("../demo/Prism-demo.html", import.meta.url);
const module = (await readFile(new URL("../public/session-search.js", import.meta.url), "utf8"))
  .replace("export function", "function");
const source = await readFile(demo, "utf8");
const pattern = /\/\* SESSION_SEARCH_START \*\/[\s\S]*?\/\* SESSION_SEARCH_END \*\//;
if (!pattern.test(source)) throw Error("Demo module markers are missing.");
await writeFile(demo, source.replace(pattern, () =>
  "/* SESSION_SEARCH_START */\n" + module + "/* SESSION_SEARCH_END */"));

let richDemo = await readFile(demo, 'utf8');
for (const [marker, path, script] of [
  ['OUTPUT_MODULE', '../public/artifacts.js', true],
  ['OUTPUT_SAMPLE', '../public/artifact-samples.js', true],
  ['OUTPUT_STYLE', '../public/artifacts.css', false],
]) {
  let content = await readFile(new URL(path, import.meta.url), 'utf8');
  if (script) content = content.replaceAll('export function', 'function').replaceAll('</script', '<\\/script');
  const start = '/* ' + marker + '_START */', end = '/* ' + marker + '_END */';
  const before = richDemo.indexOf(start), after = richDemo.indexOf(end);
  if (before < 0 || after < before) throw Error('Missing demo output module marker.');
  richDemo = richDemo.slice(0, before) + start + '\n' + content + '\n' + richDemo.slice(after);
}
await writeFile(demo, richDemo);
