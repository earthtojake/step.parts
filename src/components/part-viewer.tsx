"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, RotateCw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PartViewerProps = {
  glbUrl: string;
  pngUrl: string;
  name: string;
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

export function PartViewer({ glbUrl, pngUrl, name }: PartViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const resetViewRef = useRef<() => void>(() => {});
  const autoRotateRef = useRef(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let loadedModel: THREE.Object3D | null = null;
    let modelBounds: { center: THREE.Vector3; radius: number } | null = null;
    let userAdjustedView = false;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 1.25;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;

    const key = new THREE.DirectionalLight(0xffffff, 2.85);
    key.position.set(-3.5, 6, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.00008;
    key.shadow.normalBias = 0.01;
    scene.add(key);
    scene.add(key.target);

    const fill = new THREE.HemisphereLight(0xffffff, 0x222222, 0.5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.42);
    rim.position.set(3, 2, -4);
    scene.add(rim);
    scene.add(rim.target);
    const interiorFill = new THREE.DirectionalLight(0xffffff, 0.62);
    interiorFill.position.set(2.2, 1.5, 3.2);
    scene.add(interiorFill);
    scene.add(interiorFill.target);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.52 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.visible = false;
    scene.add(floor);

    const resize = () => {
      const width = Math.max(frame.clientWidth, 1);
      const height = Math.max(frame.clientHeight, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (modelBounds && !userAdjustedView) {
        frameModelBounds(modelBounds.center, modelBounds.radius);
      }
    };

    const frameModelBounds = (center: THREE.Vector3, radius: number) => {
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const fitFov = Math.min(verticalFov, horizontalFov);
      const distance = (radius * 1.18) / Math.sin(fitFov / 2);
      const viewDirection = new THREE.Vector3(1.8, 1.05, 1.75).normalize();

      controls.target.copy(center);
      camera.near = Math.max(radius / 100, 0.001);
      camera.far = distance + radius * 100;
      camera.position.copy(center).add(viewDirection.multiplyScalar(distance));
      camera.updateProjectionMatrix();
      controls.update();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(frame);
    resize();

    const fitModel = (model: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(model);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 1);
      const center = sphere.center;
      modelBounds = { center: center.clone(), radius };

      frameModelBounds(center, radius);

      key.position.copy(center).add(new THREE.Vector3(-radius * 3.3, radius * 4.8, radius * 3.4));
      key.target.position.copy(center);
      key.target.updateMatrixWorld();
      rim.position.copy(center).add(new THREE.Vector3(radius * 3, radius * 2, -radius * 4));
      rim.target.position.copy(center);
      rim.target.updateMatrixWorld();
      interiorFill.position.copy(center).add(new THREE.Vector3(radius * 2.2, radius * 1.5, radius * 3.2));
      interiorFill.target.position.copy(center);
      interiorFill.target.updateMatrixWorld();
      const shadowCamera = key.shadow.camera as THREE.OrthographicCamera;
      const shadowSize = radius * 3;
      shadowCamera.left = -shadowSize;
      shadowCamera.right = shadowSize;
      shadowCamera.top = shadowSize;
      shadowCamera.bottom = -shadowSize;
      shadowCamera.near = radius / 20;
      shadowCamera.far = radius * 10;
      shadowCamera.updateProjectionMatrix();

      floor.scale.setScalar(radius * 2.7);
      floor.position.set(center.x, box.min.y - radius * 0.035, center.z);
      floor.visible = true;

      resetViewRef.current = () => {
        userAdjustedView = false;
        frameModelBounds(center, radius);
      };
    };

    const markUserAdjustedView = () => {
      userAdjustedView = true;
    };
    controls.addEventListener("start", markUserAdjustedView);

    const loader = new GLTFLoader();
    setStatus("loading");
    loader.load(
      glbUrl,
      (gltf) => {
        if (disposed) {
          return;
        }

        loadedModel = gltf.scene;
        loadedModel.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) {
            return;
          }

          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
              material.envMapIntensity = 0.8;
              material.metalness = Math.min(material.metalness, 0.5);
              material.roughness = Math.max(material.roughness, 0.48);
              material.needsUpdate = true;
            }
          });
        });

        scene.add(loadedModel);
        fitModel(loadedModel);
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) {
          setStatus("error");
        }
      },
    );

    const animate = () => {
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.removeEventListener("start", markUserAdjustedView);
      controls.dispose();
      if (loadedModel) {
        disposeObject(loadedModel);
      }
      floor.geometry.dispose();
      floor.material.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [glbUrl]);

  return (
    <div
      ref={frameRef}
      data-viewer-status={status}
      className="part-preview-surface relative h-[62vh] min-h-[420px] overflow-hidden rounded-md border border-border lg:min-h-[560px] lg:self-start"
    >
      <div className="pointer-events-none absolute inset-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pngUrl}
          alt=""
          width={512}
          height={512}
          loading="eager"
          decoding="async"
          className={`h-full w-full object-contain drop-shadow-[0_28px_28px_rgb(0_0_0_/_0.32)] transition-opacity duration-200 ${
            status === "ready" ? "opacity-0" : "opacity-100"
          }`}
        />
      </div>
      <canvas
        ref={canvasRef}
        className={`h-full w-full transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`}
        aria-label={`${name} 3D viewer`}
      />
      {status === "loading" ? (
        <div className="absolute inset-0 grid place-items-center bg-background/10">
          <div className="grid h-24 w-24 place-items-center rounded-md bg-background/35 backdrop-blur-sm">
            <LoaderCircle className="size-7 animate-spin text-foreground/80" aria-hidden="true" />
          </div>
          <span className="sr-only">Loading {name} 3D viewer</span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-x-4 bottom-4 rounded-md border border-border bg-background/85 px-3 py-2 text-sm text-muted-foreground backdrop-blur-sm">
          Interactive preview unavailable.
        </div>
      ) : null}
      <div className="absolute right-3 top-3 flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-md"
              onClick={() => setAutoRotate((value) => !value)}
              aria-label={autoRotate ? "Pause rotation" : "Start rotation"}
              aria-pressed={autoRotate}
            >
              {autoRotate ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{autoRotate ? "Pause rotation" : "Start rotation"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-md"
              onClick={() => resetViewRef.current()}
              aria-label="Reset view"
            >
              <RotateCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset view</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
