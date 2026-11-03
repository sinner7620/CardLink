declare module "panzoom/lib/kinetic" {
  export default function kinetic(
    getPoint: () => { x: number; y: number }, scroll: (x: number, y: number) => void,
    settings: { amplitude: number; minVelocity: number; requestAnimationFrame: (fn: any) => any; cancelAnimationFrame: (id: any) => void }
  ): { start(): void; stop(): void; cancel(): void }
}
