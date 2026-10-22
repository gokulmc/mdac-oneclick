# Chrome Web Store listing — MDAC One-Click

**Name:** MDAC One-Click
**Category:** Productivity → Tools (or Travel)
**Language:** English

## Short description (≤132 chars)
Fill Malaysia's Digital Arrival Card from saved travellers in one click. You complete the slider and submit yourself.

## Description
Filing the Malaysia Digital Arrival Card (MDAC) means typing 21 fields for every person, every trip. MDAC One-Click remembers them.

• Save each traveller's passport details once.
• Save trip presets: how you travel and where you stay (presets for the Causeway, KL, Melaka and Penang are included to start from).
• On the day: click the icon, pick who's travelling and the dates, press Fill. The official form fills in about 2 seconds.
• Families: tick several travellers and each form fills automatically after the previous one is confirmed.
• Warnings before you file: arrival outside the 3-day window, a passport expiring within 6 months, addresses the form will reject.

You stay in control: the extension never submits the form and never touches the "Drag To Verify" slider. Check the details, complete the slider and press Submit yourself.

Private by design: your data stays in this browser (chrome.storage.local). No account, no server, no analytics. It is only ever written into the official MDAC form on imigresen-online.imi.gov.my.

Independent, open-source project (MIT), not affiliated with the Immigration Department of Malaysia. The MDAC itself is free on the official site; never pay a third-party website to file it.

Source: https://github.com/gokulmc/mdac-oneclick

## Single purpose
Fill the official Malaysia Digital Arrival Card registration form with traveller details the user saved in the extension.

## Permission justifications
- **storage**: keeps the user's saved travellers and trip presets in chrome.storage.local, and the in-progress family queue in chrome.storage.session.
- **scripting**: writes the saved details into the MDAC register form when the user presses Fill.
- **Host permission imigresen-online.imi.gov.my/mdac/***: the only site the extension works on; needed to fill the form and to know when a registration was confirmed so the next family member's form can be filled.
- **Remote code:** none. All code ships in the package.

## Data usage disclosures
- Collects: Personally identifiable information (name, passport number, date of birth, email, phone) — stored locally only, entered by the user, used solely to fill the MDAC form.
- Not sold, not transferred to third parties, not used for unrelated purposes or creditworthiness.

## Privacy policy URL
https://gokulmc.github.io/mdac-oneclick/privacy (from docs/privacy.md via GitHub Pages)

## Assets
- Icon 128×128: dist/icons/128.png
- Screenshots 1280×800: store/screenshots/*.png (made from the QC run with dummy data; never show the government crest prominently)
- Small promo tile 440×280: store/promo-440x280.png
