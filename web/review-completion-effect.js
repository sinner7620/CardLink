import confetti from 'canvas-confetti'

export function fireRealisticLook(fire) {
  const defaults = { origin: { y: 0.7 } }
  const burst = (ratio, options) => fire({ ...defaults, ...options, particleCount: Math.floor(200 * ratio) })
  const pending = [
    burst(0.25, { spread: 26, startVelocity: 55 }),
    burst(0.2, { spread: 60 }),
    burst(0.35, { spread: 100, decay: 0.91, scalar: 0.8 }),
    burst(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 }),
    burst(0.1, { spread: 120, startVelocity: 45 })
  ]
  return Promise.all(pending)
}

const canvas = document.getElementById('review-completion-confetti')
const fire = confetti.create(canvas, { resize: true, disableForReducedMotion: true })
let played = false
window.setReviewCompletionEffect = active => {
  if (!active) { fire.reset(); return }
  if (played) return
  played = true
  fireRealisticLook(fire)
}
window.addEventListener('pagehide', () => fire.reset())
