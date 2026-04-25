# Sounds to source — Dev C task C10

Place 6 short wav files in this folder. Recommended length: 0.3 – 1.0 s.
Sources : https://mixkit.co/free-sound-effects/ (CC0, ships as .wav).

| File          | When it plays                              | Search keywords                |
|---------------|---------------------------------------------|--------------------------------|
| whoosh.wav    | Camera dive / phase transition              | "whoosh ui", "swoosh subtle"   |
| scan.wav      | INGEST / mesh parsing                       | "scanner short", "data ping"   |
| tick.wav      | Each agent step "done"                      | "tick ui", "soft click"        |
| paint.wav     | Stylized mesh appears                       | "magic shimmer short"          |
| place.wav     | Each panel placed on roof                   | "snap click", "panel place"    |
| chime.wav     | Final "Ready" + PDF export complete         | "success chime", "ding soft"   |

The Howler hook in `Orchestrator` falls back gracefully if any file is missing — the demo still runs without sound.
