// ECharts prebuilt ESM bundle type shim
//
// We load the runtime from `echarts/dist/echarts.esm` to avoid issues with the
// package's ESM entry (`echarts/index.js`) in certain bundlers, but we still
// want the proper TypeScript types from the main `echarts` package.
declare module "echarts/dist/echarts.esm" {
  export * from "echarts";
}

declare module "echarts/dist/echarts.esm.mjs" {
  export * from "echarts";
}
