# RNNoise model for ffmpeg `arnndn`

`bd.rnnn` is the *beguiling-drafter* model from
https://github.com/GregorR/rnnoise-models (folder `beguiling-drafter-2018-08-30`,
added in commit 6c2c1301c30a6be5ddf93704a693f4956ce2aa55; sha256
ae3f7411e1e6a884f839a4a145c394408398f09854dbc1216ee02faafc98a17b). Gregor Richards trained it for
"voice in a reasonable recording environment: fans, AC, computers". It keeps non-speech voice
sounds such as laughter.

Licence: the upstream README says, "With the exception of the tools/ directory and this file,
none of this work is creative and thus none of it is subject to copyright." The model files are
therefore free to redistribute. The training corpora are listed in the upstream `info.txt`.

The voice presets (`clean`, `podcast`) in `packages/engine/src/audio.ts` use this model. They fall
back to `afftdn` when the file is missing. The model was chosen over afftdn, anlmdn and the
`sh` and `cb` models by measurement on the demo A-rolls (2026-11).
