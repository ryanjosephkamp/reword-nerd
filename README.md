# reword_nerd

Rewrite documents and regenerate images with the AI model you already use.

reword_nerd reads your files in the browser, lets you check what it read, and then hands the
job to Claude Code, Codex, ChatGPT, Grok Imagine, or any other model in as few pastes as
possible. There is no server and no account; your files never leave your browser.

**Try it:** <https://ryanjosephkamp.github.io/reword-nerd/preview/>

## How it works

1. **Add** documents (Word, PDF, Markdown, HTML, LaTeX, plain text, CSV, JSON, YAML, and most
   code), a folder or ZIP project, or images.
2. **Check** the text that was read. Fix mistakes, accept text found in scanned pages, and
   choose which files take part. Dependency folders, build output, and files that look like
   credentials are left out on their own.
3. **Set** the goal, tone, length, and language. For images, say what should change and what
   must stay.
4. **Hand off** to where the work will run:
   - **Coding agents** (Claude Code, Codex, Gemini CLI): download a task folder and paste one
     command. The agent works through all four stages and writes the results in the original
     format, Word files included.
   - **Chat apps** (ChatGPT, Claude, Gemini, Grok): copy one prompt. A step-by-step mode with
     four prompts is there for long or delicate documents.
   - **Image tools** (Grok Imagine, ChatGPT, Gemini, Midjourney): attach the image and paste its
     prompt, or give Codex a folder of images to do in one go.
5. **Bring it back** if you like: paste the reply or drop the agent's finished folder to see a
   word-by-word comparison, the model's own check, and a download in the original format.

Every rewrite follows four stages: **Decompose** the meaning, **Rewrite** it in new words,
**Verify** that nothing was lost or added, and produce the **Final** version.

## Privacy

reword_nerd is a static web page. Files are read on your device, and nothing is sent anywhere
unless you copy it or download it. Saving your workspace between visits is off until you turn it
on, and then it stays in your browser. You can export the workspace as a ZIP at any time.

## Development

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

| Command         | What it does                                         |
| --------------- | ---------------------------------------------------- |
| `npm run check` | Lint, format check, typecheck, unit tests, and build |
| `npm test`      | Unit tests                                           |
| `npm run e2e`   | Browser tests on desktop and phone sizes             |
| `npm run build` | Builds the landing page, the app, and Updates        |

The landing page is `index.html`, the app is `app/index.html` (`src/app/`), and everything that
reads files, writes prompts, and builds task folders lives in `src/engine/`.

## License

[MIT](LICENSE)
