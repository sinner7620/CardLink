# GoodNotes-Ink

Source: https://github.com/connectedGraph/goodnotes-ink
Commit: 4659912545c5db66e36dedf9cdab9564e2b9eab5
License: MIT; see LICENSE and the packaged THIRD_PARTY_NOTICES.txt.

The active handwriting window uses the 842 daily-test adapter under ../../ink842,
importing engine.ts and constants.ts directly. Core rendering and pressure
processing remain upstream. The earlier InkCanvas coordinate adapter is retained
as source but is no longer used by the handwriting window; old saved records
are converted by ink842/record.js while preserving their pen options.
