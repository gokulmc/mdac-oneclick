---
title: MDAC One-Click privacy policy
---

# Privacy policy

_Last updated: 22 October 2026_

MDAC One-Click is a Chrome extension that fills the Malaysia Digital Arrival Card (MDAC) form on `imigresen-online.imi.gov.my` with traveller details you save in the extension.

## What it stores

The travellers you add (name, passport number, date of birth, nationality, place of birth, sex, passport expiry, email, mobile number) and the trip presets you add (travel mode, transport number, port of embarkation, accommodation address). Travel dates are never stored.

All of it is kept in `chrome.storage.local` in your own browser profile. It is not synced to your Google account and it is never sent to the developer or any third party.

## Where your data goes

Only into the MDAC register form on `https://imigresen-online.imi.gov.my/mdac/`, and only when you press **Fill**. Submitting that form to the Immigration Department of Malaysia is your action: the extension never submits it for you, and never interacts with the form's verification slider.

The extension has no server, no analytics, no tracking and no remote code. Its only host permission is `https://imigresen-online.imi.gov.my/mdac/*`.

## Scanning a confirmation email

If you use **Scan a confirmation email**, the screenshots you choose are read by an OCR engine (Tesseract, shipped inside the extension as WebAssembly) on your own device. The images and the text read from them are kept only in memory while you review them and are discarded afterwards; only the traveller and trip-preset fields you choose to save are stored, locally, like any other entry. Nothing is uploaded.

## Your control

- Edit or delete any traveller or preset on the extension's options page.
- **Backup & import → Delete everything** removes all saved data.
- Removing the extension removes all of its data.
- An exported backup file contains your passport details in plain text. Keep it somewhere safe.

## Not affiliated

MDAC One-Click is an independent open-source project. It is not made, endorsed or operated by the Immigration Department of Malaysia or any government. The official MDAC service is free at `imigresen-online.imi.gov.my`.

## Contact

Open an issue at https://github.com/gokulmc/mdac-oneclick/issues.
