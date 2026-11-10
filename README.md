# Case Study Machine

Paste a product management case study prompt, add the data, and get back:

- a deck to present (downloads as `.pptx`, opens in Google Slides)
- prep notes that explain what was done, the calls that were made, the weak spots, and the questions you are likely to be asked

Part of the JobBoard / ResumeMachine family. Static site, no build step, no server.

## How it works

1. You paste the prompt, drop in CSV or Excel files, and add your own first thoughts.
2. The page sends the prompt, your notes and a sample of the data to Claude, with [`playbook.md`](playbook.md) as its instructions. You supply your own Anthropic API key; it goes from your browser straight to Anthropic.
3. Claude asks for calculations. Each one runs in your browser against the full data and is listed on the page with its code, so you can see where every number came from.
4. Claude hands back a deck and prep notes. The page draws the deck, and the same drawing code writes the `.pptx`.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `playbook.md` | The method. Sent to the model as-is; edit this to change how the machine thinks or writes |
| `js/app.js` | Reads files, talks to Claude, runs calculations |
| `js/render.js` | Turns a deck description into slides (preview and `.pptx`) |
| `vendor/` | Third-party libraries, copied in so the site has no build step: PptxGenJS 3.12.0, SheetJS 0.18.5, marked 12.0.2 |
| `tools/build.mjs` | Optional: build a `.pptx` from a saved run on the command line |

## Preview locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` as a file will not work, because the page has to fetch `playbook.md`.

## Status

Early. The deck renderer, file reading and the tool loop are tested against a simulated API. The first real deck was produced by running the playbook by hand in Claude Code. The page has not yet been run end to end with a real API key.

No worked examples are stored in this repository, on purpose: real case study prompts and data belong to the companies that sent them. Use "Save this run" to keep your own.
