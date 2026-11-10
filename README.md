# Case Study Machine

Paste a product management case study prompt, add the data, and get back:

- a deck to present, saved to your Google Drive as Google Slides (or downloaded as `.pptx`)
- prep notes that explain what was done, the calls that were made, the weak spots, and the questions you are likely to be asked

Part of the JobBoard / ResumeMachine family. Static site, no build step, no server.

## Three ways to run it

| Way | Cost | What you do |
|---|---|---|
| **In a Claude chat** (the default on the site) | Included in a Claude plan | The site gives you a brief to paste into Claude along with your data files. Claude replies with a file; you open it on the site, which draws the slides and saves them to Google Drive. |
| **In Claude Code** | Included in a Claude plan | Open this repository in Claude Code, share the prompt and data, and ask it to run the case study. It follows the same playbook and writes Google Slides and a Google Doc directly, if your Google connectors are on. |
| **Automatically, with an API key** | Billed per run to an Anthropic API key | The site does everything in one click and shows each calculation with its code. |

All three follow [`playbook.md`](playbook.md) and produce the same kind of deck, drawn by the same code.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `playbook.md` | The method. Sent to the model as-is; edit this to change how the machine thinks or writes |
| `js/app.js` | Reads files, talks to Claude, runs calculations, saves to Google Drive |
| `oauth.html` | The small page Google returns to after sign-in |
| `js/render.js` | Turns a deck description into slides (preview and `.pptx`) |
| `vendor/` | Third-party libraries, copied in so the site has no build step: PptxGenJS 3.12.0, SheetJS 0.18.5, marked 12.0.2 |
| `.claude/skills/case-study/` | Instructions for running the method inside Claude Code |
| `tools/build.mjs` | Optional: build a `.pptx` from a saved run on the command line |

## Preview locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` as a file will not work, because the page has to fetch `playbook.md`.

## Google sign-in setup

"Save to Google Drive" creates a Google Slides deck and a Google Doc in your own Drive. Google requires every site that does this to register once and get a client ID. It is free and takes about ten minutes. The client ID is not a secret.

1. Go to https://console.cloud.google.com/ and create a project (any name, for example "Case Study Machine").
2. In the search bar, find **Google Drive API** and click **Enable**.
3. Open **APIs & Services**, then **OAuth consent screen** (Google sometimes labels this "Google Auth Platform"). Choose **External**, give it an app name and your email, and save.
4. On the **Data access** (or **Scopes**) step, add the scope `https://www.googleapis.com/auth/drive.file`. This lets the site see only the files it creates.
5. On the **Audience** (or **Test users**) step, add your own Google address as a test user. While the app is in "Testing", only test users can sign in, and Google shows them an "unverified app" notice once.
6. Open **Credentials** (or **Clients**), click **Create credentials**, **OAuth client ID**, type **Web application**. Add:
   - Authorized JavaScript origins: `https://peterselj.github.io` and `http://localhost:8000`
   - Authorized redirect URIs: `https://peterselj.github.io/casestudymachine/oauth.html` and `http://localhost:8000/oauth.html`
7. Copy the client ID (it ends in `.apps.googleusercontent.com`). Either paste it into the page when it asks, or put it in `GOOGLE_CLIENT_ID` near the top of `js/app.js` so every visitor gets it.

Google renames these screens from time to time; the pieces to find are always the same four: enable the Drive API, set up the consent screen, add the scope, create a Web client ID.

## Status

Early. The deck renderer, file reading and the tool loop are tested against a simulated API. The first real deck was produced by running the playbook by hand in Claude Code. Neither the chat route nor the API-key route has been run end to end with a real model yet, and Google sign-in has only been tested against a simulated Google.

No worked examples are stored in this repository, on purpose: real case study prompts and data belong to the companies that sent them. Use "Save this run" to keep your own.
