import * as THREE from "three";


// ============================================================
// LEAPVE
//
// BROWSER CALIBRATION ONLY
//
// CAMERA
//    ↓
// CALIBRATION PANEL
//    ↓
// THREE.JS TRANSPARENT OVERLAY
//    ↓
// P1 P2 P3 P4
//    ↓
// DRAGGABLE
//    ↓
// GLOW
//
// NO OPENCV
// NO 3D PIANO
//
// ============================================================


// ============================================================
// DOM
// ============================================================

const video =
    document.getElementById("camera");

const panel =
    document.getElementById("calibration-panel");

const container =
    document.getElementById("three-container");

const pointStatus =
    document.getElementById("point-status");

const coordinates =
    document.getElementById("coordinates");

const cameraStatus =
    document.getElementById("camera-status");

const startButton =
    document.getElementById("start-btn");

const resetButton =
    document.getElementById("reset-btn");


// ============================================================
// CALIBRATION STATE
// ============================================================

const MAX_POINTS = 4;

const points = [];

let calibrationActive = false;

let selectedPoint = null;

let dragging = false;


// ============================================================
// THREE.JS SCENE
// ============================================================

const scene =
    new THREE.Scene();


// ============================================================
// THREE.JS CAMERA
//
// IMPORTANT:
//
// This is NOT using window.innerWidth.
//
// It will be resized to the EXACT
// calibration panel dimensions.
//
// ============================================================

const camera =
    new THREE.OrthographicCamera(

        0,
        1000,

        1000,
        0,

        -1000,
        1000

    );

camera.position.z = 10;


// ============================================================
// RENDERER
// ============================================================

const renderer =
    new THREE.WebGLRenderer({

        alpha: true,

        antialias: true

    });


renderer.setPixelRatio(

    Math.min(

        window.devicePixelRatio,

        2

    )

);


renderer.setClearColor(
    0x000000,
    0
);


container.appendChild(
    renderer.domElement
);


// ============================================================
// RESIZE THREE.JS TO PANEL
//
// THIS IS THE MOST IMPORTANT FIX.
// ============================================================

function resizeCalibration() {

    const width =
        panel.clientWidth;

    const height =
        panel.clientHeight;


    if (
        width <= 0 ||
        height <= 0
    ) {

        return;

    }


    // -----------------------------------------
    // Orthographic coordinates
    //
    // 0,0 = TOP LEFT
    // width,height = BOTTOM RIGHT
    // -----------------------------------------

    camera.left = 0;

    camera.right = width;

    camera.top = 0;

    camera.bottom = height;


    camera.near = -1000;

    camera.far = 1000;


    camera.updateProjectionMatrix();


    renderer.setSize(

        width,

        height,

        false

    );


    updateVisuals();

}


window.addEventListener(
    "resize",
    resizeCalibration
);


// ============================================================
// CAMERA
// ============================================================

async function startCamera() {

    cameraStatus.textContent =
        "CAMERA: REQUESTING...";


    try {

        const stream =
            await navigator.mediaDevices
                .getUserMedia({

                    video: {

                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        },

                        facingMode:
                            "user"

                    },

                    audio: false

                });


        video.srcObject =
            stream;


        await video.play();


        cameraStatus.textContent =
            "CAMERA: READY";


        cameraStatus.style.color =
            "#00ff66";


        console.log(
            "✅ Camera initialized"
        );


        // Wait for video dimensions
        // before sizing the overlay.

        if (
            video.readyState >= 1
        ) {

            resizeCalibration();

        }


    }

    catch (error) {

        console.error(
            "Camera error:",
            error
        );


        cameraStatus.textContent =
            "CAMERA: ERROR";


        cameraStatus.style.color =
            "#ff4444";


        pointStatus.textContent =
            "CAMERA ERROR";

    }

}


startCamera();


// ============================================================
// POINT GROUP
// ============================================================

const pointGroup =
    new THREE.Group();

scene.add(
    pointGroup
);


// ============================================================
// POINT MESHES
// ============================================================

const pointMeshes = [];


// ============================================================
// CREATE POINTS
// ============================================================

for (
    let i = 0;
    i < MAX_POINTS;
    i++
) {


    // --------------------------------------------------------
    // OUTER GLOW
    // --------------------------------------------------------

    const glowGeometry =
        new THREE.CircleGeometry(

            24,

            40

        );


    const glowMaterial =
        new THREE.MeshBasicMaterial({

            color:
                0x00ff66,

            transparent:
                true,

            opacity:
                0.18,

            depthTest:
                false

        });


    const glow =
        new THREE.Mesh(

            glowGeometry,

            glowMaterial

        );


    glow.position.z =
        -1;


    // --------------------------------------------------------
    // INNER GLOW
    // --------------------------------------------------------

    const innerGlowGeometry =
        new THREE.CircleGeometry(

            13,

            40

        );


    const innerGlowMaterial =
        new THREE.MeshBasicMaterial({

            color:
                0x00ffff,

            transparent:
                true,

            opacity:
                0.35,

            depthTest:
                false

        });


    const innerGlow =
        new THREE.Mesh(

            innerGlowGeometry,

            innerGlowMaterial

        );


    innerGlow.position.z =
        -0.5;


    // --------------------------------------------------------
    // MAIN POINT
    // --------------------------------------------------------

    const geometry =
        new THREE.CircleGeometry(

            7,

            32

        );


    const material =
        new THREE.MeshBasicMaterial({

            color:
                0xffffff,

            depthTest:
                false

        });


    const point =
        new THREE.Mesh(

            geometry,

            material

        );


    point.position.z =
        10;


    point.add(
        glow
    );

    point.add(
        innerGlow
    );


    point.visible =
        false;


    point.userData.index =
        i;


    pointGroup.add(
        point
    );


    pointMeshes.push(
        point
    );

}


// ============================================================
// LABELS
// ============================================================

const labels = [];


// ============================================================
// CREATE LABELS
// ============================================================

for (
    let i = 0;
    i < MAX_POINTS;
    i++
) {


    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width =
        128;

    canvas.height =
        64;


    const ctx =
        canvas.getContext(
            "2d"
        );


    ctx.clearRect(

        0,
        0,
        128,
        64

    );


    ctx.font =
        "bold 32px Arial";


    ctx.fillStyle =
        "#00ff66";


    ctx.shadowColor =
        "#00ff66";


    ctx.shadowBlur =
        12;


    ctx.fillText(

        `P${i + 1}`,

        10,
        38

    );


    const texture =
        new THREE.CanvasTexture(
            canvas
        );


    texture.needsUpdate =
        true;


    const material =
        new THREE.SpriteMaterial({

            map:
                texture,

            transparent:
                true,

            depthTest:
                false

        });


    const sprite =
        new THREE.Sprite(
            material
        );


    sprite.scale.set(

        70,
        35,
        1

    );


    sprite.visible =
        false;


    sprite.position.z =
        20;


    scene.add(
        sprite
    );


    labels.push(
        sprite
    );

}


// ============================================================
// EDGE LINES
// ============================================================

const edgeLines = [];


// ============================================================
// CREATE 4 EDGES
// ============================================================

for (
    let i = 0;
    i < 4;
    i++
) {


    // --------------------------------------------------------
    // GLOW EDGE
    // --------------------------------------------------------

    const glowGeometry =
        new THREE.BufferGeometry();


    const glowMaterial =
        new THREE.LineBasicMaterial({

            color:
                0x00ffff,

            transparent:
                true,

            opacity:
                0.25,

            depthTest:
                false

        });


    const glowLine =
        new THREE.Line(

            glowGeometry,

            glowMaterial

        );


    glowLine.position.z =
        1;


    glowLine.visible =
        false;


    scene.add(
        glowLine
    );


    // --------------------------------------------------------
    // MAIN EDGE
    // --------------------------------------------------------

    const lineGeometry =
        new THREE.BufferGeometry();


    const lineMaterial =
        new THREE.LineBasicMaterial({

            color:
                0x00ffff,

            transparent:
                true,

            opacity:
                1,

            depthTest:
                false

        });


    const line =
        new THREE.Line(

            lineGeometry,

            lineMaterial

        );


    line.position.z =
        5;


    line.visible =
        false;


    scene.add(
        line
    );


    edgeLines.push({

        line,

        glowLine

    });

}


// ============================================================
// MOUSE → PANEL COORDINATES
//
// IMPORTANT:
//
// We use the calibration panel's
// bounding rectangle.
//
// NOT window coordinates.
//
// ============================================================

function pointerToPanel(
    event
) {

    const rect =
        panel.getBoundingClientRect();


    let x =
        event.clientX -
        rect.left;


    let y =
        event.clientY -
        rect.top;


    // Clamp

    x =
        Math.max(

            0,

            Math.min(

                x,

                panel.clientWidth

            )

        );


    y =
        Math.max(

            0,

            Math.min(

                y,

                panel.clientHeight

            )

        );


    return {

        x,
        y

    };

}


// ============================================================
// DISTANCE
// ============================================================

function distance(
    a,
    b
) {

    const dx =
        a.x - b.x;

    const dy =
        a.y - b.y;


    return Math.sqrt(

        dx * dx +
        dy * dy

    );

}


// ============================================================
// FIND NEAREST POINT
// ============================================================

function findNearestPoint(
    mouse
) {

    let nearest =
        null;

    let nearestDistance =
        Infinity;


    for (
        let i = 0;
        i < points.length;
        i++
    ) {

        const d =
            distance(

                mouse,

                points[i]

            );


        if (
            d <
            nearestDistance
        ) {

            nearestDistance =
                d;

            nearest =
                i;

        }

    }


    return {

        index:
            nearest,

        distance:
            nearestDistance

    };

}


// ============================================================
// POINTER DOWN
// ============================================================

renderer.domElement.addEventListener(

    "pointerdown",

    event => {


        if (
            !calibrationActive
        ) {

            return;

        }


        event.preventDefault();


        const mouse =
            pointerToPanel(
                event
            );


        // ----------------------------------------------------
        // TRY EXISTING POINT FIRST
        // ----------------------------------------------------

        if (
            points.length > 0
        ) {

            const nearest =
                findNearestPoint(
                    mouse
                );


            if (

                nearest.index !== null &&

                nearest.distance < 35

            ) {

                selectedPoint =
                    nearest.index;

                dragging =
                    true;


                renderer.domElement
                    .setPointerCapture(
                        event.pointerId
                    );


                pointStatus.textContent =
                    `DRAGGING P${selectedPoint + 1}`;


                return;

            }

        }


        // ----------------------------------------------------
        // CREATE NEW POINT
        // ----------------------------------------------------

        if (
            points.length <
            MAX_POINTS
        ) {

            points.push({

                x:
                    mouse.x,

                y:
                    mouse.y

            });


            updateVisuals();

            updateStatus();


            console.log(

                `P${points.length}:`,

                mouse.x.toFixed(1),

                mouse.y.toFixed(1)

            );

        }

    }

);


// ============================================================
// POINTER MOVE
// ============================================================

renderer.domElement.addEventListener(

    "pointermove",

    event => {


        if (
            !dragging ||
            selectedPoint === null
        ) {

            return;

        }


        event.preventDefault();


        const mouse =
            pointerToPanel(
                event
            );


        points[
            selectedPoint
        ].x =
            mouse.x;


        points[
            selectedPoint
        ].y =
            mouse.y;


        updateVisuals();


        pointStatus.textContent =
            `DRAGGING P${selectedPoint + 1}`;

    }

);


// ============================================================
// POINTER UP
// ============================================================

renderer.domElement.addEventListener(

    "pointerup",

    event => {


        if (
            !dragging
        ) {

            return;

        }


        dragging =
            false;


        selectedPoint =
            null;


        try {

            renderer.domElement
                .releasePointerCapture(
                    event.pointerId
                );

        }

        catch {}

        
        updateStatus();

    }

);


// ============================================================
// UPDATE VISUALS
// ============================================================

function updateVisuals() {


    // ========================================================
    // POINTS
    // ========================================================

    for (
        let i = 0;
        i < MAX_POINTS;
        i++
    ) {

        const mesh =
            pointMeshes[i];

        const label =
            labels[i];


        if (
            i < points.length
        ) {

            const p =
                points[i];


            mesh.position.set(

                p.x,
                p.y,
                10

            );


            mesh.visible =
                true;


            label.position.set(

                p.x + 28,
                p.y - 20,
                20

            );


            label.visible =
                true;

        }

        else {

            mesh.visible =
                false;

            label.visible =
                false;

        }

    }


    // ========================================================
    // EDGES
    // ========================================================

    for (
        let i = 0;
        i < 4;
        i++
    ) {

        const edge =
            edgeLines[i];


        const aIndex =
            i;


        const bIndex =
            (i + 1) % 4;


        // Need both points

        if (

            aIndex >= points.length ||
            bIndex >= points.length

        ) {

            edge.line.visible =
                false;

            edge.glowLine.visible =
                false;

            continue;

        }


        const a =
            points[aIndex];

        const b =
            points[bIndex];


        // ----------------------------------------------------
        // MAIN LINE
        // ----------------------------------------------------

        const vertices =
            new Float32Array([

                a.x,
                a.y,
                5,

                b.x,
                b.y,
                5

            ]);


        edge.line.geometry
            .setAttribute(

                "position",

                new THREE.BufferAttribute(

                    vertices,

                    3

                )

            );


        edge.line.geometry
            .attributes
            .position
            .needsUpdate =
                true;


        edge.line.geometry.computeBoundingSphere();


        edge.line.visible =
            true;


        // ----------------------------------------------------
        // GLOW LINE
        // ----------------------------------------------------

        const glowVertices =
            new Float32Array([

                a.x,
                a.y,
                1,

                b.x,
                b.y,
                1

            ]);


        edge.glowLine.geometry
            .setAttribute(

                "position",

                new THREE.BufferAttribute(

                    glowVertices,

                    3

                )

            );


        edge.glowLine.geometry
            .attributes
            .position
            .needsUpdate =
                true;


        edge.glowLine.geometry.computeBoundingSphere();


        edge.glowLine.visible =
            true;

    }


    updateCoordinates();

}


// ============================================================
// COORDINATE DISPLAY
// ============================================================

function updateCoordinates() {


    if (
        points.length === 0
    ) {

        coordinates.textContent =
            "No points";

        return;

    }


    coordinates.innerHTML =
        points
            .map(

                (p, i) =>

                    `P${i + 1}: ` +
                    `${Math.round(p.x)}, ` +
                    `${Math.round(p.y)}`

            )
            .join("<br>");

}


// ============================================================
// STATUS
// ============================================================

function updateStatus() {


    if (
        !calibrationActive
    ) {

        pointStatus.textContent =
            "PRESS START";

        return;

    }


    if (
        points.length === 0
    ) {

        pointStatus.textContent =
            "SELECT P1";

        return;

    }


    if (
        points.length === 1
    ) {

        pointStatus.textContent =
            "P1 SET → SELECT P2";

        return;

    }


    if (
        points.length === 2
    ) {

        pointStatus.textContent =
            "P2 SET → SELECT P3";

        return;

    }


    if (
        points.length === 3
    ) {

        pointStatus.textContent =
            "P3 SET → SELECT P4";

        return;

    }


    if (
        points.length === 4
    ) {

        pointStatus.textContent =
            "✓ 4 POINTS CALIBRATED — DRAG TO EDIT";

    }

}


// ============================================================
// RESET
// ============================================================

function resetPoints() {


    points.length =
        0;


    selectedPoint =
        null;


    dragging =
        false;


    updateVisuals();

    updateStatus();


    console.log(
        "🔄 Calibration reset"
    );

}


// ============================================================
// START CALIBRATION
// ============================================================

startButton.addEventListener(

    "click",

    () => {


        calibrationActive =
            true;


        resetPoints();


        startButton.textContent =
            "CALIBRATION ACTIVE";


        startButton.style.background =
            "#ffff00";


        pointStatus.textContent =
            "SELECT P1";


        console.log(
            "🎯 Calibration initialized"
        );

    }

);


// ============================================================
// RESET BUTTON
// ============================================================

resetButton.addEventListener(

    "click",

    () => {

        resetPoints();

    }

);


// ============================================================
// KEYBOARD RESET
// ============================================================

window.addEventListener(

    "keydown",

    event => {


        if (
            event.key.toLowerCase() ===
            "r"
        ) {

            resetPoints();

        }

    }

);


// ============================================================
// GLOW ANIMATION
// ============================================================

let glowTime = 0;


function animateGlow(
    delta
) {

    glowTime +=
        delta;


    // ========================================================
    // POINT GLOW
    // ========================================================

    const pointPulse =
        0.12 +

        (
            Math.sin(
                glowTime * 4
            ) + 1
        ) * 0.10;


    for (
        const mesh of pointMeshes
    ) {

        if (
            !mesh.visible
        ) {

            continue;

        }


        const glow =
            mesh.children[0];


        const innerGlow =
            mesh.children[1];


        glow.material.opacity =
            pointPulse;


        innerGlow.material.opacity =
            0.25 +

            (
                Math.sin(
                    glowTime * 5
                ) + 1
            ) * 0.15;

    }


    // ========================================================
    // EDGE GLOW
    // ========================================================

    const edgePulse =
        0.15 +

        (
            Math.sin(
                glowTime * 3
            ) + 1
        ) * 0.15;


    for (
        const edge of edgeLines
    ) {

        edge.glowLine
            .material
            .opacity =
                edgePulse;

    }

}


// ============================================================
// ANIMATION
// ============================================================

const clock =
    new THREE.Clock();


function animate() {


    requestAnimationFrame(
        animate
    );


    const delta =
        clock.getDelta();


    animateGlow(
        delta
    );


    renderer.render(
        scene,
        camera

    );

}


animate();


// ============================================================
// INITIAL RESIZE
// ============================================================

resizeCalibration();


// ============================================================
// INITIAL STATUS
// ============================================================

updateStatus();


console.log(
    "🚀 LeapVE calibration layer ready"
);