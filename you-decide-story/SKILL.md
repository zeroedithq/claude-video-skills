---
name: you-decide-story
description: Turns a one-paragraph story into a rendered vertical story video (1080x1920 MP4) drawn entirely in code, with inline SVG scenes moved by GSAP, a narrator voice, captions timed to the voice, a clock in a top strip and a two-word choice at the end. Use when the user asks for a "you decide" story, a choice-ending or "would you?" story video, a narrated story Reel, Short or TikTok made without a camera or an image generator, or the next part of such a series.
license: MIT
compatibility: Requires Claude Code, Node.js 22+, ffmpeg
metadata:
  version: "1.0"
  author: "Zero Edit"
---

# You Decide Story

You make a short vertical video (1080 x 1920, about 20 to 45 seconds) that tells a small story and stops on a choice. Nothing is filmed and no image is generated. You draw every scene as inline SVG, GSAP moves it, a narrator reads the lines, and a script renders the frames into an MP4. The user gives you one paragraph. You give back the rendered video.

## The four parts

Every episode has all four.

1. **A one-sentence premise, spoken inside the first three seconds.** Second person, present tense: "You drive the last bus of the night." The pattern is: you, a place, one detail that is slightly wrong. The viewer knows who and where they are before they can scroll.
2. **A clock or counter that stays on screen in the top strip and changes at least once.** "11:58 PM" becomes "11:59 PM". "3 MATCHES" becomes "2 MATCHES". The change tells the viewer that time is running.
3. **One drawn scene per line of the story.** The story has 5 to 7 lines. Each line has its own picture and its own caption. The picture changes on the second the narrator starts the line.
4. **A two-word choice at the end.** The screen goes dark and asks WOULD YOU? Then two options, one word each (for example ANSWER / DON'T), then COMMENT ONE WORD. The story does not resolve. The choice is the ending.

## Files

`SKILL_DIR` below is the folder this file is in. Use its real absolute path in commands. Claude Code shows it when the skill loads. Otherwise it is `.claude/skills/you-decide-story` in the project, or `~/.claude/skills/you-decide-story`.

```
SKILL_DIR/scripts/voice.mjs       story.json -> narrator audio + timing.json
SKILL_DIR/scripts/render.mjs      episode page -> check frames, or the MP4
SKILL_DIR/template/episode.html   the page you copy for every episode
```

One episode is one folder inside the user's project, named after the story:

```
last-bus/
  story.json       you write it (step 1)
  timing.json      voice.mjs writes it (step 2). Never edit it by hand.
  audio/           voice.mjs writes it (step 2)
  episode.html     copied from the template (step 3), then you draw in it
  out/check/       check frames (step 6)
  out/episode.mp4  the video (step 8)
```

## Before the first episode

Run these in the user's project folder:

```bash
node --version           # must be v22 or newer
ffmpeg -version          # must print a version
npm ls gsap playwright   # both must be listed
```

If gsap or playwright is missing, install them in the project folder: `npm install gsap playwright`, then `npx playwright install chromium`. If Node.js or ffmpeg is missing, stop and tell the user what to install.

## Steps

Do the steps in this order. Do not render the full video before step 7 is clean.

### Step 1. Write story.json

Turn the user's paragraph into 5 to 7 lines plus the choice. The paragraph should answer four questions: where are you, what time is it (or what is running out), who or what arrives, what are the two words at the end. If one is missing, invent it and say so in your final report. Do not stop to ask. If this is a later part of a series, the user tells you which word won. Open with it.

```json
{
  "title": "LAST BUS",
  "lines": [
    { "id": "l1", "say": "You drive the last bus of the night.", "caption": "You drive the last bus.", "clock": "11:58 PM", "pause": 0.8 },
    { "id": "l2", "say": "A man waves you down. There is no stop here.", "caption": "A man waves you down. No stop here.", "clock": "11:59 PM" }
  ],
  "choice": {
    "question": "WOULD YOU?",
    "a": "STOP", "aNote": "let him on",
    "b": "DRIVE", "bNote": "keep going",
    "say": { "question": "Would you?", "a": "Stop.", "b": "Or drive.", "cta": "Comment one word." }
  }
}
```

| Field | What it is |
| --- | --- |
| `title` | The label in the top strip. One to three words. It is drawn in capitals. |
| `lines[].id` | `l1`, `l2`, ... in story order. Scene groups and motion code use these ids. |
| `lines[].say` | What the narrator speaks. One or two short sentences, 4 to 12 words, present tense. |
| `lines[].caption` | What is written on screen. The line cut to its core, under about 40 characters. |
| `lines[].clock` | The text in the top strip while this line is on screen. Repeat the value to keep it. Change it at least once, on the line where the pressure rises. |
| `lines[].pause` | Optional. Seconds of silence after the line, for a picture that needs time (a door opening, a phone ringing). Default 0.3. |
| `choice.a`, `choice.b` | One word each, in capitals. |
| `choice.aNote`, `choice.bNote` | Two or three lowercase words that say what the word means here. |
| `choice.question` | Default `WOULD YOU?`. |
| `choice.say` | What the narrator says while the card builds, in four parts, so each word lands when it is spoken. |

Rules for the lines:

- `l1` is the premise. Second person, present tense, 8 words or fewer, so it ends inside 3 seconds.
- Keep the user's own sentences where they already fit. If the paragraph opens with a second-person, present-tense sentence of 8 words or fewer, that sentence is `l1`, word for word.
- One line is one picture. If a line needs two pictures, split it into two lines.
- The last line before the choice leaves the question open. Do not answer it.
- The story is original. See the drawing rules.

### Step 2. Make the voice and timing.json

```bash
node SKILL_DIR/scripts/voice.mjs last-bus
```

- On a Mac this uses the built-in `say` voice. It is free. `--voice Daniel` and `--rate 172` are the defaults. For a story in another language pass a voice of that language (list them with `say -v '?'`).
- `--provider elevenlabs --voice <voice_id>` uses ElevenLabs. It needs `ELEVENLABS_API_KEY` and it costs the user credits. Use it only when the user asks for it.
- `--provider silent` writes silence of an estimated length. Use it when the system has no voice. Tell the user the video has no narration.

The script prints the start and end second of every line and writes `audio/voice.wav` and `timing.json`. It also checks the format and prints a `Warning:` line for each problem: the premise ends after 3 seconds, the clock never changes, a choice is more than one word, a line is on screen for less than 2 seconds. Fix every warning in story.json and run the script again. Run it again after any change to a `say` text.

`timing.json` is the only clock of the episode:

```json
{ "duration": 24.6, "lines": [ { "id": "l1", "start": 0.3, "end": 2.71 }, { "id": "l2", "start": 3.51, "end": 6.4 }, { "id": "choice", "start": 19.2, "end": 19.9 } ] }
```

### Step 3. Copy the template

```bash
cp SKILL_DIR/template/episode.html last-bus/episode.html
```

Read the copy once. You edit two places in it: the scenes (SVG) and the `motion` function. The rest is the engine. From story.json and timing.json the engine already times the scene cuts, the slow zoom of each scene, the captions, the clock and the choice card. Do not time those again and do not edit the engine.

Change the copy with your file-editing tool. The episode stays one HTML file: do not split it into parts and do not write a build script.

### Step 4. Draw the scenes

Inside `<g id="scenes">`, delete the two sample scenes and draw one group per line:

```html
<g class="scene" id="scene-l2" data-caption-y="1400">
  <!-- background first, then things, then people -->
  <g transform="translate(540 1250) scale(1.12) translate(-540 -1250)">
    <g id="l2-man"> ... </g>
  </g>
</g>
```

- The group id is `scene-` plus the line id. The engine shows it from its line's start until the next scene's line starts.
- Give every part that will move its own named group, and start the name with the line id (`l2-man`, `l2-arm`). Ids must be unique in the page.
- Size and place go on an outer group as a `transform`. Motion goes on the named group inside it. Never tween an element that has a `transform` attribute, and never tween or transform a `.scene` group.
- A line may keep the previous scene (draw no group for it) only when the picture clearly changes at that line through motion: someone leaves, a light goes out, a phone lights up.

The stage is 1080 x 1920. One unit is one pixel of the video.

| y | What goes there |
| --- | --- |
| 0 to 182 | Top strip: label and clock. The engine draws it. Keep the area behind it plain. |
| 250 to 1250 | The picture. The main subject lives here and fills it. |
| 1290 to 1500 | Caption band. One flat dark colour behind the words: a counter, a floor, a road, a wall. |
| 1560 to 1920 | Covered by app buttons on phones. Nothing the story needs. |

`data-caption-y` on a scene moves its caption (default 1400, the middle of the caption). `data-zoom` sets the slow zoom (default 1.06, `1` for none).

### Step 5. Write the motion

Replace the body of `function motion({ tl, show, line })` with the motion of your scenes.

```js
const l1 = line('l1'), l2 = line('l2');   // { start, end, next } in seconds, from timing.json

// drop in from above the frame and bounce
show('#l2-bag', l2.start + 1.0);
tl.fromTo('#l2-bag', { y: -1400 }, { y: 0, duration: 0.55, ease: 'bounce.out' }, l2.start + 1.0);
// walk out to the right
tl.to('#l3-man', { x: 900, duration: 1.3, ease: 'power2.in' }, l3.start + 1.4);
// shake: a ringing phone turns a little around its own centre
tl.to('#l4-phone', { rotation: 3, svgOrigin: '290 1680', duration: 0.06, repeat: 40, yoyo: true, ease: 'none' }, l4.start);
// pulse: ring arcs, a warning light
tl.fromTo('#l4-rings', { opacity: 0 }, { opacity: 1, duration: 0.3, repeat: 7, yoyo: true, ease: 'sine.inOut' }, l4.start + 0.1);
// something that lasts the whole scene
tl.fromTo('#l1-road', { x: 0 }, { x: -520, duration: l1.next, ease: 'none' }, 0);
```

Rules. They are what keeps the picture on the voice:

- **Every start second comes from timing.json.** Write it as `line('<id>').start` plus an offset inside that line. `0`, the first frame, is the only bare number allowed. A hand-set second such as `6.4` is not allowed: when the voice is made again, it would drift.
- `line(id).start` is the cut to that line's scene. `.end` is where the narrator stops. `.next` is where the next line starts. `line('choice')` is the choice card.
- **A shape that comes in later needs `show(el, start)`** on the same second as its entrance tween. `show(el, start, end)` hides it before `start` and after `end`.
- Only tweens. No `tl.call`, no `onComplete`, no `Math.random()`, no timers. The renderer jumps to each frame, so only tweened values are drawn.
- Rotation and scale need `svgOrigin: 'x y'`, the point they turn around, in stage units.
- Give every scene one or two moving things besides the zoom: an entrance, a gesture, a light. A scene where nothing moves reads as a slide.

The engine stops with a clear message when a tween has no start second, when a selector matches nothing, or when story.json and timing.json no longer match.

### Step 6. Render check frames and look at them

```bash
node SKILL_DIR/scripts/render.mjs last-bus --frames auto
```

This writes PNG files to `last-bus/out/check/`: the first frame, one frame just after every cut (`-cut`), one in the middle of every line (`-mid`), and the last frame. Read every `Note:` line it prints.

Open every PNG with the Read tool, one at a time, at full size. Do not skip frames and do not judge from the file list. In each frame check:

1. One scene is on screen, and it is the right one for the line.
2. The caption can be read at once. Nothing bright or detailed is behind it.
3. The main subject of the line fills at least a third of the picture area.
4. Nothing is in the frame that has not arrived yet. Compare each `-cut` frame with the offsets in your motion code.
5. No text is cut by the edge of its box or of the frame.
6. The clock shows the value story.json gives for this line.
7. The first frame already shows the place and the main subject.
8. The last frame shows the question, both words, both notes and COMMENT ONE WORD.

### Step 7. Fix and check again

Fix what you saw. Use the list below. Then render the frames again and look again. For one moment you can ask for exact seconds: `--frames 6.5,7.2`. Repeat until every frame passes all eight checks. Looking once is not enough: a fix often moves the problem.

### Step 8. Render the video

```bash
node SKILL_DIR/scripts/render.mjs last-bus
```

It prints a progress line every 150 frames and ends with the frame count and the seconds it took. The file is `last-bus/out/episode.mp4`. `--out name.mp4` changes the name. `--width`, `--height` and `--fps` change the size and frame rate (default 1080 x 1920, 30). Then confirm the file has picture and sound:

```bash
ffprobe -v error -show_entries stream=codec_type:format=duration -of default=nw=1 last-bus/out/episode.mp4
```

### Step 9. Report

Tell the user: the path of the MP4, its length, the premise, the two words, anything you invented, and any warning you could not remove.

## Known failures and fixes

These four happened in the first episode made this way. Look for them in every check frame.

1. **A shape is visible before its entrance animation starts.** You see it in a `-cut` frame: something that should arrive later is already there, often hanging in a strange place. In the first episode a bag hung in front of a man's face for a second before it dropped. Cause: a tween puts its shape at the starting position from second 0, and that position was inside the frame. Fix: hide it until its start with `show('#l2-bag', l2.start + 1.0)` on the same second as the tween, and start the entrance outside the frame (`y: -1400`, not `y: -400`).
2. **A caption is placed over a busy area.** The words lie across shelves, windows, a face or bright shapes. Fix: move the caption to a calm band. Set `data-caption-y` on that scene to a y where the background is one flat dark colour, or redraw the scene so y 1290 to 1500 is calm. Do not make the caption smaller to fit between things.
3. **The main subject is too small in the frame.** The thing the line is about sits lost under an empty sky or floor. Fix: scale its group up from its base point with an outer group, `<g transform="translate(540 1240) scale(1.28) translate(-540 -1240)">`, then check that it still clears the top strip and the caption band.
4. **Text runs off its container.** A sign, a label or a line of text is cut by the edge of its box or of the frame. Fix: a smaller font or shorter lines. The engine wraps captions and shrinks the title and the choice words. Text you draw yourself is yours to fit. When the renderer prints a `Note:` about a caption with more than three rows, shorten that caption in story.json.

## Drawing rules

- **Flat shapes.** `rect`, `circle`, `ellipse`, `polygon` and `path` with solid fills. Gradients only for sky and light, three at most. No filters, no blur, no drop shadows, no outlines around everything, no photos, no image files, no web fonts.
- **Limited palette.** About eight colours for the whole episode: three darks for the space, one warm light, one alarm colour, skin, and one or two object colours. The template's night palette is a good start: `#060a1c` `#131f47` `#26376e` (sky), `#0a1022` `#0e1530` `#141d40` (ground and walls), `#f6c56a` `#ffd27a` (light), `#d8432e` `#ff5a45` (alarm), `#d9ad8c` `#c79a7a` (skin). Green `#3ddc84` belongs to the choice card.
- **At least one human face per episode**, large enough to read on a phone (head 150 units wide or more): an ellipse, two dots for eyes, two short strokes for brows, one stroke for the mouth. The brows carry the feeling.
- **No text baked into drawings, except signs**: a shop sign, a door number, a caller name on a phone. The words of the story live in the captions.
- **Nothing copied.** No existing characters, logos or brands, and no retelling of a film, a show, a book or another creator's episode. If the user's paragraph is one, say so and write a new story in the same spirit.
- **The first frame is the cover.** The place and the main subject are in the frame at second 0. Do not open on an empty stage.
- **CSS wins over SVG attributes.** Text you draw takes the page font. To colour one text differently from its class, use `style="fill:#ff5a45"`, not `fill="..."`.

## Output checklist

Before you report, every line must be true:

- story.json has 5 to 7 lines, `l1` is a second-person present-tense premise, and the choice is two single words.
- voice.mjs printed no warning, or you told the user which one stayed and why.
- The clock changes at least once, and the check frames show it.
- Every line has its scene and its caption, and at least one scene shows a human face.
- Every start second in `motion` is built from `line(id).start`. There is no hand-set second.
- You looked at every check frame at full size after the last change, and none shows one of the four known failures.
- The MP4 exists, ffprobe lists a video and an audio stream, and its length matches `duration` in timing.json.
