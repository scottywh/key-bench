# Key Bench

A keys-only piano app — a fork of the keyboard side of Plus Twelve.

- Multi-touch chords: one voice per held pointer, key lit while held, note
  ends on release
- Play + record (`.m4a`) + MIDI export with real note durations
  (note-on press / note-off release)
- Downloads go to Downloads/Key Bench; landscape lock on first key press

Current version: 1.0.0.

## Run it

Open `index.html` in a browser, or build the Android app:

```sh
export KS_PASS=<your keystore password>
python3 android/build_apk.py
```

The build needs Python 3 and JDK 17+. It fetches its tools from npm on
first run — no Android Studio or SDK needed. The keystore is never in this
repo; set `KS_PASS` before building.

## Notes

- Font files are not in this repo, so the web app falls back to system fonts.
