# Claude video skills · Zero Edit

Free skills for Claude Code from the [Zero Edit](https://www.youtube.com/@zeroedithq) videos.

Each folder is one skill. You describe what you want in plain English; Claude writes the code and renders the video. No camera, no editing software.

| Skill | What it makes |
|---|---|
| [`you-decide-story`](you-decide-story/) | A vertical "you decide" story video (1080 x 1920 MP4): drawn scenes, a narrator, captions timed to the voice, a clock, and a two-word choice at the end. |

**Free bonus:** the [story starter pack](https://zeroedithq.kit.com/c2b12dc3a3) has 3 finished episodes as code, the paragraphs behind them and 30 story premises. Enter your email, get the files.

**Season Kit:** turn one episode into a 7-part series. Your viewers vote at the end of every part, and the next part opens with the word that won. The kit adds the season skill, reusable characters, a frame checker, covers and post text, and 90 new premises. One-time $29 at [zeroedit.batollc.com](https://zeroedit.batollc.com).

## Quick start

1. Install [Claude Code](https://code.claude.com/docs/en/setup). It runs on a paid Claude plan.
   - Mac / Linux: `curl -fsSL https://claude.ai/install.sh | bash`
   - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
2. Have Node.js 22 or newer and ffmpeg on your computer. Both are free.
3. Download this repository (the green **Code** button, then **Download ZIP**). Make a folder for your videos and copy the skill folder into it, under `.claude/skills/`:

   ```
   my-stories/.claude/skills/you-decide-story/
   ```
4. Start Claude Code in that folder and describe your story in one paragraph:

   ```
   Use the you-decide-story skill. You drive the last bus of the night. It is 11:58 PM
   and the bus is empty. A man waves you down on a dark road where there is no stop.
   He is holding something under his coat. The clock turns midnight.
   The choice at the end: STOP or DRIVE.
   ```

Claude checks your tools, installs the two packages it needs (GSAP and Playwright), writes the story, makes the voice, draws the scenes, looks at check frames, fixes what is wrong and renders the video. In a test from a folder that held nothing but the skill, this took 5 minutes 42 seconds.

The voice is the Mac's built-in one by default and costs nothing. ElevenLabs works with your own key. Details are in each skill's README.

## License

MIT. See [LICENSE](LICENSE). GSAP and Playwright are installed from npm under their own licenses.
