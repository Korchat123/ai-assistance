# Live2D setup and licenses

## Pinned compatibility matrix

| Component | Version | License |
| --- | --- | --- |
| PixiJS | `7.4.3` | MIT |
| pixi-live2d-display | `0.5.0-beta` | MIT |
| Cubism adapter | `pixi-live2d-display/cubism4` | MIT wrapper |
| Cubism Core | User-supplied SDK file | Live2D proprietary license |
| Model assets | User-supplied | Model-specific license |

`pixi-live2d-display@0.5.0-beta` declares `pixi.js ^7.0.0` as its peer
dependency. The project pins both packages exactly to avoid duplicate Pixi
instances or an unreviewed adapter upgrade.

## Local installation

1. Download the Cubism SDK for Web from Live2D and review its license.
2. Copy `live2dcubismcore.min.js` to
   `apps/web/public/live2d/core/live2dcubismcore.min.js`.
3. Copy a properly licensed Cubism 3/4 model directory into
   `apps/web/public/live2d/models/`.
4. Copy `apps/web/public/live2d/avatar-manifest.example.json` to
   `apps/web/public/live2d/avatar-manifest.json`.
5. Update the manifest to match the model's entry URL, parameter IDs,
   expressions, and motion groups.

The Core file, active manifest, and model files are ignored by Git. Do not
remove those ignore rules unless redistribution rights have been confirmed.
Missing expressions, gestures, or parameter IDs are treated as unsupported
capabilities and do not prevent the rest of the avatar from loading.
