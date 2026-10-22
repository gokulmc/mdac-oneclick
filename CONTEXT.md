# MDAC One-Click

A Chrome extension that fills the Malaysia Digital Arrival Card form from saved traveller data, so a traveller only has to pass the site's human check and press Submit.

## Language

### The form

**MDAC**:
The Malaysia Digital Arrival Card — the per-entry declaration every non-exempt foreign visitor files on the Immigration Department site within 3 days before arrival.
_Avoid_: arrival card, e-arrival, visa

**Register form**:
The official MDAC registration page with its 21 required fields, split into Personal information and Travelling information.
_Avoid_: application, the site

**Verification slider**:
The "Drag To Verify" human check that sits between the Register form's fields and its Submit button.
_Avoid_: captcha, bot check

**Confirmation**:
The MDAC site's acknowledgement after a successful Submit, also emailed to the traveller; proof the traveller shows at the border.
_Avoid_: receipt, PIN, ticket

### Saved data

**Traveller**:
One person's passport-side details — name, passport number, date of birth, nationality, place of birth, sex, passport expiry, email, dial code, mobile — stable across trips.
_Avoid_: profile, user, person, passenger

**Trip preset**:
A reusable set of travel-side details — mode of travel, transport number, last port of embarkation, accommodation type, address, state, postcode, city — for a journey the traveller makes repeatedly.
_Avoid_: template, itinerary, trip, profile

**Seeded preset**:
A Trip preset that ships with the extension as a starting point (e.g. "Drive via Causeway from Singapore"); editable and deletable like any other.
_Avoid_: default, sample, example

**Travel dates**:
The arrival and departure dates for the specific journey being filed, entered at fill time and never stored in a Trip preset.
_Avoid_: trip dates, itinerary dates

### The action

**Fill**:
The one click: writing one Traveller, one Trip preset and the Travel dates into every field of the Register form, then scrolling to the Verification slider.
_Avoid_: autofill, submit, register, apply

**Hand-off**:
The moment after a Fill when control returns to the traveller to drag the Verification slider and press Submit; the extension never performs either.
_Avoid_: auto-submit, one-click submit

**Run**:
One Fill for a chosen set of Travellers sharing a Trip preset and Travel dates; with several Travellers it becomes a Queue.
_Avoid_: batch, session, job

**Queue**:
A Run with more than one Traveller: after each Confirmation the extension opens a fresh Register form and Fills the next Traveller.
_Avoid_: family mode, bulk, multi-submit

## Relationships

- A **Run** uses exactly one **Trip preset**, one pair of **Travel dates** and one or more **Travellers**
- A **Queue** produces one **Confirmation** per **Traveller**, each gated by its own **Hand-off**
- A **Traveller** is never bound to a **Trip preset**; any Traveller can be Filled with any preset
- A **Seeded preset** is a **Trip preset** with no owner; editing it makes it an ordinary Trip preset

## Example dialogue

> **Dev:** "When the user clicks **Fill**, do we also press Submit?"
> **Domain expert:** "No. **Fill** ends at the **Verification slider**; the **Hand-off** is the traveller's. We never touch the slider or Submit."
>
> **Dev:** "A family of four drives to JB — four **Trip presets**?"
> **Domain expert:** "One **Trip preset**, four **Travellers**, one pair of **Travel dates**. That's a **Queue**: after each **Confirmation** we open a fresh **Register form** and fill the next **Traveller**."
>
> **Dev:** "Can a **Trip preset** remember last month's dates?"
> **Domain expert:** "Never. **Travel dates** are typed per **Run**; the MDAC only accepts them within three days of arrival anyway."

## Flagged ambiguities

- "profile" was used for both the person and the journey — resolved: **Traveller** (person) and **Trip preset** (journey) are distinct; "profile" is not used.
- "submit in a single click" was read as automating Submit — resolved: the single click is the **Fill**; Submit stays with the traveller (**Hand-off**).
- "local web app" was floated as a second place to save Travellers — resolved: there is no web app; the extension's options page is the only editor.
