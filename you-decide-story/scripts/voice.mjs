#!/usr/bin/env node
// you-decide-story: speak the story and write the timing every picture is hung on.
//
//   node voice.mjs <episodeDir> [--provider say|elevenlabs|silent] [--voice NAME] [--rate N]
//                               [--gap 0.3] [--lead 0.3] [--fresh]
//
// Reads   <episodeDir>/story.json
// Writes  <episodeDir>/audio/<id>.wav    one file per spoken line
//         <episodeDir>/audio/voice.wav   every line on one track, each at its start second
//         <episodeDir>/timing.json       { duration, lines: [{ id, start, end, say }] }
//
// Rows in timing.json: one per entry of story.lines, then "choice" (the choice card comes on),
// then "choice-a", "choice-b", "choice-cta" when those parts of the choice are spoken.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `Usage:
  node voice.mjs <episodeDir> [options]

Options:
  --provider NAME   say (macOS built-in voice, the default on a Mac),
                    elevenlabs (paid API, needs ELEVENLABS_API_KEY),
                    silent (no voice: silence of an estimated length, for timing only)
  --voice NAME      say: a voice name, default Daniel (list them with: say -v '?')
                    elevenlabs: a voice id (or set ELEVENLABS_VOICE_ID)
  --rate N          words per minute for say (default 172) and silent (default 150)
  --gap SECONDS     silence after each line, unless the line sets "pause" (default 0.3)
  --lead SECONDS    silence before the first line (default 0.3)
  --fresh           speak every line again, even when nothing changed`;

// A Problem is something the user can fix; it is printed without a stack trace.
class Problem extends Error {}

const shown = (file) => {
  const rel = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') ? rel : file;
};
const ms = (seconds) => Math.round(seconds * 1000) / 1000;
const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Problem(`"${command}" was not found on PATH.${/^ff/.test(command) ? ' Install ffmpeg first (macOS: brew install ffmpeg, Windows: winget install ffmpeg, Linux: sudo apt install ffmpeg).' : ''}`);
    throw new Problem(`${command} failed: ${String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
};

// ---------------------------------------------------------------------------- providers
// A provider is one async function:  (text, fileBase, options) -> path of the audio it wrote.
// It may write fileBase plus any extension ffmpeg can read. Everything after that (conversion
// to WAV, timing, the joined track, timing.json) is shared and does not know which provider ran.
// To add a free voice that works on every system later (Piper, Kokoro, espeak-ng, ...), write
// one more function like these and add it to PROVIDERS. Nothing else in this file changes.

let sayVoiceChecked = false;
async function say(text, base, { voice = 'Daniel', rate = 172 }) {
  if (process.platform !== 'darwin') throw new Problem('the "say" provider is the macOS built-in voice. On this system use --provider elevenlabs (paid, needs ELEVENLABS_API_KEY) or --provider silent (no voice, timing only).');
  if (!sayVoiceChecked) {
    sayVoiceChecked = true;
    const known = run('say', ['-v', '?']).split('\n').some((row) => row.toLowerCase().startsWith(voice.toLowerCase() + ' '));
    if (!known) throw new Problem(`macOS has no voice named "${voice}". List the installed voices with: say -v '?'`);
  }
  writeFileSync(base + '.txt', text);
  run('say', ['-v', voice, '-r', String(rate), '-o', base + '.aiff', '-f', base + '.txt']);
  rmSync(base + '.txt');
  return base + '.aiff';
}

// Paid. One request per line. Written against the public text-to-speech endpoint.
async function elevenlabs(text, base, { voice }) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Problem('--provider elevenlabs needs the ELEVENLABS_API_KEY environment variable.');
  const voiceId = voice ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Problem('give an ElevenLabs voice id: --voice <voice_id>, or set ELEVENLABS_VOICE_ID.');
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2' }),
  });
  if (!response.ok) throw new Problem(`ElevenLabs answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  writeFileSync(base + '.mp3', Buffer.from(await response.arrayBuffer()));
  return base + '.mp3';
}

// No voice at all: silence as long as the line would take to read. Captions and scenes still
// get real timing, and a recorded voice can be laid over the video later.
async function silent(text, base, { rate = 150 }) {
  const seconds = Math.max(0.8, (text.trim().split(/\s+/).length * 60) / rate + 0.3);
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', seconds.toFixed(3), base + '.flac']);
  return base + '.flac';
}

const PROVIDERS = { say, elevenlabs, silent };

// ---------------------------------------------------------------------------- story.json
function readStory(dir) {
  const file = join(dir, 'story.json');
  if (!existsSync(file)) throw new Problem(`no story.json in ${shown(dir)}`);
  let story;
  try { story = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Problem(`story.json is not valid JSON: ${e.message}`); }
  if (!Array.isArray(story.lines) || !story.lines.length) throw new Problem('story.json needs "lines": [ { "id", "say", "caption", "clock" }, ... ]');
  const ids = new Set();
  story.lines.forEach((line, i) => {
    if (typeof line.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(line.id)) throw new Problem(`lines[${i}].id must be a short name such as "l${i + 1}" (letters, digits, - and _)`);
    if (line.id === 'choice' || line.id.startsWith('choice-')) throw new Problem(`lines[${i}].id "${line.id}" is reserved for the choice card. Pick another id.`);
    if (ids.has(line.id)) throw new Problem(`two lines share the id "${line.id}"`);
    ids.add(line.id);
    if (typeof line.say !== 'string' || !line.say.trim()) throw new Problem(`line "${line.id}" needs "say": the words the narrator speaks`);
    if (line.pause !== undefined && !(Number.isFinite(line.pause) && line.pause >= 0)) throw new Problem(`line "${line.id}": "pause" must be a number of seconds`);
  });
  const choice = story.choice;
  if (!choice || typeof choice.a !== 'string' || !choice.a.trim() || typeof choice.b !== 'string' || !choice.b.trim()) throw new Problem('story.json needs "choice": { "a": "WORD", "b": "WORD", ... } with the two words of the ending.');
  return story;
}

// The four parts of the format, checked where a script can check them.
function formatWarnings(story, rows, duration) {
  const warnings = [];
  const n = story.lines.length;
  if (n < 5 || n > 7) warnings.push(`the story has ${n} lines; the format is 5 to 7 lines plus the choice.`);
  if (rows[0].end > 3) warnings.push(`the premise ends at ${rows[0].end.toFixed(2)} s; it should be spoken inside the first 3 seconds. Shorten lines[0].say.`);
  let clock, changes = -1;
  for (const line of [...story.lines, story.choice]) if (line.clock && line.clock !== clock) { clock = line.clock; changes++; }
  if (changes < 0) warnings.push('no line has a "clock"; the top strip needs a clock or counter.');
  else if (changes < 1) warnings.push('the clock never changes; give a later line a different "clock".');
  for (const word of [story.choice.a, story.choice.b]) if (/\s/.test(word.trim())) warnings.push(`the choice "${word}" is more than one word; the ending is two single words.`);
  story.lines.forEach((line, i) => {
    const onScreen = (i + 1 < rows.length ? rows[i + 1].start : duration) - (i === 0 ? 0 : rows[i].start);
    if (onScreen < 2) warnings.push(`line "${line.id}" is on screen for only ${onScreen.toFixed(2)} s; add "pause" to it or lengthen the sentence.`);
    if (!line.caption) warnings.push(`line "${line.id}" has no "caption".`);
    else if (line.caption.length > 56) warnings.push(`the caption of "${line.id}" is ${line.caption.length} characters; keep captions under about 50.`);
  });
  return warnings;
}

// ---------------------------------------------------------------------------- main
async function main() {
  let cli;
  try {
    cli = parseArgs({
      allowPositionals: true,
      options: {
        provider: { type: 'string' }, voice: { type: 'string' }, rate: { type: 'string' },
        gap: { type: 'string', default: '0.3' }, lead: { type: 'string', default: '0.3' },
        fresh: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    throw new Problem(e.message + '\n\n' + USAGE);
  }
  if (cli.values.help) { console.log(USAGE); return; }
  if (cli.positionals.length !== 1) throw new Problem('give exactly one episode folder.\n\n' + USAGE);

  const dir = resolve(cli.positionals[0]);
  const providerName = cli.values.provider ?? (process.platform === 'darwin' ? 'say' : null);
  if (!providerName) throw new Problem('this system has no built-in voice. Choose one: --provider elevenlabs (paid, needs ELEVENLABS_API_KEY) or --provider silent (no voice, timing only).');
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Problem(`unknown provider "${providerName}". Choose one of: ${Object.keys(PROVIDERS).join(', ')}`);
  const number = (name) => {
    const n = Number(cli.values[name]);
    if (!Number.isFinite(n) || n < 0) throw new Problem(`--${name} must be a number (got "${cli.values[name]}")`);
    return n;
  };
  const gap = number('gap'), lead = number('lead');
  const options = { voice: cli.values.voice, rate: cli.values.rate === undefined ? undefined : number('rate') };

  const story = readStory(dir);
  const choice = story.choice;
  const spoken = typeof choice.say === 'string' ? { question: choice.say } : (choice.say ?? {});
  // What gets a row in timing.json, in order. "after" is the silence that follows the row.
  const plan = [
    ...story.lines.map((line) => ({ id: line.id, say: line.say.trim(), after: line.pause ?? gap })),
    { id: 'choice', say: (spoken.question ?? '').trim(), after: 0.12 },
    ...[['choice-a', spoken.a], ['choice-b', spoken.b], ['choice-cta', spoken.cta]]
      .filter(([, text]) => typeof text === 'string' && text.trim())
      .map(([id, text]) => ({ id, say: text.trim(), after: 0.12 })),
  ];

  // Speak. A line is spoken again only when its text or the voice settings changed, so a paid
  // provider is not charged twice for the same sentence.
  const audioDir = join(dir, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const cacheFile = join(audioDir, 'cache.json');
  let cache = {};
  if (!cli.values.fresh && existsSync(cacheFile)) { try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { cache = {}; } }
  const nextCache = {};
  for (const row of plan) {
    if (!row.say) { row.length = 0; continue; }
    const wav = join(audioDir, row.id + '.wav');
    const key = JSON.stringify([providerName, options.voice ?? null, options.rate ?? null, process.env.ELEVENLABS_MODEL_ID ?? null, row.say]);
    if (cache[row.id] !== key || !existsSync(wav)) {
      const raw = await provider(row.say, join(audioDir, row.id + '.raw'), options);
      run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', wav]);
      rmSync(raw);
    } else {
      row.reused = true;
    }
    nextCache[row.id] = key;
    row.wav = wav;
    row.length = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).trim());
    if (!(row.length > 0)) throw new Problem(`could not measure ${shown(wav)}`);
  }
  writeFileSync(cacheFile, JSON.stringify(nextCache, null, 1) + '\n');

  // Lay the rows out on one clock.
  let t = lead;
  for (const row of plan) {
    row.start = ms(t);
    row.end = ms(t + row.length);
    if (row.length > 0) t = row.end + row.after;
  }
  const lastEnd = Math.max(...plan.map((row) => row.end));
  const choiceStart = plan.find((row) => row.id === 'choice').start;
  // The card stays up after the last word, and never less than 4 seconds in all.
  const duration = ms(Math.max(lastEnd + (Number.isFinite(choice.hold) ? choice.hold : 2.5), choiceStart + 4));

  // One track: every clip delayed to its start second, padded to the full length.
  const clips = plan.filter((row) => row.wav);
  const voiceFile = join(audioDir, 'voice.wav');
  const delayed = clips.map((row, i) => `[${i}:a]adelay=${Math.round(row.start * 1000)}:all=1[a${i}]`).join(';');
  const mixed = clips.length > 1
    ? `${delayed};${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${duration}[out]`
    : `${delayed};[a0]apad=whole_dur=${duration}[out]`;
  run('ffmpeg', ['-y', '-v', 'error', ...clips.flatMap((row) => ['-i', row.wav]), '-filter_complex', mixed, '-map', '[out]', '-t', String(duration), '-c:a', 'pcm_s16le', voiceFile]);

  const timingFile = join(dir, 'timing.json');
  const lines = plan.map(({ id, start, end, say: text }) => ({ id, start, end, say: text }));
  writeFileSync(timingFile, JSON.stringify({ duration, voice: { provider: providerName, ...(options.voice ? { voice: options.voice } : {}), ...(options.rate ? { rate: options.rate } : {}) }, lines }, null, 1) + '\n');

  console.log('   start      end  id          spoken');
  for (const row of plan) console.log(`${row.start.toFixed(2).padStart(8)} ${row.end.toFixed(2).padStart(8)}  ${row.id.padEnd(11)} ${row.say || '(not spoken)'}${row.reused ? '  [unchanged, reused]' : ''}`);
  console.log(`duration ${duration.toFixed(2)} s, provider ${providerName}`);
  console.log(`wrote ${shown(voiceFile)} and ${shown(timingFile)}`);
  for (const warning of formatWarnings(story, lines, duration)) console.log('Warning: ' + warning);
}

main().catch((e) => {
  console.error(e instanceof Problem ? 'Error: ' + e.message : e);
  process.exitCode = 1;
});
