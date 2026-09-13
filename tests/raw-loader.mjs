import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.txt?raw')) {
    const plain = specifier.slice(0, -4);
    const resolved = await nextResolve(plain, context);
    return { url: `${resolved.url}?raw`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes('.txt?raw')) {
    const text = await fs.readFile(fileURLToPath(url.split('?')[0]), 'utf8');
    return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
