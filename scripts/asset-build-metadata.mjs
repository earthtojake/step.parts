import { createHash } from "node:crypto";

export const ASSET_MANIFEST_VERSION = 1;

const ASSET_BUILD_RECIPES = {
  glb: [
    "glb-v2",
    "occt-import-js ReadStepFile linearUnit=millimeter linearDeflectionType=bounding_box_ratio linearDeflection=0.0008 angularDeflection=0.35",
    "gltf-v2 binary export with source colors and material-profile-v1",
    "meshless STEP imports are hard failures",
  ],
  png: [
    "png-v2",
    "512x512 transparent thumbnail",
    "three-js room-environment lighting and camera-fit-v1",
    "sharp png compressionLevel=9 adaptiveFiltering=true",
  ],
};

function recipeBuildKey(prefix, entries) {
  const digest = createHash("sha256").update(entries.join("\n")).digest("hex");
  return `${prefix}:${digest}`;
}

export async function readAssetBuildKeys() {
  return {
    glb: recipeBuildKey("glb-v2", ASSET_BUILD_RECIPES.glb),
    png: recipeBuildKey("png-v2", ASSET_BUILD_RECIPES.png),
  };
}
