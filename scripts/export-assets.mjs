import { createServer } from "node:http";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { chromium } from "playwright";
import sharp from "sharp";
import occtImport from "occt-import-js";
import { readAssetBuildKeys } from "./asset-build-metadata.mjs";
import {
  ensureStepMetadataForCatalogParts,
  writeStepMetadataReport,
} from "./step-metadata.mjs";
import {
  catalogRowFromCurrentAssets,
  ensureAssetDirs,
  glbPathFor,
  isGlbCurrent,
  isPngCurrent,
  materializePart,
  openCatalogRowWriter,
  pngPathFor,
  readCatalogRowMapIfExists,
  readSourceParts,
  stepPathFor,
  stepDir,
} from "./catalog-utils.mjs";

const THUMBNAIL_SIZE = 512;
const DEFAULT_EXPORT_CONCURRENCY = 2;

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    help: { type: "boolean", short: "h" },
    "force-build": { type: "boolean" },
    targets: { type: "string", multiple: true },
    target: { type: "string", multiple: true, short: "t" },
    "targets-file": { type: "string", multiple: true },
  },
});

const COMPONENT_TYPES = {
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
};

const MIME_TYPES = {
  ".glb": "model/gltf-binary",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

function readExportConcurrency() {
  const value = process.env.STEP_PARTS_EXPORT_CONCURRENCY;
  if (!value) {
    return DEFAULT_EXPORT_CONCURRENCY;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("STEP_PARTS_EXPORT_CONCURRENCY must be a positive integer");
  }

  return parsed;
}

function printHelp() {
  console.log(`Export STEP-derived GLB and PNG preview assets.

Usage:
  node scripts/export-assets.mjs
  node scripts/export-assets.mjs --force-build
  node scripts/export-assets.mjs --targets public/glb/raspberry_pi_5.glb
  node scripts/export-assets.mjs --targets-file /tmp/changed-steps.txt
  node scripts/export-assets.mjs --targets @/tmp/changed-steps.txt

Options:
  --force-build             Rebuild selected GLB/PNG assets even when they are up to date
  --targets, --target, -t   Comma-separated or repeatable target files to build
  --targets-file            Read target files from a newline-delimited list

Targets can be generated GLB/PNG paths, STEP/STP paths, bare filenames, or part ids.
Target list files support one target per line; blank lines and lines starting with # are ignored.
Targeting any artifact selects the owning part and processes its GLB/PNG pair before updating SQLite.
`);
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function splitTargets(entries) {
  return entries.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
}

async function readTargetListFile(filePath) {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function collectTargetEntries() {
  const directEntries = splitTargets([...asArray(values.targets), ...asArray(values.target)]);
  const entries = [];

  for (const entry of directEntries) {
    if (entry.startsWith("@") && entry.length > 1) {
      entries.push(...(await readTargetListFile(entry.slice(1))));
      continue;
    }

    entries.push(entry);
  }

  for (const filePath of splitTargets(asArray(values["targets-file"]))) {
    entries.push(...(await readTargetListFile(filePath)));
  }

  return entries;
}

function targetPathname(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname);
  } catch {
    return decodeURIComponent(value.split(/[?#]/, 1)[0]);
  }
}

async function resolveTargetSelection(parts) {
  const targetEntries = await collectTargetEntries();
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const ids = new Set();

  for (const target of targetEntries) {
    if (partsById.has(target)) {
      ids.add(target);
      continue;
    }

    const pathname = targetPathname(target).replaceAll("\\", "/");
    const filename = path.basename(pathname);
    const extension = path.extname(filename).toLowerCase();
    const id = extension ? filename.slice(0, -extension.length) : filename;

    if (!id || !partsById.has(id)) {
      throw new Error(`${target}: target does not match a known part id`);
    }

    if ([".glb", ".png", ".step", ".stp", ""].includes(extension)) {
      ids.add(id);
      continue;
    }

    throw new Error(`${target}: target must be a .glb, .png, .step, .stp, or part id`);
  }

  return {
    hasTargets: targetEntries.length > 0,
    ids,
  };
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function flattenNumbers(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = [];
  const walk = (entry) => {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        walk(item);
      }
      return;
    }

    result.push(Number(entry));
  };
  walk(value);
  return result;
}

function align4(buffer, padByte = 0) {
  const remainder = buffer.byteLength % 4;
  if (remainder === 0) {
    return buffer;
  }

  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, padByte)]);
}

function getMinMax(values, stride) {
  const min = Array.from({ length: stride }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: stride }, () => Number.NEGATIVE_INFINITY);

  for (let index = 0; index < values.length; index += stride) {
    for (let axis = 0; axis < stride; axis += 1) {
      const value = values[index + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  return { min, max };
}

function sourceColor(mesh) {
  const color = Array.isArray(mesh.color) ? mesh.color : null;
  if (color && color.length >= 3) {
    return [color[0], color[1], color[2], 1];
  }

  return null;
}

function colorFactor(mesh, meshIndex) {
  const color = sourceColor(mesh);
  if (color) {
    return color;
  }

  const palette = [
    [0.78, 0.8, 0.78, 1],
    [0.62, 0.64, 0.62, 1],
    [0.86, 0.86, 0.82, 1],
  ];
  return palette[meshIndex % palette.length];
}

function materialProfile(mesh, meshIndex) {
  const hasSourceColor = Boolean(sourceColor(mesh));
  return {
    baseColorFactor: colorFactor(mesh, meshIndex),
    metallicFactor: hasSourceColor ? 0.16 : 0.72,
    roughnessFactor: hasSourceColor ? 0.58 : 0.32,
  };
}

async function writeFileAtomic(destination, bytes) {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmpPath = path.join(path.dirname(destination), `.${path.basename(destination)}.${suffix}.tmp`);

  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, destination);
  } finally {
    await rm(tmpPath, { force: true });
  }
}

function createGlb(result, part) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  const materials = [];
  let byteOffset = 0;

  const addBufferView = (typedArray, target) => {
    const source = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const padded = align4(source);
    const bufferView = {
      buffer: 0,
      byteOffset,
      byteLength: source.byteLength,
      target,
    };
    bufferViews.push(bufferView);
    buffers.push(padded);
    byteOffset += padded.byteLength;
    return bufferViews.length - 1;
  };

  result.meshes.forEach((mesh, index) => {
    const positions = new Float32Array(flattenNumbers(mesh.attributes?.position?.array));
    if (positions.length < 9) {
      return;
    }

    const normalsRaw = flattenNumbers(mesh.attributes?.normal?.array);
    const normals = normalsRaw.length === positions.length ? new Float32Array(normalsRaw) : null;
    const rawIndices = flattenNumbers(mesh.index?.array);
    const maxIndex = rawIndices.reduce((max, value) => Math.max(max, value), 0);
    const indices = maxIndex > 65535 ? new Uint32Array(rawIndices) : new Uint16Array(rawIndices);

    const positionView = addBufferView(positions, 34962);
    const { min, max } = getMinMax(positions, 3);
    const positionAccessor = accessors.push({
      bufferView: positionView,
      componentType: COMPONENT_TYPES.FLOAT,
      count: positions.length / 3,
      type: "VEC3",
      min,
      max,
    }) - 1;

    let normalAccessor = null;
    if (normals) {
      const normalView = addBufferView(normals, 34962);
      normalAccessor = accessors.push({
        bufferView: normalView,
        componentType: COMPONENT_TYPES.FLOAT,
        count: normals.length / 3,
        type: "VEC3",
      }) - 1;
    }

    const indexView = addBufferView(indices, 34963);
    const indexAccessor = accessors.push({
      bufferView: indexView,
      componentType: indices instanceof Uint32Array ? COMPONENT_TYPES.UNSIGNED_INT : COMPONENT_TYPES.UNSIGNED_SHORT,
      count: indices.length,
      type: "SCALAR",
    }) - 1;

    const material = materials.push({
      name: `${part.id}-source-color-${index}`,
      pbrMetallicRoughness: materialProfile(mesh, index),
    }) - 1;

    const attributes = { POSITION: positionAccessor };
    if (normalAccessor !== null) {
      attributes.NORMAL = normalAccessor;
    }

    const meshIndex = meshes.push({
      name: mesh.name || `${part.id}-${index}`,
      primitives: [
        {
          attributes,
          indices: indexAccessor,
          material,
          mode: 4,
        },
      ],
    }) - 1;

    nodes.push({
      name: mesh.name || `${part.id}-${index}`,
      mesh: meshIndex,
    });
  });

  if (meshes.length === 0) {
    throw new Error(`${part.id}: no renderable meshes were produced`);
  }

  const binary = Buffer.concat(buffers);
  const gltf = {
    asset: { version: "2.0", generator: "step.parts occt-import-js exporter" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
  };

  const json = align4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.byteLength + 8 + binary.byteLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.byteLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}

async function exportGlbPart(part, occt) {
  const step = await readFile(stepPathFor(part));
  const result = occt.ReadStepFile(step, {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.0008,
    angularDeflection: 0.35,
  });

  if (!result.success) {
    return {
      partId: part.id,
      skipped: true,
      reason: "STEP import failed",
      warning: `${part.id}: STEP import failed; omitting part from generated catalog`,
    };
  }

  try {
    await writeFileAtomic(glbPathFor(part), createGlb(result, part));
  } catch (error) {
    if (error instanceof Error && error.message === `${part.id}: no renderable meshes were produced`) {
      return {
        partId: part.id,
        skipped: true,
        reason: "no renderable meshes were produced",
        warning: `${part.id}: no renderable meshes were produced; omitting part from generated catalog`,
      };
    }
    throw error;
  }
  return { partId: part.id };
}

function renderPageHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        margin: 0;
        width: ${THUMBNAIL_SIZE}px;
        height: ${THUMBNAIL_SIZE}px;
        overflow: hidden;
        background: transparent;
      }
      canvas {
        display: block;
        width: ${THUMBNAIL_SIZE}px;
        height: ${THUMBNAIL_SIZE}px;
      }
    </style>
    <script type="importmap">
      {
        "imports": {
          "three": "/node_modules/three/build/three.module.js"
        }
      }
    </script>
  </head>
  <body>
    <canvas id="preview" width="${THUMBNAIL_SIZE}" height="${THUMBNAIL_SIZE}"></canvas>
    <script type="module">
      import * as THREE from "three";
      import { RoomEnvironment } from "/node_modules/three/examples/jsm/environments/RoomEnvironment.js";
      import { GLTFLoader } from "/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

      const size = ${THUMBNAIL_SIZE};
      const canvas = document.getElementById("preview");
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance"
      });
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100000);
      const pivot = new THREE.Group();
      scene.add(pivot);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = environment;

      const key = new THREE.DirectionalLight(0xffffff, 3.05);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.00008;
      key.shadow.normalBias = 0.01;
      scene.add(key);
      scene.add(key.target);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x111111, 0.42));
      const rim = new THREE.DirectionalLight(0xffffff, 0.38);
      scene.add(rim);
      scene.add(rim.target);
      const interiorFill = new THREE.DirectionalLight(0xffffff, 0.58);
      scene.add(interiorFill);
      scene.add(interiorFill.target);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(1, 64),
        new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      floor.visible = false;
      scene.add(floor);

      const loader = new GLTFLoader();
      let loadedModel = null;

      function disposeObject(object) {
        object.traverse((child) => {
          if (child.geometry) {
            child.geometry.dispose();
          }

          const material = child.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else if (material) {
            material.dispose();
          }
        });
      }

      function readMaterialColor(material) {
        return material?.color instanceof THREE.Color
          ? material.color.clone()
          : new THREE.Color(0xc9cbc7);
      }

      function clearLoadedModel() {
        if (!loadedModel) {
          return;
        }

        pivot.remove(loadedModel);
        disposeObject(loadedModel);
        loadedModel = null;
      }

      function fitModel(model) {
        const box = new THREE.Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 1);
        model.position.sub(sphere.center);
        pivot.rotation.set(0, 0, 0);

        camera.near = radius / 100;
        camera.far = radius * 80;
        camera.position.set(radius * 2.95, radius * 1.62, radius * 2.95);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        key.position.set(-radius * 2.9, radius * 4.7, radius * 3.6);
        key.target.position.set(0, 0, 0);
        key.target.updateMatrixWorld();
        rim.position.set(radius * 2.4, radius * 1.6, -radius * 3.2);
        rim.target.position.set(0, 0, 0);
        rim.target.updateMatrixWorld();
        interiorFill.position.set(radius * 1.9, radius * 1.25, radius * 2.65);
        interiorFill.target.position.set(0, 0, 0);
        interiorFill.target.updateMatrixWorld();

        const shadowCamera = key.shadow.camera;
        const shadowSize = radius * 3;
        shadowCamera.left = -shadowSize;
        shadowCamera.right = shadowSize;
        shadowCamera.top = shadowSize;
        shadowCamera.bottom = -shadowSize;
        shadowCamera.near = radius / 20;
        shadowCamera.far = radius * 10;
        shadowCamera.updateProjectionMatrix();

        floor.scale.setScalar(radius * 2.65);
        floor.position.set(0, box.min.y - sphere.center.y - radius * 0.035, 0);
        floor.visible = true;
      }

      async function nextFrame() {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      window.renderPartThumbnail = async (glbUrl) => {
        clearLoadedModel();
        renderer.clear(true, true, true);

        const gltf = await loader.loadAsync(glbUrl);
        loadedModel = gltf.scene;
        loadedModel.traverse((child) => {
          if (!child.isMesh) {
            return;
          }

          child.castShadow = true;
          child.receiveShadow = true;
          const original = Array.isArray(child.material) ? child.material[0] : child.material;
          child.material = new THREE.MeshStandardMaterial({
            color: readMaterialColor(original),
            metalness: Math.min(original?.metalness ?? 0.16, 0.4),
            roughness: Math.max(original?.roughness ?? 0.58, 0.5),
            envMapIntensity: 0.72
          });
        });

        pivot.add(loadedModel);
        fitModel(loadedModel);
        renderer.render(scene, camera);
        await nextFrame();
        renderer.render(scene, camera);
        return canvas.toDataURL("image/png").replace(/^data:image\\/png;base64,/, "");
      };
    </script>
  </body>
</html>`;
}

function publicFilePathForRequest(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const publicDir = path.join(process.cwd(), "public");
  const filePath = path.resolve(publicDir, `.${decodedPath}`);
  const relative = path.relative(publicDir, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return filePath;
}

function nodeModuleFilePathForRequest(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const nodeModulesDir = path.join(process.cwd(), "node_modules");
  const filePath = path.resolve(process.cwd(), `.${decodedPath}`);
  const relative = path.relative(nodeModulesDir, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return filePath;
}

async function sendFile(response, filePath) {
  try {
    const bytes = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function startRenderServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/render") {
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[".html"],
        "Cache-Control": "no-store",
      });
      response.end(renderPageHtml());
      return;
    }

    if (url.pathname.startsWith("/glb/")) {
      const filePath = publicFilePathForRequest(url.pathname);
      if (filePath) {
        await sendFile(response, filePath);
        return;
      }
    }

    if (url.pathname.startsWith("/node_modules/")) {
      const filePath = nodeModuleFilePathForRequest(url.pathname);
      if (filePath) {
        await sendFile(response, filePath);
        return;
      }
    }

    response.writeHead(404);
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start thumbnail render server");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (managedBrowserError) {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw new Error(
        `Could not launch Playwright Chromium. Run "npx playwright install chromium" and retry. Original error: ${managedBrowserError.message}`,
      );
    }
  }
}

async function createThumbnailRenderPage(browser, server, rendererIndex) {
  const page = await browser.newPage({
    viewport: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE },
    deviceScaleFactor: 1,
  });

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      console.warn(`[thumbnail:${rendererIndex}:${message.type()}] ${message.text()}`);
    }
  });

  await page.goto(`${server.origin}/render`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.renderPartThumbnail === "function");

  return {
    async render(part) {
      const base64Png = await page.evaluate((glbUrl) => window.renderPartThumbnail(glbUrl), part.glbUrl);
      const rawPng = Buffer.from(base64Png, "base64");
      const png = await sharp(rawPng)
        .ensureAlpha()
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
      const metadata = await sharp(png).metadata();

      if (metadata.format !== "png" || metadata.width !== THUMBNAIL_SIZE || metadata.height !== THUMBNAIL_SIZE) {
        throw new Error(`${part.id}: generated PNG must be ${THUMBNAIL_SIZE}x${THUMBNAIL_SIZE}`);
      }

      return png;
    },
    async close() {
      await page.close();
    },
  };
}

async function createThumbnailRendererPool(concurrency) {
  const server = await startRenderServer();
  let browser;
  let renderers = [];

  try {
    browser = await launchBrowser();
    renderers = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => createThumbnailRenderPage(browser, server, index + 1)),
    );
  } catch (error) {
    await Promise.allSettled(renderers.map((renderer) => renderer.close()));
    await browser?.close();
    await server.close();
    throw error;
  }

  return {
    renderers,
    async close() {
      await Promise.allSettled(renderers.map((renderer) => renderer.close()));
      await browser.close();
      await server.close();
    },
  };
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

async function runGlbWorker() {
  if (!parentPort) {
    throw new Error("GLB worker started without a parent port");
  }

  const occt = await occtImport();
  parentPort.postMessage({ type: "ready" });
  parentPort.on("message", async (message) => {
    if (message.type === "close") {
      parentPort.close();
      return;
    }

    if (message.type !== "export-glb") {
      return;
    }

    try {
      const result = await exportGlbPart(message.part, occt);
      parentPort.postMessage({
        type: "result",
        taskId: message.taskId,
        partId: result.partId,
        skipped: result.skipped,
        reason: result.reason,
        warning: result.warning,
      });
    } catch (error) {
      parentPort.postMessage({
        type: "error",
        taskId: message.taskId,
        partId: message.part?.id,
        error: serializeError(error),
      });
    }
  });
}

async function createGlbExporter(laneIndex) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { role: "glb-exporter" },
  });
  const pending = new Map();
  let nextTaskId = 0;
  let readySettled = false;

  const rejectPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

  const ready = new Promise((resolve, reject) => {
    worker.on("message", (message) => {
      if (message.type === "ready") {
        readySettled = true;
        resolve();
        return;
      }

      const task = pending.get(message.taskId);
      if (!task) {
        return;
      }

      pending.delete(message.taskId);

      if (message.type === "result") {
        task.resolve(message);
        return;
      }

      if (message.type === "error") {
        const error = new Error(`${message.partId ?? `GLB lane ${laneIndex}`}: ${message.error.message}`);
        if (message.error.stack) {
          error.stack = message.error.stack;
        }
        task.reject(error);
      }
    });

    worker.on("error", (error) => {
      if (!readySettled) {
        readySettled = true;
        reject(error);
      }
      rejectPending(error);
    });

    worker.on("exit", (code) => {
      if (code === 0) {
        return;
      }

      const error = new Error(`GLB lane ${laneIndex} exited with code ${code}`);
      if (!readySettled) {
        readySettled = true;
        reject(error);
      }
      rejectPending(error);
    });
  });

  await ready;

  return {
    export(part) {
      const taskId = nextTaskId;
      nextTaskId += 1;

      return new Promise((resolve, reject) => {
        pending.set(taskId, { resolve, reject });
        worker.postMessage({
          type: "export-glb",
          taskId,
          part,
        });
      });
    },
    async close() {
      await worker.terminate();
    },
  };
}

function failureMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createExportStats() {
  return {
    completed: 0,
    glbBuilt: 0,
    glbSkipped: 0,
    pngBuilt: 0,
    pngSkipped: 0,
    rowsUpserted: 0,
    failures: [],
  };
}

async function planEntryWork(entries, existingRows, buildKeys, forceBuild) {
  if (forceBuild) {
    return entries.map((entry) => ({
      entry,
      glbCurrent: false,
      pngCurrent: false,
    }));
  }

  return await Promise.all(
    entries.map(async (entry) => {
      const existingRow = existingRows.get(entry.part.id);
      const glbCurrent = await isGlbCurrent(existingRow, entry.part, buildKeys.glb);
      const pngCurrent = glbCurrent && (await isPngCurrent(existingRow, entry.part, buildKeys.png));

      return {
        entry,
        glbCurrent,
        pngCurrent,
      };
    }),
  );
}

async function upsertCurrentEntries(workItems, writer, buildKeys, stats, total) {
  for (const { entry } of workItems) {
    writer.upsert(await catalogRowFromCurrentAssets(entry.part, entry.sourceOrder, buildKeys));
    stats.glbSkipped += 1;
    stats.pngSkipped += 1;
    stats.rowsUpserted += 1;
    stats.completed += 1;
    console.log(`${stats.completed}/${total} ${entry.part.id} complete`);
  }
}

async function processCatalogEntry({ lane, workItem, buildKeys, writer, stats, total }) {
  const { entry } = workItem;
  const { part, sourceOrder } = entry;
  let stage = "GLB";

  try {
    if (workItem.glbCurrent) {
      stats.glbSkipped += 1;
    } else {
      const result = await lane.glb.export(part);
      if (result.skipped) {
        throw new Error(result.reason ?? "GLB export failed");
      }
      stats.glbBuilt += 1;
    }

    stage = "PNG";
    if (workItem.pngCurrent) {
      stats.pngSkipped += 1;
    } else {
      await writeFileAtomic(pngPathFor(part), await lane.renderer.render(part));
      stats.pngBuilt += 1;
    }

    stage = "SQLite";
    writer.upsert(await catalogRowFromCurrentAssets(part, sourceOrder, buildKeys));
    stats.rowsUpserted += 1;
    stats.completed += 1;
    console.log(`${stats.completed}/${total} ${part.id} complete`);
  } catch (error) {
    if (stage === "SQLite") {
      throw error;
    }

    stats.completed += 1;
    stats.failures.push({
      partId: part.id,
      stage,
      message: failureMessage(error),
    });
    console.warn(`${part.id}: ${stage} export failed; ${failureMessage(error)}`);
    console.log(`${stats.completed}/${total} ${part.id} failed`);
  }
}

async function exportPairs(workItems, concurrency, context) {
  if (workItems.length === 0) {
    return;
  }

  const laneCount = Math.min(concurrency, workItems.length);
  console.log(`Exporting GLB/PNG pairs with ${laneCount} lane${laneCount === 1 ? "" : "s"}.`);
  const rendererPool = await createThumbnailRendererPool(laneCount);
  const glbExporters = [];

  try {
    for (let index = 0; index < laneCount; index += 1) {
      glbExporters.push(await createGlbExporter(index + 1));
    }

    const lanes = rendererPool.renderers.map((renderer, index) => ({
      renderer,
      glb: glbExporters[index],
    }));
    let nextIndex = 0;

    await Promise.all(
      lanes.map(async (lane) => {
        while (nextIndex < workItems.length) {
          const index = nextIndex;
          nextIndex += 1;
          await processCatalogEntry({
            lane,
            workItem: workItems[index],
            ...context,
          });
        }
      }),
    );
  } finally {
    await Promise.allSettled(glbExporters.map((exporter) => exporter.close()));
    await rendererPool.close();
  }
}

async function main() {
  if (values.help) {
    printHelp();
    return;
  }

  const sourceParts = await readSourceParts();
  const preMetadataTargetSelection = await resolveTargetSelection(sourceParts);
  const metadataParts = preMetadataTargetSelection.hasTargets
    ? sourceParts.filter((part) => preMetadataTargetSelection.ids.has(part.id))
    : sourceParts;

  await ensureAssetDirs();
  const metadataResult = await ensureStepMetadataForCatalogParts(metadataParts, { stepDir, write: true });
  const metadataReportPath = await writeStepMetadataReport({
    mode: "write",
    total: metadataParts.length,
    changed: metadataResult.changed,
    unchangedCount: metadataResult.unchanged.length,
    errors: metadataResult.errors,
  });

  if (metadataResult.errors.length > 0) {
    throw new Error(
      `STEP metadata normalization failed for ${formatCount(metadataResult.errors.length, "part")}; see ${metadataReportPath}`,
    );
  }

  console.log(
    `STEP metadata: ${formatCount(metadataResult.changed.length, "file")} updated, ${formatCount(
      metadataResult.unchanged.length,
      "file",
    )} already current; report ${metadataReportPath}`,
  );

  const entries = await Promise.all(
    sourceParts.map(async (sourcePart, sourceOrder) => ({
      sourceOrder,
      part: await materializePart(sourcePart),
    })),
  );
  const parts = entries.map((entry) => entry.part);
  const forceBuild = Boolean(values["force-build"]);
  const buildKeys = await readAssetBuildKeys();
  const existingRows = await readCatalogRowMapIfExists();
  const targetSelection = await resolveTargetSelection(parts);
  const selectedEntries = targetSelection.hasTargets
    ? entries.filter((entry) => targetSelection.ids.has(entry.part.id))
    : entries;
  const concurrency = readExportConcurrency();

  if (targetSelection.hasTargets) {
    console.log(`Targets: selected ${formatCount(selectedEntries.length, "part")} from ${formatCount(parts.length, "catalog part")}.`);
  } else {
    console.log(`Catalog build: checking ${formatCount(selectedEntries.length, "part")}.`);
  }

  const writer = openCatalogRowWriter();
  const stats = createExportStats();
  let deletedRows = 0;
  try {
    const workItems = await planEntryWork(selectedEntries, existingRows, buildKeys, forceBuild);
    const currentItems = workItems.filter((item) => item.glbCurrent && item.pngCurrent);
    const buildItems = workItems.filter((item) => !item.glbCurrent || !item.pngCurrent);

    await upsertCurrentEntries(currentItems, writer, buildKeys, stats, selectedEntries.length);
    await exportPairs(buildItems, concurrency, {
      buildKeys,
      writer,
      stats,
      total: selectedEntries.length,
    });

    if (!targetSelection.hasTargets) {
      deletedRows = writer.deleteRowsNotIn(parts.map((part) => part.id));
    }
  } finally {
    writer.close();
  }

  if (stats.failures.length > 0) {
    console.warn(
      `Export warnings: ${stats.failures
        .map((failure) => `${failure.partId} ${failure.stage}: ${failure.message}`)
        .join("; ")}`,
    );
  }

  if (deletedRows > 0) {
    console.log(`Removed ${formatCount(deletedRows, "stale SQLite row")} for source-catalog entries that no longer exist.`);
  }

  console.log(
    `Asset build complete: ${formatCount(stats.glbBuilt, "GLB")} built, ${formatCount(
      stats.glbSkipped,
      "GLB",
    )} skipped; ${formatCount(stats.pngBuilt, "PNG")} built, ${formatCount(stats.pngSkipped, "PNG")} skipped; ${formatCount(
      stats.rowsUpserted,
      "SQLite row",
    )} upserted; ${formatCount(stats.failures.length, "part")} failed.`,
  );

  if (stats.failures.length > 0) {
    throw new Error(
      `Asset build failed for ${formatCount(stats.failures.length, "part")}: ${stats.failures
        .map((failure) => `${failure.partId} ${failure.stage}`)
        .join(", ")}`,
    );
  }
}

if (!isMainThread && workerData?.role === "glb-exporter") {
  await runGlbWorker();
} else {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
