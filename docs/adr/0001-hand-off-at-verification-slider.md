---
status: accepted
date: 2026-10-22
---

# Fill stops at the verification slider; the extension never submits

The MDAC register form puts a "Drag To Verify" human check between its fields and the Submit button. The original ask was "submit in a single click". We decided that the single click is the **Fill** — every field written, page scrolled to the slider — and that dragging the slider and pressing Submit stay with the traveller (the **Hand-off**). The extension never reads, moves, satisfies or bypasses the slider, and never clicks Submit.

## Considered options

1. **Fill and hand off** (chosen). Two gestures per traveller: one click, one drag+Submit.
2. **Fill, then auto-click Submit once the traveller completes the drag.** Saves one click but removes the review pause before a submission that cannot be edited, and the extension would have to observe the verification widget's state.
3. **Satisfy the slider programmatically.** True one click. Rejected outright: it circumvents a human-verification control on a government system, would not pass Chrome Web Store review (a comparable extension was delisted in Sept 2025), and exposes users to account/entry risk.

## Consequences

- A family of four is four Fills and four drags; the **Queue** only removes the navigation and re-selection between them.
- Any future "make it faster" work must stay on the Fill side (fewer fields to type, better presets), not on the Hand-off side.
- The Web Store listing and README state this limit plainly so users don't expect auto-submit.
