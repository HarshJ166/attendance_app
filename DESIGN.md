---
name: GeoMark
tokens:
  color.present: "#0B6B4B"
  color.present-pressed: "#08533A"
  color.present-tint: "#E3F1EA"
  color.ink: "#15201B"
  color.muted: "#52615A"
  color.bg: "#F7F8F6"
  color.surface: "#FFFFFF"
  color.line: "#D9E0DC"
  color.warn: "#8A4B00"
  color.warn-tint: "#FFF1D6"
  color.danger: "#B3261E"
  color.danger-tint: "#FDE7E5"
  font.display: "Anek Latin"
  font.body: "Source Sans 3"
  font.mono: "JetBrains Mono"
  size.body: 18
  size.small: 16
  size.button: 20
  size.status: 32
  size.time: 44
  touch.min: 56
  button.height: 64
  radius: 12
  space: [4, 8, 12, 16, 24, 32, 48]
---

# GeoMark Design System

## Product feeling
"Tap, smile, done. I'm marked present."

The users are non-technical staff marking attendance once a day, often outdoors or at an office door, in morning daylight, on budget Android phones. Every screen has one obvious action.

## Direction
- **Style:** minimal and practical. Typography and one colour do the work.
- **Theme:** light, because the use scene is daylight.
- **Never:** decoration, cards inside cards, icon-only buttons, gradients, emoji in the UI.

## Colour
- **Restrained.** `present` green is the only accent, and it *means* present. It's used for the main action and the present status.
- **Status always has a word and an icon**, never colour alone:

  | Status | Word | Text colour | Background |
  |---|---|---|---|
  | Present | "Present" | `present` | `present-tint` |
  | Flagged | "Check: outside office", "Check: weak GPS" | `warn` | `warn-tint` |
  | Fake GPS / error | (as the case needs) | `danger` | `danger-tint` |
  | Not marked | "Not marked" | `muted` | `#EEF1EF` |

- **Contrast checked (WCAG AA):** white on present 6.5:1, ink on bg 15.7:1, muted on bg 6.1:1, warn on its tint 6.1:1, danger on its tint 5.5:1.

## Type
- **Anek Latin** 600/700: headings, the big time, status words. Its Devanagari and Gujarati versions are ready for Hindi or Gujarati.
- **Source Sans 3** 400/600: body and buttons. Use tabular numbers for times.
- **JetBrains Mono** 400: admin website only, for coordinates and IDs.
- **Mobile sizes:**
  - body 18
  - nothing below 16
  - buttons 20 semibold
  - status word 32
  - big time 44
- **Font scaling:** must survive the phone's text size at 130%. Never set `allowFontScaling={false}`.

## Layout (mobile)
- **Main action:** full width at the bottom (thumb zone), 64 tall, radius 12.
- **Touch targets:** at least 56.
- **Spacing:** 4/8/12/16/24/32/48. Screen padding 24.
- **Text:** left-aligned. Centre only the success receipt.

## Screens (mobile)
1. **Login:** Auth0 Universal Login, branded with present/bg.
2. **Consent (first run):** "This app takes a photo and your location only when you tap Mark attendance. Photos are deleted after 90 days." → **I agree**.
3. **Home:**
   - greeting with the name, then today's date
   - the **Mark attendance** button
   - once marked: the receipt, with a check mark, "You're present", "09:12 AM · Head Office" and a selfie thumbnail
4. **Camera:**
   - front camera with an oval guide, "Look at the camera", and one round shutter button (72)
   - the location status in words: "Finding your location…" → "Location found"
   - then **Use this photo** / **Take again**
5. **Errors:** plain words plus one fix button.
   - Location off → **Open settings**
   - Offline → **Try again**
   - Too far: "You're 1.2 km from Head Office"
   - Already marked: "Already marked today at 09:12 AM"

## Motion
- **Success:** a 200 ms fade and scale on the check mark, plus a success haptic.
- **Everything else:** no animation except the platform defaults. No bounce.

## Admin website
- **Opens on:** the Today view.
- **Summary:** one sentence, e.g. "62 of 75 present · 3 flagged · 10 not marked". No big-number tiles.
- **Table:**
  - **Columns:** photo 48, name, time, status (word on tint), site, distance.
  - **Filters:** date (native `<input type="date">`) and status.
- **Row click:** a side panel with the large selfie, a "View on map" link (`https://maps.google.com/?q=lat,lng`), accuracy and the fake-GPS flag.
- **States:** loading, empty ("Nobody has marked attendance yet today") and error are all designed.
