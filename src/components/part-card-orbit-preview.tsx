"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cn } from "@/lib/utils";

type PartCardOrbitPreviewProps = {
  glbUrl: string;
  name: string;
  active?: boolean;
  className?: string;
  onReady?: () => void;
};

const THUMBNAIL_CAMERA_XZ = 2.95;
const THUMBNAIL_CAMERA_Y = 1.62;
const THUMBNAIL_CAMERA_FOV = 30;
const THUMBNAIL_AZIMUTH = Math.PI / 4;
const ORBIT_SPEED = 0.00018;

function disposeMaterial(material: THREE.Material | THREE.Material[] | null | undefined) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }

  material?.dispose();
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    disposeMaterial(mesh.material);
  });
}

export function PartCardOrbitPreview({ glbUrl, name, active = false, className, onReady }: PartCardOrbitPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(active);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let loadedModel: THREE.Object3D | null = null;
    let orbitRadius = 1;
    let orbitHeight = 1;
    let lastFrameAt: number | null = null;
    let orbitAngle = THUMBNAIL_AZIMUTH;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    const pivot = new THREE.Group();
    scene.add(pivot);

    const camera = new THREE.PerspectiveCamera(THUMBNAIL_CAMERA_FOV, 1, 0.01, 100000);

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

    const fill = new THREE.HemisphereLight(0xffffff, 0x111111, 0.42);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.38);
    scene.add(rim);
    scene.add(rim.target);

    const interiorFill = new THREE.DirectionalLight(0xffffff, 0.58);
    scene.add(interiorFill);
    scene.add(interiorFill.target);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.visible = false;
    scene.add(floor);

    const resize = () => {
      const width = Math.max(frame.clientWidth, 1);
      const height = Math.max(frame.clientHeight, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(frame);
    resize();

    const fitModel = (model: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(model);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 1);

      model.position.sub(sphere.center);
      orbitRadius = radius * Math.hypot(THUMBNAIL_CAMERA_XZ, THUMBNAIL_CAMERA_XZ);
      orbitHeight = radius * THUMBNAIL_CAMERA_Y;
      lastFrameAt = null;
      orbitAngle = THUMBNAIL_AZIMUTH;

      camera.near = radius / 100;
      camera.far = radius * 80;
      camera.position.set(
        radius * THUMBNAIL_CAMERA_XZ,
        orbitHeight,
        radius * THUMBNAIL_CAMERA_XZ,
      );
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

      const shadowCamera = key.shadow.camera as THREE.OrthographicCamera;
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
    };

    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
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
              material.envMapIntensity = 0.78;
              material.metalness = Math.min(material.metalness, 0.5);
              material.roughness = Math.max(material.roughness, 0.48);
              material.needsUpdate = true;
            }
          });
        });

        pivot.add(loadedModel);
        fitModel(loadedModel);
        renderer.render(scene, camera);
        onReadyRef.current?.();
      },
    );

    const animate = (time: number) => {
      if (loadedModel) {
        if (!activeRef.current) {
          lastFrameAt = null;
          renderer.render(scene, camera);
          animationFrame = requestAnimationFrame(animate);
          return;
        }

        lastFrameAt ??= time;
        orbitAngle += (time - lastFrameAt) * ORBIT_SPEED;
        lastFrameAt = time;
        camera.position.set(Math.cos(orbitAngle) * orbitRadius, orbitHeight, Math.sin(orbitAngle) * orbitRadius);
        camera.lookAt(0, 0, 0);
      }

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate(0);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
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
      className={cn(
        "h-full w-full",
        className,
      )}
    >
      <canvas ref={canvasRef} className="h-full w-full" aria-label={`${name} hover preview`} />
    </div>
  );
}
