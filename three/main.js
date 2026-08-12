import * as THREE from "three";

// ============================================================
// SOCKET.IO
// ============================================================
const socket = io("http://localhost:5000");
let pianoPoints = null;

socket.on("connect",    () => console.log("✅ Connected to OpenCV"));
socket.on("disconnect", () => console.log("❌ OpenCV disconnected"));
socket.on("piano_points", (data) => {
    if (data && data.points) pianoPoints = data.points;
});

// ============================================================
// THREE.JS SCENE  (transparent background so video shows through)
// ============================================================
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100
);
camera.position.set(0, 3, 6);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(2, 5, 4);
scene.add(dirLight);

// ============================================================
// 7-KEY PIANO
// ============================================================
const pianoGroup = new THREE.Group();
scene.add(pianoGroup);

const keyWidth  = 0.25;
const keyHeight = 0.08;
const keyDepth  = 1.2;
const keyGeom   = new THREE.BoxGeometry(keyWidth, keyHeight, keyDepth);

for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.3, metalness: 0.1
    });
    const key = new THREE.Mesh(keyGeom, mat);
    key.position.set((i - 3) * keyWidth, keyHeight / 2, 0);
    pianoGroup.add(key);

    const edges = new THREE.EdgesGeometry(keyGeom);
    const line  = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 })
    );
    key.add(line);
}

// ============================================================
// COORDINATE MAPPING
// ============================================================
const CAM_W = 1280;
const CAM_H = 720;

function videoToScreen(vx, vy) {
    const vAspect = CAM_W / CAM_H;
    const wAspect = window.innerWidth / window.innerHeight;
    let scale, offX, offY;

    if (wAspect > vAspect) {
        scale = window.innerHeight / CAM_H;
        offX  = (window.innerWidth  - CAM_W * scale) / 2;
        offY  = 0;
    } else {
        scale = window.innerWidth / CAM_W;
        offX  = 0;
        offY  = (window.innerHeight - CAM_H * scale) / 2;
    }
    return { x: vx * scale + offX, y: vy * scale + offY };
}

function screenToWorld(sx, sy) {
    const ndcX = (sx / window.innerWidth)  * 2 - 1;
    const ndcY = -(sy / window.innerHeight) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -keyHeight / 2);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    return target;
}

// ============================================================
// UPDATE PIANO FROM OPENCV
// ============================================================
function updatePianoFromOpenCV() {
    if (!pianoPoints || pianoPoints.length !== 4) return;

    const s0 = videoToScreen(pianoPoints[0][0], pianoPoints[0][1]);
    const s1 = videoToScreen(pianoPoints[1][0], pianoPoints[1][1]);
    const s2 = videoToScreen(pianoPoints[2][0], pianoPoints[2][1]);
    const s3 = videoToScreen(pianoPoints[3][0], pianoPoints[3][1]);

    const w0 = screenToWorld(s0.x, s0.y);
    const w1 = screenToWorld(s1.x, s1.y);
    const w2 = screenToWorld(s2.x, s2.y);
    const w3 = screenToWorld(s3.x, s3.y);

    if (!w0 || !w1 || !w2 || !w3) return;

    const center = new THREE.Vector3();
    [w0, w1, w2, w3].forEach(w => center.add(w));
    center.multiplyScalar(0.25);

    const widthTop    = w0.distanceTo(w1);
    const widthBottom = w3.distanceTo(w2);
    const avgWidth    = (widthTop + widthBottom) / 2;

    const depthLeft  = w0.distanceTo(w3);
    const depthRight = w1.distanceTo(w2);
    const avgDepth   = (depthLeft + depthRight) / 2;

    const angle = Math.atan2(w1.z - w0.z, w1.x - w0.x);

    pianoGroup.position.copy(center);
    pianoGroup.position.y = keyHeight / 2;

    const totalKeyWidth = 7 * keyWidth;
    pianoGroup.scale.set(
        Math.max(avgWidth / totalKeyWidth, 0.01),
        1,
        Math.max(avgDepth / keyDepth, 0.01)
    );

    pianoGroup.rotation.y = angle;
}

// ============================================================
// RESIZE
// ============================================================
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// ANIMATION
// ============================================================
function animate() {
    requestAnimationFrame(animate);
    updatePianoFromOpenCV();
    renderer.render(scene, camera);
}
animate();
