#!/usr/bin/env node
// you-decide-story: turn an episode page into check frames or a finished video.
//
//   node render.mjs <episodeDir>                    full video -> <episodeDir>/out/episode.mp4
//   node render.mjs <episodeDir> --frames auto      check frames picked from the episode's timing
//   node render.mjs <episodeDir> --frames 1.5,4,7   check frames at these seconds
//   options: --out name.mp4  --width 1080 --height 1920  --fps 30  --page episode.html
//
// How it works: the episode folder is served from a local HTTP server (so the page can fetch
// story.json and timing.json), headless Chromium opens the page, and the page is moved to each
// frame's second with window.__seek(seconds). One screenshot per frame; ffmpeg joins the frames
// and adds audio/voice.wav when that file exists.
//
// What the page must provide: window.__ready = true when it can be seeked, window.__duration
// (seconds), window.__seek(seconds). Optional: window.__error (a message that stops the render),
// window.__notes (messages printed here), window.__timing (needed for --frames auto).

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const USAGE = `Usage:
  node render.mjs <episodeDir>                    render the full video
  node render.mjs <episodeDir> --frames auto      render check frames picked from the timing
  node render.mjs <episodeDir> --frames 1.5,4,7   render check frames at these seconds

Options:
  --frames auto|LIST   write PNG check frames to <episodeDir>/out/check/ instead of a video.
                       auto = the first frame, one frame just after every cut, one in the
                       middle of every line, and the last frame. LIST = seconds separated
                       by commas. Both can be mixed: --frames auto,6.9
  --out NAME.mp4       video name inside <episodeDir>/out/ (default episode.mp4). A value
                       with a slash is used as a path as given.
  --width N --height N output size in pixels (default 1080 x 1920)
  --fps N              frames per second (default 30)
  --page FILE          page inside the episode folder (default episode.html)`;

// A Problem is something the user can fix; it is printed without a stack trace.
class Problem extends Error {}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

// Paths are printed relative to the current folder when they are inside it.
const shown = (file) => {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') ? rel : file;
};
const isFile = (file) => { try { return statSync(file).isFile(); } catch { return false; } };
const inside = (root, file) => file === root || file.startsWith(root + sep);

function readOptions() {
  let cli;
  try {
    cli = parseArgs({
      allowPositionals: true,
      options: {
        frames: { type: 'string' }, out: { type: 'string', default: 'episode.mp4' }, page: { type: 'string', default: 'episode.html' },
        width: { type: 'string', default: '1080' }, height: { type: 'string', default: '1920' }, fps: { type: 'string', default: '30' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    throw new Problem(e.message + '\n\n' + USAGE);
  }
  if (cli.values.help) { console.log(USAGE); process.exit(0); }
  if (cli.positionals.length !== 1) throw new Problem('give exactly one episode folder.\n\n' + USAGE);

  const episodeDir = resolve(cli.positionals[0]);
  if (!existsSync(episodeDir) || !statSync(episodeDir).isDirectory()) throw new Problem(`episode folder not found: ${shown(episodeDir)}`);
  const page = cli.values.page;
  if (!isFile(join(episodeDir, page))) throw new Problem(`${page} not found in ${shown(episodeDir)}. Copy template/episode.html into the episode folder first.`);

  const width = Number(cli.values.width), height = Number(cli.values.height), fps = Number(cli.values.fps);
  for (const [name, n] of [['--width', width], ['--height', height]]) {
    if (!Number.isInteger(n) || n < 2 || n % 2) throw new Problem(`${name} must be an even whole number of pixels (got "${n}")`);
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Problem(`--fps must be a whole number from 1 to 120 (got "${cli.values.fps}")`);

  const out = cli.values.out;
  const outFile = /[\\/]/.test(out) ? resolve(out) : join(episodeDir, 'out', out);
  if (extname(outFile).toLowerCase() !== '.mp4') throw new Problem(`--out must end in .mp4 (got "${out}")`);
  return { episodeDir, page, width, height, fps, outFile, frames: cli.values.frames };
}

// Serve the episode folder. A request for /node_modules/... that is not inside the episode
// folder is looked up in the parent folders, the way Node finds packages. That is how the page
// loads GSAP from the project's own "npm install gsap", wherever the episode folder sits.
function serve(root) {
  const server = createServer((req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    let file = normalize(join(root, path));
    if (!inside(root, file)) { res.writeHead(403).end(); return; }
    if (!isFile(file) && path.startsWith('/node_modules/')) {
      for (let dir = dirname(root); ; dir = dirname(dir)) {
        const candidate = normalize(join(dir, path));
        if (inside(join(dir, 'node_modules'), candidate) && isFile(candidate)) { file = candidate; break; }
        if (dir === dirname(dir)) break;
      }
    }
    if (!isFile(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found: ' + path); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

// Start Chromium. The full "playwright" package is tried first, then "playwright-core". Each is
// looked up from the episode folder, the current folder and this script's folder, so it does not
// matter whether the skill lives in ~/.claude/skills or inside the project. A package whose
// browser is not downloaded is skipped and the next one is tried.
async function launchChromium(searchDirs) {
  const problems = [];
  const tried = new Set();
  for (const name of ['playwright', 'playwright-core']) {
    for (const dir of searchDirs) {
      let entry;
      try { entry = createRequire(join(dir, 'noop.js')).resolve(name); } catch { continue; }
      if (tried.has(entry)) continue;
      tried.add(entry);
      try {
        const mod = await import(pathToFileURL(entry).href);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (!chromium) throw new Error('the package has no chromium launcher');
        return await chromium.launch({ args: ['--font-render-hinting=none', '--force-color-profile=srgb'] });
      } catch (e) {
        problems.push(`  ${name} (${shown(dirname(entry))}): ${String(e.message ?? e).split('\n')[0]}`);
      }
    }
  }
  throw new Problem([
    'could not start Chromium through Playwright.',
    ...(problems.length ? problems : ['  neither "playwright" nor "playwright-core" is installed where this episode can see it.']),
    'Fix: in your project folder run',
    '  npm install playwright',
    '  npx playwright install chromium',
  ].join('\n'));
}

// "auto", seconds, or both: --frames auto   --frames 1.5,4,7   --frames auto,6.9
function pickFrames(spec, timing, fps) {
  const frames = [];
  for (const part of spec.split(',').map((s) => s.trim())) {
    if (part === 'auto') {
      if (!timing || !Array.isArray(timing.lines) || !timing.lines.length) throw new Problem('--frames auto needs the page to expose its timing (window.__timing). Give seconds instead: --frames 1.5,4,7');
      // The choice card's inner beats (choice-a, choice-b, choice-cta) are not cuts.
      const rows = timing.lines.filter((l) => !/^choice-/.test(l.id));
      rows.forEach((row, i) => {
        const from = i === 0 ? 0 : row.start;
        const to = i + 1 < rows.length ? rows[i + 1].start : timing.duration;
        frames.push(i === 0 ? { t: Math.min(0.1, to / 3), label: 'first' } : { t: from + Math.min(0.3, (to - from) / 3), label: row.id + '-cut' });
        frames.push({ t: (from + to) / 2, label: row.id + '-mid' });
      });
      frames.push({ t: Math.max(0, timing.duration - 1 / fps), label: 'last' });
    } else {
      const t = Number(part);
      if (part === '' || !Number.isFinite(t) || t < 0) throw new Problem(`--frames wants "auto" or seconds separated by commas, for example --frames 1.5,4,7 or --frames auto,6.9 (got "${spec}")`);
      frames.push({ t, label: '' });
    }
  }
  return frames.sort((a, b) => a.t - b.t);
}

async function main() {
  const opt = readOptions();
  const fullRender = opt.frames === undefined;
  if (fullRender) {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { throw new Problem('ffmpeg was not found on PATH. Install it first (macOS: brew install ffmpeg, Windows: winget install ffmpeg, Linux: sudo apt install ffmpeg).'); }
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outDir = join(opt.episodeDir, 'out');
  const framesDir = join(outDir, `.frames-${process.pid}`);
  let server, browser;
  const cleanUp = () => rmSync(framesDir, { recursive: true, force: true });
  process.on('SIGINT', () => { cleanUp(); process.exit(130); });

  try {
    server = await serve(opt.episodeDir);
    browser = await launchChromium([opt.episodeDir, process.cwd(), scriptDir]);
    const context = await browser.newContext({ viewport: { width: opt.width, height: opt.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [], notFound = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
    page.on('response', (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${new URL(r.url()).pathname}`); });

    const details = () => [...pageErrors.map((e) => '  page error: ' + e), ...notFound.map((e) => '  not loaded: ' + e)].join('\n');
    await page.goto(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(opt.page)}`);
    try {
      await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: 30000 });
    } catch {
      throw new Problem(`${opt.page} did not become ready in 30 seconds (it must set window.__ready = true).\n${details()}`);
    }
    // The page asks for GSAP in node_modules first and falls back to vendor/. When the
    // fallback worked, that first 404 is not a problem and is not reported.
    if (await page.evaluate('typeof window.gsap !== "undefined"')) {
      const at = notFound.indexOf('404 /node_modules/gsap/dist/gsap.min.js');
      if (at >= 0) notFound.splice(at, 1);
    }
    const pageError = await page.evaluate('window.__error || null');
    if (pageError || pageErrors.length) throw new Problem([`${opt.page} reported a problem:`, ...(pageError ? ['  ' + pageError] : []), ...(details() ? [details()] : [])].join('\n'));

    const duration = await page.evaluate('window.__duration');
    if (!(Number.isFinite(duration) && duration > 0)) throw new Problem(`${opt.page} must set window.__duration to the length in seconds (got ${duration}).`);
    for (const note of (await page.evaluate('window.__notes || []'))) console.log('Note: ' + note);
    const seek = (seconds) => page.evaluate((s) => window.__seek(s), seconds);

    if (!fullRender) {
      const frames = pickFrames(opt.frames, await page.evaluate('window.__timing || null'), opt.fps);
      const checkDir = join(outDir, 'check');
      mkdirSync(checkDir, { recursive: true });
      for (const frame of frames) {
        if (frame.t > duration) console.log(`Note: ${frame.t} s is past the end (${duration.toFixed(2)} s); the last frame is shown.`);
        await seek(frame.t);
        const file = join(checkDir, `check-${frame.t.toFixed(2).padStart(5, '0')}${frame.label ? '-' + frame.label : ''}.png`);
        await page.screenshot({ path: file });
        console.log(`check frame ${frame.t.toFixed(2).padStart(6)} s  ${frame.label.padEnd(12)} ${shown(file)}`);
      }
      console.log(`Done: ${frames.length} check frames, ${opt.width} x ${opt.height}. Open each one at full size before the full render.`);
      return;
    }

    // The habit this tool is built around: look at check frames before spending a full render.
    const checkDir = join(outDir, 'check');
    const lastEdit = Math.max(...[opt.page, 'story.json', 'timing.json'].map((name) => join(opt.episodeDir, name)).filter(isFile).map((file) => statSync(file).mtimeMs));
    const checked = existsSync(checkDir) && readdirSync(checkDir).some((name) => name.endsWith('.png') && statSync(join(checkDir, name)).mtimeMs >= lastEdit);
    if (!checked) console.log('Note: no check frames were rendered since the episode last changed. Render them first and look at them: --frames auto');

    cleanUp();
    mkdirSync(framesDir, { recursive: true });
    mkdirSync(dirname(opt.outFile), { recursive: true });
    const total = Math.max(1, Math.ceil(duration * opt.fps - 1e-6));
    const audio = join(opt.episodeDir, 'audio', 'voice.wav');
    const hasAudio = isFile(audio);
    console.log(`Rendering ${total} frames at ${opt.width} x ${opt.height}, ${opt.fps} fps (${duration.toFixed(2)} s)${hasAudio ? '' : ', no audio: audio/voice.wav not found'}`);
    const began = performance.now();
    for (let k = 0; k < total; k++) {
      await seek(k / opt.fps);
      await page.screenshot({ path: join(framesDir, `f-${String(k).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 96 });
      if ((k + 1) % 150 === 0) console.log(`  ${k + 1}/${total} frames`);
    }
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(opt.fps), '-i', join(framesDir, 'f-%06d.jpg'),
        ...(hasAudio ? ['-i', audio] : []),
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
        '-t', (total / opt.fps).toFixed(3), '-movflags', '+faststart', opt.outFile], { stdio: 'inherit' });
    } catch {
      throw new Problem('ffmpeg could not write the video (its own message is above).');
    }
    const seconds = ((performance.now() - began) / 1000).toFixed(1);
    console.log(`Done: ${total} frames, ${(total / opt.fps).toFixed(2)} s of video, rendered in ${seconds} s, ${hasAudio ? 'with audio' : 'no audio'} -> ${shown(opt.outFile)}`);
  } finally {
    cleanUp();
    await browser?.close();
    server?.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Problem ? 'Error: ' + e.message : e);
  process.exitCode = 1;
});
