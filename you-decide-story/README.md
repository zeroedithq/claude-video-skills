# you-decide-story

A skill for Claude Code. You write one paragraph. Claude turns it into a vertical story video (1080 x 1920 MP4) drawn entirely in code: inline SVG scenes, a narrator, captions timed to the voice, a clock at the top, and a two-word choice at the end.

No camera, no image generator, no editing app. Every frame is a web page that a script photographs.

## What you get

- `SKILL.md`: the format (four parts), the steps Claude follows, the known failures and their fixes.
- `template/episode.html`: the stage, with the top strip, the captions and the choice card already in place.
- `scripts/voice.mjs`: reads the story, makes the narrator audio and the timing file.
- `scripts/render.mjs`: renders check frames and the final video.

## Requirements

- Claude Code
- Node.js 22 or newer
- ffmpeg on your PATH
- A voice. On a Mac the built-in `say` voice is used and costs nothing. ElevenLabs works with your own API key. Without either, `--provider silent` gives a video with captions and no narration.

In the folder where you will make your videos:

```bash
npm install gsap playwright
npx playwright install chromium
```

## Install the skill

Pick one:

1. **For all your projects.** Copy the `you-decide-story` folder to `~/.claude/skills/you-decide-story/`.
2. **For one project.** Copy it to `.claude/skills/you-decide-story/` inside that project.
3. **No install.** Keep the folder anywhere in your project and start your prompt with: `Read you-decide-story/SKILL.md and follow it.`

## Use it

Open Claude Code in your project folder and describe the story. Say where you are, what time it is, who arrives, and the two words at the end:

```
Use the you-decide-story skill. You drive the last bus of the night. It is 11:58 PM
and the bus is empty. A man waves you down on a dark road where there is no stop.
He is holding something under his coat. The clock turns midnight.
The choice at the end: STOP or DRIVE.
```

Claude writes `story.json`, makes the voice, draws the scenes, renders check frames, looks at them, fixes what is wrong, and renders `out/episode.mp4`.

## Run the scripts yourself

```bash
node you-decide-story/scripts/voice.mjs last-bus                   # audio + timing.json
node you-decide-story/scripts/render.mjs last-bus --frames auto    # check frames in last-bus/out/check/
node you-decide-story/scripts/render.mjs last-bus                  # last-bus/out/episode.mp4
```

Both scripts print their options with `--help`.

## License

MIT. See `LICENSE`. GSAP and Playwright are installed from npm under their own licenses.
