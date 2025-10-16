import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/* =========================================================
   CONFIG
   ========================================================= */
const MAP_SWAP = false; // true si tu escena quedó girada 90°
const PHASES = { A_GREEN: 0, A_AMBER: 1, B_GREEN: 2, B_AMBER: 3 };
const DUR_MS = { 0: 3000, 1: 1000, 2: 3000, 3: 1000 }; // Arduino: 3s/1s/3s/1s

// Caja de cruce y líneas de alto
const BOX_HALF = 3.0;
const STOP_OFFSET = 0.25;
const STOP_X = -(BOX_HALF + STOP_OFFSET);
const STOP_Z = -(BOX_HALF + STOP_OFFSET);
const CLEAR_X = 0.0;
const CLEAR_Z = 0.0;

/* =========================================================
   TEXTURAS PROCEDURALES (CanvasTexture) - sin archivos externos
   ========================================================= */
function makeAsphaltTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const ctx = c.getContext("2d");

  // Base gris oscuro
  ctx.fillStyle = "#2f3136";
  ctx.fillRect(0, 0, c.width, c.height);

  // Ruido granular
  for (let i = 0; i < 3500; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const a = 0.06 + Math.random() * 0.06;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = `rgba(0,0,0,${a * 0.6})`;
    ctx.fillRect(x + Math.random() * 2, y + Math.random() * 2, 1, 1);
  }

  // Dobles líneas amarillas longitudinales y transversales se agregan como meshes.
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1.5);
  return tex;
}

function makeSidewalkTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#a9b1bd";
  ctx.fillRect(0, 0, c.width, c.height);

  // Baldosas
  ctx.strokeStyle = "#8f97a4";
  ctx.lineWidth = 2;
  const step = 32;
  for (let x = 0; x <= c.width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
  }
  for (let y = 0; y <= c.height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

function makeGrassTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const ctx = c.getContext("2d");

  // degradado suave
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, "#6ea96b");
  g.addColorStop(1, "#609a5f");
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);

  // puntos de color
  for (let i = 0; i < 2000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

function makeBuildingTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#b3b9c7";
  ctx.fillRect(0, 0, c.width, c.height);
  // Ventanas
  for (let y = 20; y < c.height; y += 40) {
    for (let x = 20; x < c.width; x += 40) {
      ctx.fillStyle = Math.random() > 0.15 ? "#e7edf8" : "#c9d4ea";
      ctx.fillRect(x, y, 24, 18);
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(x, y + 18, 24, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

/* =========================================================
   UTILIDADES DE MATERIALES
   ========================================================= */
function makeEmissiveMaterial(colorOff, colorOn) {
  const mat = new THREE.MeshStandardMaterial({
    color: colorOff,
    emissive: 0x000000,
    metalness: 0.2,
    roughness: 0.6,
  });
  mat.__off = new THREE.Color(colorOff);
  mat.__on  = new THREE.Color(colorOn);
  mat.__setOn = (on) => {
    if (on) { mat.color.copy(mat.__on); mat.emissive.copy(mat.__on).multiplyScalar(0.6); }
    else { mat.color.copy(mat.__off); mat.emissive.set(0x000000); }
  };
  mat.__setOn(false);
  return mat;
}

/* =========================================================
   MODELOS
   ========================================================= */
function createVehicularLight() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, metalness: 0.4, roughness: 0.5 });
  const bodyM = new THREE.MeshStandardMaterial({ color: 0x121212, metalness: 0.1, roughness: 0.8 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 20), metal);
  pole.position.y = 1.15; pole.castShadow = true; g.add(pole);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.05, 0.28), bodyM);
  head.position.set(0.32, 1.8, 0); head.castShadow = true; g.add(head);

  const bulbGeo = new THREE.SphereGeometry(0.1, 24, 16);
  const redM = makeEmissiveMaterial(0x330000, 0xff3b3b);
  const ambM = makeEmissiveMaterial(0x332200, 0xffdd6a);
  const grnM = makeEmissiveMaterial(0x003300, 0x30ff66);

  const R = new THREE.Mesh(bulbGeo, redM); R.position.set(0.32, 2.12, 0.14);
  const A = new THREE.Mesh(bulbGeo, ambM); A.position.set(0.32, 1.80, 0.14);
  const G = new THREE.Mesh(bulbGeo, grnM); G.position.set(0.32, 1.48, 0.14);
  [R, A, G].forEach(m => m.castShadow = true);

  g.add(R, A, G);
  return { group: g, mats: { red: redM, amber: ambM, green: grnM } };
}

function createPedestrianLight() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, metalness: 0.4, roughness: 0.5 });
  const bodyM = new THREE.MeshStandardMaterial({ color: 0x121212, metalness: 0.1, roughness: 0.8 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 18), metal);
  pole.position.y = 0.85; pole.castShadow = true; g.add(pole);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.18), bodyM);
  body.position.set(0.22, 1.25, 0); body.castShadow = true; g.add(body);

  const geo = new THREE.PlaneGeometry(0.18, 0.18);
  const redM = makeEmissiveMaterial(0x330000, 0xff3b3b);
  const grnM = makeEmissiveMaterial(0x003300, 0x30ff66);
  const R = new THREE.Mesh(geo, redM); R.position.set(0.22, 1.40, 0.10);
  const G = new THREE.Mesh(geo, grnM); G.position.set(0.22, 1.10, 0.10);
  [R, G].forEach(m => { m.castShadow = false; m.material.side = THREE.DoubleSide; });

  g.add(R, G);
  return { group: g, mats: { red: redM, green: grnM } };
}

function createCar(color = 0x3a7bd5, withLights = true) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.56), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 }));
  body.position.y = 0.2; body.castShadow = true; body.receiveShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.9 }));
  cabin.position.set(0, 0.34, 0); cabin.castShadow = true;

  g.add(body, cabin);

  if (withLights) {
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 });
    const headL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), lampMat);
    const headR = headL.clone();
    headL.position.set(0.55, 0.26, 0.16);
    headR.position.set(0.55, 0.26, -0.16);
    g.add(headL, headR);
  }
  return g;
}

function createPedestrian(color = 0xf2c17d) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 8, 16), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.35; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffe0bd }));
  head.position.y = 0.62; head.castShadow = true;
  g.add(body, head);
  return g;
}

/* =========================================================
   ENTORNO URBANO
   ========================================================= */
function buildCity(scene, textures) {
  // Césped base
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: textures.grass }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);

  // Carreteras
  const roadMat = new THREE.MeshStandardMaterial({ map: textures.asphalt });
  const roadX = new THREE.Mesh(new THREE.BoxGeometry(80, 0.02, 10), roadMat);
  const roadZ = new THREE.Mesh(new THREE.BoxGeometry(10, 0.02, 80), roadMat);
  roadX.position.y = 0.01; roadZ.position.y = 0.01;
  roadX.receiveShadow = roadZ.receiveShadow = true;
  scene.add(roadX, roadZ);

  // Aceras rectangulares alrededor del cruce
  const swMat = new THREE.MeshStandardMaterial({ map: textures.sidewalk });
  const sw1 = new THREE.Mesh(new THREE.BoxGeometry(20, 0.04, 8), swMat); sw1.position.set(-10, 0.02, -10);
  const sw2 = new THREE.Mesh(new THREE.BoxGeometry(20, 0.04, 8), swMat); sw2.position.set(10, 0.02, -10);
  const sw3 = new THREE.Mesh(new THREE.BoxGeometry(20, 0.04, 8), swMat); sw3.position.set(-10, 0.02, 10);
  const sw4 = new THREE.Mesh(new THREE.BoxGeometry(20, 0.04, 8), swMat); sw4.position.set(10, 0.02, 10);
  [sw1, sw2, sw3, sw4].forEach(m => { m.receiveShadow = true; scene.add(m); });

  // Doble línea amarilla (X y Z)
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffd047 });
  const lx1 = new THREE.Mesh(new THREE.BoxGeometry(80, 0.002, 0.1), yellow);
  const lx2 = lx1.clone();
  lx1.position.set(0, 0.015, 0.5); lx2.position.set(0, 0.015, -0.5);
  const lz1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.002, 80), yellow);
  const lz2 = lz1.clone();
  lz1.position.set(0.5, 0.015, 0); lz2.position.set(-0.5, 0.015, 0);
  scene.add(lx1, lx2, lz1, lz2);

  // Pasos de cebra
  const zebra = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const stripes = new THREE.Group();
  for (let i = -3; i <= 3; i++) {
    const sx1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.002, 0.28), zebra);
    sx1.position.set(-BOX_HALF + i * 1.0, 0.013, -BOX_HALF);
    stripes.add(sx1);
    const sx2 = sx1.clone(); sx2.position.set(-BOX_HALF + i * 1.0, 0.013, BOX_HALF); stripes.add(sx2);
    const sz1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.002, 0.5), zebra);
    sz1.position.set(-BOX_HALF, 0.013, -BOX_HALF + i * 1.0);
    stripes.add(sz1);
    const sz2 = sz1.clone(); sz2.position.set(BOX_HALF, 0.013, -BOX_HALF + i * 1.0); stripes.add(sz2);
  }
  scene.add(stripes);

  // Líneas de alto (stop)
  const stopM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const stopX = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.002, 6), stopM); stopX.position.set(STOP_X, 0.014, 0);
  const stopZ = new THREE.Mesh(new THREE.BoxGeometry(6, 0.002, 0.12), stopM); stopZ.position.set(0, 0.014, STOP_Z);
  scene.add(stopX, stopZ);

  // Edificios decorativos
  const btex = textures.building;
  for (let i = 0; i < 10; i++) {
    const w = 4 + Math.random() * 3;
    const d = 4 + Math.random() * 3;
    const h = 4 + Math.random() * 10;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: btex, roughness: 0.9 }));
    mesh.position.set((Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 25),
                      h / 2,
                      (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 25));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

/* =========================================================
   COMPONENTE PRINCIPAL
   ========================================================= */
export default function Cruce4ViasThreeJS() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfdfff);

    // Renderer con sombras
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // Cámara y controles
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 300);
    camera.position.set(18, 16, 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;

    // Cielo físico + sol
    const sky = new Sky(); sky.scale.setScalar(1000); scene.add(sky);
    const sun = new THREE.Vector3();
    function setSky(elevation = 50, azimuth = 180) {
      const phi = THREE.MathUtils.degToRad(90 - elevation);
      const theta = THREE.MathUtils.degToRad(azimuth);
      sun.setFromSphericalCoords(1, phi, theta);
      sky.material.uniforms["sunPosition"].value.copy(sun);
    }
    setSky(55, 180);

    // Luces
    const hemi = new THREE.HemisphereLight(0xffffff, 0x6688aa, 0.8);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(30, 50, 30);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -60; dir.shadow.camera.right = 60;
    dir.shadow.camera.top = 60; dir.shadow.camera.bottom = -60;
    scene.add(dir);

    // Texturas
    const textures = {
      asphalt: makeAsphaltTexture(),
      sidewalk: makeSidewalkTexture(),
      grass: makeGrassTexture(),
      building: makeBuildingTexture(),
    };

    // Ciudad
    buildCity(scene, textures);

    /* ---------- Semáforos vehiculares ---------- */
    const sv1 = createVehicularLight(); sv1.group.position.set(-BOX_HALF - 0.6, 0, -BOX_HALF - 0.6); // SO mirando al centro (+X)
    const sv1b = createVehicularLight(); sv1b.group.position.set(BOX_HALF + 0.6, 0, BOX_HALF + 0.6); // NE (-X)
    const sv2 = createVehicularLight(); sv2.group.position.set(BOX_HALF + 0.6, 0, -BOX_HALF - 0.6); // SE (+Z)
    const sv2b = createVehicularLight(); sv2b.group.position.set(-BOX_HALF - 0.6, 0, BOX_HALF + 0.6); // NO (-Z)
    // Orientación al centro
    sv1.group.rotation.y = -Math.PI / 2;
    sv1b.group.rotation.y = Math.PI / 2;
    sv2.group.rotation.y = 0;
    sv2b.group.rotation.y = Math.PI;
    scene.add(sv1.group, sv1b.group, sv2.group, sv2b.group);

    /* ---------- Semáforos peatonales ---------- */
    const sp1 = createPedestrianLight(); sp1.group.position.set(-BOX_HALF - 0.35, 0, -BOX_HALF);  sp1.group.rotation.y = 0;          // Sur mira +Z
    const sp1b = createPedestrianLight(); sp1b.group.position.set(BOX_HALF + 0.35, 0,  BOX_HALF); sp1b.group.rotation.y = Math.PI;  // Norte mira -Z
    const sp2 = createPedestrianLight(); sp2.group.position.set( BOX_HALF, 0, -BOX_HALF - 0.35);  sp2.group.rotation.y = -Math.PI/2;// Este mira -X
    const sp2b = createPedestrianLight(); sp2b.group.position.set(-BOX_HALF, 0,  BOX_HALF + 0.35); sp2b.group.rotation.y = Math.PI/2;// Oeste mira +X
    scene.add(sp1.group, sp1b.group, sp2.group, sp2b.group);

    // Ejes lógicos con swap físico
    let axisX = [sv1, sv1b];
    let axisZ = [sv2, sv2b];
    let pedX = [sp1, sp1b];
    let pedZ = [sp2, sp2b];
    if (MAP_SWAP) {
      [axisX, axisZ] = [axisZ, axisX];
      [pedX, pedZ] = [pedZ, pedX];
    }

    /* ---------- Autos ---------- */
    const carsX = []; const carsZ = [];
    for (let i = 0; i < 5; i++) {
      const c = createCar(0x3a7bd5 + i * 0x111100);
      c.position.set(-14 - i * 4, 0, -1.2 + (i % 2) * 2.4);
      c.castShadow = true; scene.add(c); carsX.push(c);
    }
    for (let i = 0; i < 5; i++) {
      const c = createCar(0xff7043 - i * 0x001100);
      c.rotation.y = Math.PI / 2;
      c.position.set(-1.2 + (i % 2) * 2.4, 0, -14 - i * 4);
      c.castShadow = true; scene.add(c); carsZ.push(c);
    }

    /* ---------- Peatones ---------- */
    const pedObjX = createPedestrian(0xb08df5); pedObjX.position.set(-BOX_HALF - 0.4, 0, -BOX_HALF - 0.6); scene.add(pedObjX);
    const pedObjZ = createPedestrian(0xf58d8d); pedObjZ.position.set(-BOX_HALF - 0.6, 0, -BOX_HALF - 0.4); scene.add(pedObjZ);

    /* ---------- Estado de ciclo ---------- */
    let phase = PHASES.A_GREEN;
    let t0 = performance.now();

    // flags unificadas
    let goX = false, goZ = false, walkX = false, walkZ = false;

    function setPhaseLights() {
      [...axisX, ...axisZ].forEach(s => { s.mats.red.__setOn(false); s.mats.amber.__setOn(false); s.mats.green.__setOn(false); });
      [...pedX, ...pedZ].forEach(s => { s.mats.red.__setOn(false); s.mats.green.__setOn(false); });

      const vehX_green = (phase === PHASES.A_GREEN);
      const vehX_amber = (phase === PHASES.A_AMBER);
      const vehZ_green = (phase === PHASES.B_GREEN);
      const vehZ_amber = (phase === PHASES.B_AMBER);

      if (vehX_green) axisX.forEach(s => s.mats.green.__setOn(true));
      else if (vehX_amber) axisX.forEach(s => s.mats.amber.__setOn(true));
      else axisX.forEach(s => s.mats.red.__setOn(true));

      if (vehZ_green) axisZ.forEach(s => s.mats.green.__setOn(true));
      else if (vehZ_amber) axisZ.forEach(s => s.mats.amber.__setOn(true));
      else axisZ.forEach(s => s.mats.red.__setOn(true));

      if (vehX_green) { pedZ.forEach(s => s.mats.green.__setOn(true)); pedX.forEach(s => s.mats.red.__setOn(true)); }
      else if (vehZ_green) { pedX.forEach(s => s.mats.green.__setOn(true)); pedZ.forEach(s => s.mats.red.__setOn(true)); }
      else { [...pedX, ...pedZ].forEach(s => s.mats.red.__setOn(true)); }

      // movimiento (solo verde)
      goX = vehX_green;
      goZ = vehZ_green;
      walkX = vehZ_green; // peatones opuestos
      walkZ = vehX_green;
    }
    setPhaseLights();

    /* ---------- Movimiento ---------- */
    function moveCars(dt) {
      const SPEED = 2.2;
      carsX.forEach((car, i) => {
        const beforeStop = car.position.x < STOP_X;
        const pastClear  = car.position.x >= CLEAR_X;
        const canGo = goX || pastClear;
        if (canGo) {
          car.position.x += SPEED * dt;
          if (car.position.x > 22) car.position.x = -22 - (i % 2) * 2;
        } else {
          const next = car.position.x + SPEED * dt;
          if (beforeStop && next > STOP_X) car.position.x = STOP_X;
        }
      });
      carsZ.forEach((car, i) => {
        const beforeStop = car.position.z < STOP_Z;
        const pastClear  = car.position.z >= CLEAR_Z;
        const canGo = goZ || pastClear;
        if (canGo) {
          car.position.z += SPEED * dt;
          if (car.position.z > 22) car.position.z = -22 - (i % 2) * 2;
        } else {
          const next = car.position.z + SPEED * dt;
          if (beforeStop && next > STOP_Z) car.position.z = STOP_Z;
        }
      });
    }

    function movePedestrians(dt) {
      const SPEED = 1.2;
      // Z cruza en X
      if (walkZ || pedObjZ.position.x > -BOX_HALF - 0.55) {
        pedObjZ.position.x += SPEED * dt;
        if (pedObjZ.position.x > BOX_HALF + 0.7) pedObjZ.position.x = -BOX_HALF - 0.6;
      }
      // X cruza en Z
      if (walkX || pedObjX.position.z > -BOX_HALF - 0.55) {
        pedObjX.position.z += SPEED * dt;
        if (pedObjX.position.z > BOX_HALF + 0.7) pedObjX.position.z = -BOX_HALF - 0.6;
      }
    }

    /* ---------- Día / Noche ---------- */
    let night = false;
    function setDayNight(n) {
      night = n;
      if (night) {
        setSky(10, 170);
        hemi.intensity = 0.25;
        dir.intensity = 0.35;
        scene.background = new THREE.Color(0x0a0f1a);
        renderer.shadowMap.enabled = true;
      } else {
        setSky(55, 180);
        hemi.intensity = 0.8;
        dir.intensity = 1.0;
        scene.background = new THREE.Color(0xbfdfff);
      }
    }
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "n") setDayNight(!night);
    });

    /* ---------- Animación ---------- */
    let last = performance.now();
    function animate() {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;

      if (now - t0 >= DUR_MS[phase]) {
        phase = (phase + 1) % 4;
        t0 = now;
        setPhaseLights();
      }

      moveCars(dt);
      movePedestrians(dt);

      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();

    /* ---------- Resize ---------- */
    function onResize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "85vh", borderRadius: 16, overflow: "hidden", background: "#0b1220", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      <div style={{position:"absolute",top:12,left:12,background:"rgba(255,255,255,0.9)",color:"#111",padding:"10px 12px",borderRadius:10,fontSize:12}}>
        <div style={{fontWeight:700}}>Cruce 4 vías • Lógica Arduino</div>
        <div>3s verde + 1s ámbar por eje • Autos solo en verde • Peatones opuestos</div>
        <div><b>N</b> = Día/Noche</div>
      </div>
    </div>
  );
}
