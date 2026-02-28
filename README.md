# hum2midi

Turn humming/whistling into editable MIDI.

## Vision
- Press-and-hold capture for melody ideas
- Fast trim + conversion flow
- Lightweight piano-roll editing
- Immediate playback and MIDI export

## V1 Scope (POC)
- Hold button to record microphone pitch
- Live frequency + note display
- Trim start/end directly on a frequency map (drag handles)
- Trim start/end directly in the piano roll (same linked handles)
- Convert trimmed audio-pitch frames into quantized note events
- Piano roll with direct note drag/move and resize
- Octave shift controls
- Playback with selectable instrument presets (keyboard, piano, trumpet, flute, bass, drums)
- Export to `.mid`

## Run
Open [index.html](index.html) in a browser.

> Browser needs microphone permission for recording.

## Files
- [index.html](index.html) — app UI shell
- [styles.css](styles.css) — styling
- [app.js](app.js) — recording, conversion, editor, playback, MIDI export
- [DESIGN.md](DESIGN.md) — product/technical blueprint

## Next Steps
- Add piano keyboard input + click-to-add note
- Add smoothing/denoise pass before note conversion
- Add snap grid controls (1/8, 1/16, triplets)
- Add project save/load JSON and import MIDI
- Add richer sampled instruments (SoundFont/WebAudio samples)
