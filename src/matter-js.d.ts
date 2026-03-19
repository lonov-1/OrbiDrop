// Fallback when @types/matter-js is missing on CI; keeps Matter usable as `any`.
declare module "matter-js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Matter: any
  export = Matter
}
