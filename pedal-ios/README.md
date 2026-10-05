# Pedal

A small SwiftUI app that turns an iPhone into a Bluetooth cadence sensor for
Ciklism. Strap the phone to your shoe, pedal, and it advertises the standard
Cycling Speed and Cadence service (`1816`, measurement `2A5B`) like a
commercial crank sensor. Any CSC receiver can read it, not only Ciklism.

- **Simulated mode:** a slider emits a fixed cadence, for development without a bike.
- **Real pedalling mode:** CoreMotion at 50 Hz. The default detector estimates
  cadence by autocorrelation over the three accelerometer axes, weighted by
  energy, so it needs no thresholds and handles both jerky and smooth circular
  motion. A classic peak detector with hysteresis is kept as an alternative,
  with a live calibration chart.
- Cumulative crank revolutions and the 1/1024 s event time wrap at 16 bits as
  the CSC spec requires. Measurements are sent about once per second, only
  while a viewer is subscribed.

The UI text is in Spanish.

## Build

Requires Xcode 26 and iOS 17+. Bluetooth peripheral mode and motion need a
physical iPhone; select your own signing team in Xcode to install it.

```sh
open pedal-ios/Pedal.xcodeproj
# or run the unit tests on a simulator:
xcodebuild -project pedal-ios/Pedal.xcodeproj -scheme Pedal \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO test
```

`project.yml` is the [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec the
project was generated from.
