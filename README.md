# Poseme 3D

A PoseMyArt-style 3D posing app for Android, starring the character from the Poseme model sheet.

## Features
- **Poseme character** built from the model sheet: big round head, cream body, cartoon gloves and boots, rig joints matching the sheet's joint map.
- **Joint posing**: tap a coloured dot (red = left, blue = right, green = centre) and drag the rotate gizmo. Tap the body to move the character.
- **Squash & stretch** (🌀): stretch or squash any single joint (volume-preserving), plus whole-body squash.
- **Rubber hose limbs**: switch arms and legs to smooth bendy hoses, with a bend slider to exaggerate the curve.
- **Expressions** from the sheet (smile, neutral, surprised, sad) plus angry, wink and laugh.
- **Hand poses**: open, relaxed, fist, point, peace, thumbs up.
- **Preset poses**: T, A, idle, wave, run, jump, sit, think, kick, cheer, sad. Mirror and reset.
- **Poseme family** (full features on the same rig): Poseme (sheet, rebuilt with img2threejs), Blob Buddy (from its turnaround sheet, with open-mouth expressions), Poseme Girl, Chibi, Mannequin, Stick Bot, Square Stick Bot. Black cartoon outlines (toggle in Light panel).
- **Chibi Girl** from the clay render (img2threejs), with flared legs and block boots.
- **Import your own models**: FBX, GLB/GLTF (single file) and OBJ. Rigged models keep their bones; models without bones get an automatic Poseme rig (T-pose works best), so presets and mirror work on them.
- **2D cel shading** (◐ button or Light panel): flat colour with one hard shadow band, for 2D animation reference.
- **Open-source rigged models**: X Bot, Soldier, Michelle, Robot (three.js repo), Cesium Man and Rigged Figure (Khronos glTF-Sample-Assets). Add several characters, duplicate, recolour, lock, hide joints, delete.
- **Props**: box, sphere, cylinder, cone, torus, step, with move, rotate and scale.
- **Scene**: light direction/height/intensity with arrows and shadows, background colour or photo, grid/floor toggles, camera FOV and front/back/side/top views.
- **Undo/redo**, saved scenes, JSON export/import, PNG screenshots saved to Pictures/Poseme.

## Build
Every push builds a debug APK in GitHub Actions (Actions tab → latest run → *Poseme3D-debug-apk*).
Locally: open in Android Studio, or run `gradle assembleDebug`.

The 3D view is plain HTML/JS in `app/src/main/assets/web`, served to an Android WebView. To try it on a computer, run `python3 -m http.server` in that folder.

## Credits
- Poseme and Blob Buddy body shapes generated with the img2threejs skill (Apache-2.0): https://github.com/img2threejs/img2threejs. Its SDF polygonizer is vendored in `lib/sdf.js`.
- Robot Expressive by Tomás Laulhé (Quaternius), CC0.
- Cesium Man and Rigged Figure from KhronosGroup/glTF-Sample-Assets, CC-BY 4.0 (Cesium Man © Cesium; Rigged Figure © Khronos).
three.js (MIT), including OrbitControls, TransformControls, GLTFLoader, SkeletonUtils and the X Bot / Soldier / Michelle example models: https://github.com/mrdoob/three.js. The models are Mixamo-derived; check Mixamo's terms before using them commercially.
