import * as THREE from "three";

const container = document.getElementById("three-container");
const status    = document.getElementById("status");

// ── THREE.JS SCENE ──
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(
    0, window.innerWidth, window.innerHeight, 0, -1000, 1000
);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// ── MARKERS (green circles) ──
const pointGeometry = new THREE.CircleGeometry(8, 24);
const pointMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const pointMeshes = [];
for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(pointGeometry, pointMaterial.clone());
    mesh.visible = false;
    scene.add(mesh);
    pointMeshes.push(mesh);
}

// ── BORDER (cyan outline) ──
const borderMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 });
const borderGeometry = new THREE.BufferGeometry();
const border = new THREE.LineLoop(borderGeometry, borderMaterial);
border.visible = false;
scene.add(border);

// ── SOCKET.IO ──
const socket = io("http://localhost:5000");

socket.on("connect", () => {
    console.log("Connected to LeapVE server");
    status.innerHTML = "LEAPVE<br>Camera: CONNECTED<br>Points: WAITING";
});

socket.on("piano_points", (data) => {
    if (!data || !data.points || data.points.length !== 4 || !data.frame) return;

    const pts = data.points;
    const fw = data.frame.width;
    const fh = data.frame.height;

    // Scale raw OpenCV pixels to browser window size
    const scaleX = window.innerWidth / fw;
    const scaleY = window.innerHeight / fh;

    const positions = [];

    for (let i = 0; i < 4; i++) {
        const x = pts[i][0] * scaleX;
        const y = window.innerHeight - (pts[i][1] * scaleY); // flip Y

        pointMeshes[i].position.set(x, y, 20);
        pointMeshes[i].visible = true;

        positions.push(x, y, 10);
    }

    // Update border
    borderGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(positions), 3)
    );
    borderGeometry.attributes.position.needsUpdate = true;
    border.visible = true;

    status.innerHTML = "LEAPVE<br>Camera: CONNECTED<br>Points: 4/4 TRACKED";
});

// ── RESIZE ──
window.addEventListener("resize", () => {
    camera.right = window.innerWidth;
    camera.top   = window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── LOOP ──
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();