# MDAC One-Click

A Chrome extension that fills the **Malaysia Digital Arrival Card (MDAC)** form from saved travellers in one click.

Save each traveller's passport details once, and save a few **trip presets** (how you travel, where you stay). Then on any trip:

1. Click the toolbar icon. Pick who's travelling, a preset and the dates.
2. Press **Fill MDAC**. The official form opens (or is reused) and every field fills in about 1–2 seconds.
3. Check the form, complete the "Drag To Verify" slider, and press **Submit** yourself.

For a family, tick several travellers. After each confirmation the next person's form fills automatically.

> **What it will never do:** submit the form, or touch the verification slider. Those steps stay with you, by design ([ADR 0001](docs/adr/0001-hand-off-at-verification-slider.md)). The MDAC can't be edited after submission, so the review pause matters.

Independent open-source project, not affiliated with the Immigration Department of Malaysia. The official MDAC is free at <https://imigresen-online.imi.gov.my/mdac/main>. Never pay a website to file it.

## Install

- **Chrome Web Store:** _listing pending review_.
- **From source:** download the latest `mdac-oneclick-<version>.zip` from [Releases](https://github.com/gokulmc/mdac-oneclick/releases) and unzip it. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped folder.
- **Updating:** from v0.2.3 on, every release has the same extension ID (pinned by the manifest `key`), so your saved travellers and presets carry over whichever folder you unzip it to. Load the new folder, then remove the old copy. Before v0.2.3 the ID followed the folder, so a new folder started empty: if you are on 0.2.2 or older, use **Settings → Backup & import → Export** first, then **Import** the file into 0.2.3.
- Keep the unzipped folder outside iCloud/Drive-synced folders if you can: Chrome reads the extension from that folder every time it starts.

## Scan a past confirmation email instead of typing

If you have filed an MDAC before, the confirmation email the Immigration Department sent already holds every field. In the extension's settings, open **Scan a confirmation email**, drop in a screenshot of that email (two screenshots if it doesn't fit on one phone screen) and review what was read. One click saves a Traveller and a Trip preset. Place of birth isn't in the email, so it's prefilled with your nationality and flagged for you to check.

### How the scan works, and what happens to your data

- **A local OCR model, not an AI service.** The reader is Tesseract (the open-source OCR engine, Apache-2.0) compiled to WebAssembly, with its English model file, all shipped inside the extension (about 7 MB). There is no language model, no API key, no server and no account. It works with the network cable unplugged, and the end-to-end tests fail if a single request leaves `chrome-extension://`.
- **Where the pixels go.** The screenshot is decoded in the extension's settings page, handed to a Web Worker inside the extension, and comes back as words with positions and confidences. A rule-based parser then maps those words to the form's fields by the email's layout. Screenshots and the raw text are held in memory only while you review, then discarded; nothing is written to disk until you press Save, and only the fields you save are stored.
- **Nothing is guessed silently.** Every field shows where it came from: **Read** (exact, high-confidence), **Unsure** (low confidence, a repaired character such as O→0, or an ambiguous match — always with the crop it was read from), **Missing**, **From saved** (kept from your existing traveller) or **Edited** (you changed it). A reading never overwrites a saved value unless it was read with confidence; the inferred place of birth never overwrites a saved one; the PIN is shown but never stored.
- **You are the last check.** Nothing is saved until you press Save on the review screen, and the official MDAC form is still filled from what you saved and submitted by you.

Yellow fields are the ones to double-check; the crop they came from is shown next to them.

## Privacy

Everything is stored in `chrome.storage.local` in your browser. It is not synced and not sent anywhere except into the MDAC form when you press Fill. Screenshots you scan are read in memory on this device and discarded. No analytics, no server. Full policy: [docs/privacy.md](docs/privacy.md).

## Trip presets included

Starting points for common journeys from Singapore. Edit the address to where you'll actually stay; the popup reminds you until you do.

| Preset | Mode | Destination |
|---|---|---|
| Drive via Causeway → Johor Bahru | Land | Johor Bahru, Johor |
| Bus via Causeway → Johor Bahru | Land (CW2) | Johor Bahru, Johor |
| Fly Singapore → Kuala Lumpur | Air | Kuala Lumpur |
| Coach Singapore → Melaka | Land | Melaka |
| Fly Singapore → Penang | Air | George Town, Penang |
| Stay with family in Kuala Lumpur | Air | Kuala Lumpur (friends/relatives) |

## Who needs an MDAC

Most foreign visitors entering Malaysia by air, land or sea need one, filed within 3 days before arrival. Singapore citizens are exempt; Singapore PRs and work-pass holders are not, unless they hold a Malaysian long-term pass. Rules change: check the official site.

## Development

```sh
pnpm install
pnpm build          # → dist/ (load unpacked from here)
pnpm test           # unit tests (Vitest)
pnpm test:e2e       # builds, then Playwright drives the extension against a local fixture of the form
pnpm qc             # visual QC screenshots → test-results/qc/
pnpm zip            # → release/mdac-oneclick-<version>.zip for the Web Store
```

- `src/domain/`: the fill plan, checks, the queue state machine, saved-data import/export. Pure and unit-tested.
- `src/page/fill.ts`: injected into the form page (main world) to write the plan and verify it.
- `src/page/watcher.ts`: content script that reports which MDAC page is showing and when you submit.
- `src/background/`: runs the Queue across page loads.
- `src/reference/data.json`: the form's own code lists (countries, dial codes, states, 509 cities), regenerated with `pnpm reference <saved register page.html>` plus `reference/cities.txt`.
- `src/domain/scan.ts`: turns OCR words of a confirmation-email screenshot into a draft Traveller + Trip preset by geometry (two columns, row pitch), then normalises each value to form codes. `src/options/ocr.ts` wraps tesseract.js; `scripts/ocr-fixture.mjs` regenerates the golden OCR output (`tests/fixtures/*.words.json`) from the committed fixture PNGs through the built extension, so unit tests run on real OCR output without WASM.
- The OCR engine adds ~7 MB to the package (`dist/ocr/`, copied from node_modules at build time; see `THIRD_PARTY_NOTICES.md`).
- `CONTEXT.md`: the project's vocabulary. `docs/adr/`: decisions.

The e2e tests run against a hand-written fixture that reproduces the form's contract (field ids, option codes, AJAX lookups, datepicker limits), because the live site blocks headless browsers. The fill itself was verified against the live form with dummy data on 2026-10-22, without submitting.

### Known gaps

- **Confirmation detection is unverified.** The Queue advances when the page after Submit contains confirmation wording (English or Malay). That page has not been observed yet; if it doesn't match, use **Skip** in the popup to move on. Please open an issue with the page text (redact your details).
- The form's code lists were captured on 2026-10-22. If MDAC changes a code, the fill reports which field it couldn't set.

## License

MIT
