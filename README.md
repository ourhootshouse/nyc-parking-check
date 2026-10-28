# NYC Parking Check (proof of concept)

Phone-friendly web app: share your location, snap a photo of a NYC parking sign (or type or pick the sign), and see whether you can park there **right now**. It tells you when the next violation starts, or when parking becomes OK.

- Sign reading: on-device OCR (tesseract.js). Always check the text against the sign.
- Alternate Side Parking holidays: official NYC DOT 2026 suspension calendar (`asp.json`).
- Address lookup: NYC GeoSearch (geosearch.planninglabs.nyc).

**Disclaimer:** This is a helper, not a legal guarantee. OCR and sign parsing can be wrong, and it does not know about arrows, temporary signs, permits, or emergency suspensions. Always read the actual signs and check NYC 311 / NYC DOT (https://www.nyc.gov/html/dot/html/motorist/parking.shtml).
