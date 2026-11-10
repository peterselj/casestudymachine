# Case Study Machine

Static GitHub Pages site (no build step) that turns a product management case study prompt plus data into a presentable deck and prep notes. Sibling of ResumeMachine and JobBoard.

## Workflow

- Never commit directly to `main`. Work on a branch, open a pull request, and let the owner review and merge.
- Keep each PR to one idea.
- The owner is a novice developer: explain changes in plain language.
- Never commit real case study prompts, company data, or finished decks. They belong to the companies that sent them. Test with made-up data.

## Files

- `playbook.md` is the product. It is sent to the model verbatim as the system prompt and is also meant to be read by people. The "Deck format" section must match what `js/render.js` accepts; change both together and bump the version line.
- `js/render.js` lays out slides once and draws them twice (SVG preview, `.pptx`). New slide types go in `BUILDERS`, get a check in `validate`, and a row in the playbook table.
- `js/app.js` is the page logic and the only place that calls the Anthropic API (raw `fetch`, because there is no build step). Tools: `run_analysis` (runs model-written JavaScript in a Web Worker against the user's data) and `deliver`.
- There are three ways to run the method, and all must keep working: a Claude chat (the page copies a brief, the user pastes back `case-study-run.json`), Claude Code (`.claude/skills/case-study/`), and the API key route. The owner uses the first two because they are covered by a Claude subscription.
- Google Drive saving uses a hand-written OAuth pop-up (no Google script): the page opens Google sign-in, Google returns to `oauth.html`, which passes the token back. The only scope is `drive.file`. If the site moves to another address, the redirect URI registered with Google must change too.
- `vendor/` holds pinned third-party libraries. Don't load scripts from a CDN.

## Deck style

Decks should look like a capable person made them in an afternoon in Google Slides: white, Arial, one accent colour, sentence titles that state the takeaway. No small labels above titles, no icons, no gradients. Charts and mockups are drawn from plain shapes so they stay editable after import.

## Site style

Matches JobBoard: Hanken Grotesk + IBM Plex Mono, forest green (`#234c3a`) on warm paper (`#f3f3ee`), white cards with 12px radius, 6px-radius buttons. Colours are CSS variables at the top of `index.html`, with a dark-mode set; change both together. Check layout at 390px wide with no horizontal scroll.

## Preview locally

`python3 -m http.server 8000`, then open http://localhost:8000.

To render a saved run to `.pptx` without the browser: `npm install pptxgenjs` somewhere, then `node tools/build.mjs run.json out.pptx`.
