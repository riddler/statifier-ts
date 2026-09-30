import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { composite: false } },
  target: "es2020",
  platform: "neutral",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The published maps carry no source text of their own. esbuild embeds every
  // input file under `sourcesContent` by default, which would ship this
  // package's TypeScript twice over - once per format - and make the maps most
  // of the unpacked bytes. Turning it off leaves `sources` and `mappings`
  // intact.
  //
  // THIS SETTING AND THE `src` ENTRY IN package.json's `files` LIST ARE ONE
  // DECISION AND ONLY WORK TOGETHER. A map's `sources` entries are relative
  // paths of the form `../src/<name>.ts`, resolved against the map's own
  // location in `dist`, so they land on the source directory as the package is
  // installed. They resolve because that directory ships; without it every one
  // of them points at a file the tarball does not contain, and a consumer's
  // tooling reports a missing source rather than a location. Dropping `src`
  // from the `files` list therefore breaks every published map, and dropping
  // the maps is what this setting deliberately did not do. The source ships
  // once, as files a reader can open, rather than twice inside the maps.
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
});
