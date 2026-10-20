# Adhan Bar

A small Windows tray app that plays your own adhan and shows the time left to the next prayer right in the system tray.

## Features
- Countdown to the next prayer on the tray icon (e.g. `2:01`), with the prayer name and time left on hover
- Text color shows the status: white = normal, red = adhan is close (15 min by default), green = adhan is playing
- Plays your own audio file (mp3, wav, ogg, m4a) instead of a built-in adhan
- Mute the next adhan with one switch
- No Windows notifications, it just plays the adhan
- Starts with Windows
- Prayer times are calculated offline with the [adhan](https://github.com/batoulapps/adhan-js) library (choose location, calculation method and Asr madhab)

## Run from source
```
npm install
npm start
```

## Build the installer
```
npm run dist
```
The installer is created in `dist/`.

## Notes
- Windows 11 hides new tray icons in the "^" overflow. Drag the icon out once to pin it next to volume and wifi.
- Settings are stored per user in `%APPDATA%`, so set the location and audio file again on each PC.
- In `main.js`, `COMPACT` switches between the `2:01` style (false) and a bigger two-character style (true).
