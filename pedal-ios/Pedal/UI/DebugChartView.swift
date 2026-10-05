import SwiftUI
import Charts

/// Calibration screen: live accelerometer chart with the threshold lines,
/// sliders to adjust them, and a pedal-stroke counter for the manual
/// counting test (pedal N strokes, count them yourself, and compare).
struct DebugChartView: View {
    @ObservedObject var session: SessionController
    @ObservedObject var buffer: MotionSampleBuffer

    var body: some View {
        VStack(spacing: 16) {
            Chart {
                ForEach(Array(buffer.samples.enumerated()), id: \.offset) { _, sample in
                    LineMark(x: .value("t", sample.t), y: .value("g", sample.magnitude))
                }
                if session.detectionMethod == .peaks {
                    RuleMark(y: .value("umbral alto", session.highThreshold))
                        .foregroundStyle(.red)
                    RuleMark(y: .value("umbral bajo", session.lowThreshold))
                        .foregroundStyle(.orange)
                }
            }
            .chartYScale(domain: 0...2)
            .frame(maxHeight: 220)

            Picker("Método", selection: $session.detectionMethod) {
                Text("Frecuencia (auto)").tag(MotionRevolutionSource.DetectionMethod.frequency)
                Text("Picos (umbrales)").tag(MotionRevolutionSource.DetectionMethod.peaks)
            }
            .pickerStyle(.segmented)

            if session.detectionMethod == .peaks {
                VStack(spacing: 4) {
                    Slider(value: $session.highThreshold, in: 0.1...1.5, step: 0.05)
                    Text(String(format: "Umbral alto: %.2f g", session.highThreshold))
                        .font(.caption)
                    Slider(value: $session.lowThreshold, in: 0.05...1.45, step: 0.05)
                    Text(String(format: "Umbral bajo: %.2f g", session.lowThreshold))
                        .font(.caption)
                }
            } else {
                HStack(spacing: 8) {
                    Circle()
                        .fill(session.estimatedCadence > 0 ? Color.green : Color.orange)
                        .frame(width: 12, height: 12)
                    Text(session.estimatedCadence > 0
                         ? String(format: "Pedaleo detectado: %.0f rpm (confianza %.0f%%)",
                                  session.estimatedCadence, min(session.estimateConfidence, 1) * 100)
                         : "Sin pedaleo detectado")
                        .font(.caption)
                }
                Text("Con el método Frecuencia no hay nada que calibrar: sujeta el iPhone a la zapatilla, pedalea a ritmo cómodo 10 segundos y espera el punto verde. Verde = listo. Si nunca se pone verde: aprieta la sujeción (que no baile) o prueba el método Picos.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Text("Comprobación opcional: pon el contador a cero, pedalea 30 pedaladas contándolas y compara con el número de abajo.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 4) {
                Text("Pedaladas de la sesión")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("\(session.revolutionsThisSession)")
                    .font(.system(size: 56, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                Button("Reiniciar contador") { session.resetTestCounter() }
                    .font(.footnote)
            }

            if !session.running {
                Text("Vista previa del sensor: mueve el móvil rítmicamente para ver la señal. Para contar pedaladas y emitir por Bluetooth, vuelve atrás y pulsa Empezar en modo \"Pedaleo real\".")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .navigationTitle("Calibración")
        .padding()
        .onAppear { session.startCalibrationPreview() }
        .onDisappear { session.stopCalibrationPreview() }
    }
}
