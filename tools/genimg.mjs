#!/usr/bin/env node
// RED HORIZON asset generator — OpenRouter unified Images API, zero deps (Node >= 18).
// Usage:
//   node genimg.mjs --out raw/x.png --prompt "..." [--model openai/gpt-image-1]
//     [--quality high] [--background transparent|opaque|auto] [--aspect 1:1] [--resolution 1K]
//   node genimg.mjs --batch asset_spec.json [--only name1,name2] [--force] [--concurrency 3]
// Reads OPENROUTER_API_KEY from env. Never prints the key.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://openrouter.ai/api/v1/images';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('FATAL: OPENROUTER_API_KEY not in env'); process.exit(1); }

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { a[key] = argv[++i]; }
      else a[key] = true;
    }
  }
  return a;
}

async function genOne({ model, prompt, quality, background, aspect, resolution, out, retries = 3 }) {
  const body = {
    model: model || 'openai/gpt-image-1',
    prompt,
    quality: quality || 'high',
    output_format: 'png',
    n: 1,
  };
  if (background && background !== 'none') body.background = background;
  if (aspect) body.aspect_ratio = aspect;
  if (resolution) body.resolution = resolution;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const t0 = Date.now();
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://claudetee.github.io/red-horizon/',
          'X-Title': 'Red Horizon asset gen',
        },
        body: JSON.stringify(body),
      });
      const txt = await res.text();
      if (!res.ok) {
        console.error(`  [${out}] HTTP ${res.status} attempt ${attempt}: ${txt.slice(0, 400)}`);
        if (res.status === 429 || res.status >= 500) {
          await new Promise(r => setTimeout(r, 4000 * attempt));
          continue;
        }
        return false;
      }
      const j = JSON.parse(txt);
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) {
        const url = j.data?.[0]?.url;
        if (url) {
          const ir = await fetch(url);
          const buf = Buffer.from(await ir.arrayBuffer());
          writeFileSync(out, buf);
        } else {
          console.error(`  [${out}] no image in response: ${txt.slice(0, 300)}`);
          continue;
        }
      } else {
        writeFileSync(out, Buffer.from(b64, 'base64'));
      }
      const cost = j.usage?.cost != null ? `$${Number(j.usage.cost).toFixed(4)}` : '?';
      console.log(`  OK ${out}  ${(Date.now() - t0) / 1000 | 0}s  cost=${cost}`);
      return true;
    } catch (e) {
      console.error(`  [${out}] error attempt ${attempt}: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.batch) {
    const spec = JSON.parse(readFileSync(resolve(HERE, args.batch), 'utf8'));
    const style = spec.style_blocks || {};
    const only = args.only ? String(args.only).split(',') : null;
    const conc = Number(args.concurrency || 3);
    const outDir = resolve(HERE, spec.raw_dir || '../assets/raw');
    mkdirSync(outDir, { recursive: true });

    const jobs = [];
    for (const [name, e] of Object.entries(spec.assets)) {
      if (only && !only.includes(name)) continue;
      const out = `${outDir}/${name}.png`;
      if (!args.force && existsSync(out)) { console.log(`  skip (exists) ${name}`); continue; }
      const styleBlock = e.style ? (style[e.style] || '') : '';
      const prompt = [styleBlock, e.prompt].filter(Boolean).join(' ');
      jobs.push({
        name,
        model: e.model || spec.default_model || 'openai/gpt-image-1',
        prompt,
        quality: e.quality || spec.default_quality || 'high',
        background: e.background ?? 'transparent',
        aspect: e.aspect || '1:1',
        resolution: e.resolution || '1K',
        out,
      });
    }
    console.log(`batch: ${jobs.length} jobs, concurrency ${conc}`);
    let ok = 0, fail = 0, idx = 0;
    const failed = [];
    async function worker() {
      while (idx < jobs.length) {
        const j = jobs[idx++];
        console.log(`> gen ${j.name} [${j.model} q=${j.quality} bg=${j.background} ${j.aspect}]`);
        const r = await genOne(j);
        if (r) ok++; else { fail++; failed.push(j.name); }
      }
    }
    await Promise.all(Array.from({ length: conc }, worker));
    console.log(`DONE ok=${ok} fail=${fail}${failed.length ? ' failed: ' + failed.join(',') : ''}`);
    process.exit(fail ? 2 : 0);
  }

  // single mode
  if (args['prompt-file']) args.prompt = readFileSync(args['prompt-file'], 'utf8').trim();
  if (!args.prompt || !args.out) {
    console.error('need --prompt/--prompt-file and --out (or --batch spec.json)');
    process.exit(1);
  }
  const ok = await genOne({
    model: args.model, prompt: args.prompt, quality: args.quality,
    background: args.background, aspect: args.aspect, resolution: args.resolution,
    out: args.out,
  });
  process.exit(ok ? 0 : 2);
}

main();
