# Real-room recordings (task 16)

Recordings of real plays, exactly as the decoder received them, for evaluating decoder changes
against real rooms instead of the simulator.

## Making one
1. On the laptop: `npm run dev` (or `npm run dev:phone` for a phone as the listener), open `/?dev`.
2. Tick **Record raw audio while listening** and set the label, for example `1m-70pct` or `3m-100pct`.
3. Press **Listen (mic)**, play the tape on the other device, wait for the result, press **Stop listening**.
   The page saves `real-room-<label>-<UTC time>Z.wav`: 16-bit mono at the listener's sample rate,
   including any stretches the audio pipeline lost (filled with silence, as the decoder saw them).
4. Move the file here. One play per file keeps the results easy to read.

## manifest.json
- `expected`: the header of the tape that was played (tapeId in hex, profile, payloadKind 0 = tape /
  1 = ghost, payloadLength in bytes). From the dev page log: `header: tape 743b64c6, standard, 119 B`.
- `notes`: optional, per file name: distance, volume, device, anything unusual.

## Using them
`npm run measure:fixtures` decodes every file with and without per-tone equalization and prints a
table (headers, decodes, clarity, header byte errors, payload symbol errors, tone levels at the sync
notes). The payload reference is taken from the first recording that decodes.

Size: about 96 KB per second (48 kHz, 16-bit), so a 20 s play is about 1.9 MB and fifteen plays about
30 MB. They are committed so the evaluation can be repeated; trim long silences before committing.
