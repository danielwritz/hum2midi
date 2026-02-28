# hum2midi — Design

## Product Goal
Capture a sung/hummed melody quickly and convert it into editable MIDI with minimal friction.

## Primary User Flow
1. User holds record button and hums/whistles a melody.
2. App displays live frequency and note estimate.
3. User trims start/end on a frequency map to isolate phrase.
4. App converts trimmed pitch frames to quantized notes.
5. Notes appear in a piano-roll editor with the same trim handles available.
6. User edits note positions/durations/pitch.
7. User chooses instrument, plays back, exports MIDI.

## Core UX Principles
- **Press-and-hold recording** for speed
- **Tight feedback loop** (live pitch + quick conversion)
- **Direct manipulation** in piano roll
- **One-screen workflow** for idea capture

## Technical Outline

### Audio Capture + Pitch Detection
- `getUserMedia` microphone input
- `AudioContext + AnalyserNode`
- Auto-correlation pitch detection per animation frame
- Store pitch frames as `{ t, freq, midi }`

### Trim + Note Conversion
- Frequency-map trim handles define active range
- Piano-roll trim handles mirror and update the same active range
- Partition trimmed region into quantization buckets based on BPM
- Median MIDI per bucket
- Merge contiguous buckets of same pitch into notes
- Output notes: `{ start, duration, midi, velocity }`

### Piano Roll Editor
- Canvas-based piano roll
- Vertical axis: MIDI notes
- Horizontal axis: time seconds
- Drag note to move pitch/time
- Drag right edge to resize duration
- Octave transpose controls

### Playback
- WebAudio oscillator playback for quick monitoring
- Instrument selection via oscillator waveform

### MIDI Export
- Build SMF (format 0) in browser
- Include tempo meta event
- Note on/off events with PPQ timing
- Download `.mid` file

## Data Model (POC)
- `pitchFrames[]`
- `notes[]`
- `timelineSec`
- Recording + trim metadata

## V1 Non-goals
- Polyphonic pitch detection
- Full DAW feature parity
- Multi-track arrangement
- Cloud sync/accounts

## Risks / Open Questions
- Pitch detection quality in noisy environments
- Quantization defaults for expressive vocals
- Latency and confidence handling for weak signals

## Suggested V1.1
- Confidence scoring and smoothing filter
- Manual add/delete notes
- Snap strength slider
- Tempo map / time signature controls
- Save/load project JSON
