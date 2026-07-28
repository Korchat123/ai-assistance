# Live2D model assets

Place a properly licensed Cubism model in this directory during local setup.

Do not commit purchased or proprietary model files unless their license
explicitly permits redistribution. Cubism Core must be obtained from the
official Live2D Cubism SDK distribution and is intentionally not included.

Copy the complete model directory here so relative texture, motion, expression,
physics, and pose URLs continue to resolve. Then copy
`../avatar-manifest.example.json` to `../avatar-manifest.json` and update
`modelUrl`, parameter IDs, expressions, and motion groups to match the model.

The application supports Cubism 3/4 models through the Cubism 4 adapter. The
model entry file normally ends in `.model3.json`.
