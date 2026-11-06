import { readFile, writeFile } from 'node:fs/promises';

const project = new URL('../', import.meta.url);
const templatePath = new URL('aws-template.json', project);
// AWS CLI can read file:// input using the Windows locale. ASCII JSON avoids mojibake.
const ascii = text => text.replace(/[^\x00-\x7f]/g, char => '\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
let content = await readFile(templatePath, 'utf8');
content=ascii(content);
const template = JSON.parse(content);

// Keep the hand-formatted template readable; replace only each inline source string.
for (const [resource, file] of [
  ['AnalyticsCollector', 'collector.py'],
  ['AnalyticsDashboardFunction', 'dashboard.py'],
]) {
  const code = await readFile(new URL(`analytics/${file}`, project), 'utf8');
  const previous = ascii(JSON.stringify(template.Resources[resource].Properties.Code.ZipFile));
  if (content.indexOf(previous) !== content.lastIndexOf(previous)) {
    throw new Error(`Ambiguous inline code for ${resource}`);
  }
  if (!content.includes(previous)) throw new Error(`Inline code missing for ${resource}`);
  content = content.replace(previous, () => ascii(JSON.stringify(code.replaceAll('\r\n', '\n'))));
}

JSON.parse(content);
await writeFile(templatePath, content);
console.log('Updated both inline analytics functions in aws-template.json.');
