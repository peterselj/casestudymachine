---
name: case-study
description: Turn a product management case study prompt plus data into a Google Slides deck and a Google Doc of prep notes, following playbook.md. Use when the user shares a case study assignment, take-home prompt, or asks to "run the machine".
---

# Run Case Study Machine in Claude Code

This runs the same method as the website, on the user's Claude subscription, and writes the results straight to their Google Drive.

1. Read `playbook.md` in the repository root and follow it. Two differences from the website:
   - There is no `run_analysis` tool. Do every calculation with real code (Python or Node) against the data. Never estimate numbers.
   - There is no `deliver` tool. Write the result to a file instead (step 4).
2. Get the inputs. The user may paste the prompt, link a Google Doc, or link a Google Sheet. Read linked files with the Google connectors. Ask for the user's own first thoughts if they did not give any, but do not block on it.
3. Keep everything about the case out of the repository. Real prompts, company data and finished decks must never be committed. Work in the scratchpad directory.
4. Write `run.json` in the scratchpad: `{ "deck": {...}, "prep_markdown": "..." }`, in the playbook's deck format.
5. Build and check it:
   ```bash
   npm install --prefix <scratchpad> pptxgenjs
   cd <scratchpad> && node <repo>/tools/build.mjs run.json deck.pptx --prep prep.html
   ```
   The script lists any format problems; fix them and rerun. Then look at the slides before uploading: convert `deck.pptx` to images (LibreOffice, if installed) and read them, and fix anything that overflows or looks wrong.
6. Upload both to the user's Google Drive with the Drive connector's create-file tool, letting Drive convert them: `deck.pptx` becomes Google Slides, `prep.html` becomes a Google Doc. Give the user both links.
7. Tell the user, briefly: the recommendation, the runner-up, and every "NOTE TO SELF" they must check before presenting. Mention that `run.json` can be opened on the website to preview or re-export.

If the Google connectors are not available, give the user `deck.pptx` and `prep.html` as files and say why.
