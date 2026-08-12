import * as THREE from "three";


// ============================================================
// LEAPVE
//
// BROWSER 4-POINT CALIBRATION
//
// Camera
//    ↓
// Three.js transparent layer
//    ↓
// P1 P2 P3 P4
//    ↓
// Editable polygon
//    ↓
// Glowing edges
//
// OpenCV is NOT involved yet.
//
// ============================================================


// ============================================================
// 1. CAMERA
// ============================================================

const video =
    document.getElementById("camera");


// ============================================================
// 2. UI
// ============================================================

const pointStatus =
    document.getElementById("point-status");


// ============================================================
// 3. START CAMERA
// ============================================================

async function startCamera() {

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
                        }

                    },

                    audio: false

                });


        video.srcObject =
            stream;


        console.log(
            "✅ Browser camera started"
        );

    }

    catch (error) {

        console.error(
            "❌ Camera error:",
            error
        );

        pointStatus.textContent =
            "CAMERA ERROR";

    }

}


startCamera();


// ============================================================
// 4. THREE.JS SCENE
// ============================================================

const scene =
    new THREE.Scene();


// ============================================================
// 5. ORTHOGRAPHIC CAMERA
//
// This is important.
//
// We want browser coordinates:
//
// (0,0)
//   ┌─────────────────────┐
//   │                     │
//   │       CAMERA        │
//   │                     │
//   └─────────────────────┘
//                  (W,H)
//
// So Three.js behaves like a 2D canvas.
// ============================================================

const camera =
    new THREE.OrthographicCamera(

        0,
        window.innerWidth,

        window.innerHeight,
        0,

        -1000,
        1000

    );


camera.position.z =
    10;


// ============================================================
// 6. RENDERER
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


renderer.setSize(

    window.innerWidth,

    window.innerHeight

);


renderer.setClearColor(
    0x000000,
    0
);


document
    .getElementById(
        "three-container"
    )
    .appendChild(
        renderer.domElement
    );


// ============================================================
// 7. POINT STORAGE
//
// Same order as OpenCV:
//
// P1 = TOP LEFT
// P2 = TOP RIGHT
// P3 = BOTTOM RIGHT
// P4 = BOTTOM LEFT
// ============================================================

const points = [];


// Maximum points

const MAX_POINTS = 4;


// Currently dragged point

let selectedPoint =
    null;


// Is mouse dragging?

let dragging =
    false;


// ============================================================
// 8. POINT GROUP
// ============================================================

const pointGroup =
    new THREE.Group();

scene.add(
    pointGroup
);


// ============================================================
// 9. GLOW POINT MATERIAL
// ============================================================

const pointMaterial =
    new THREE.MeshBasicMaterial({

        color: 0x00ff66

    });


// ============================================================
// 10. POINT MESHES
// ============================================================

const pointMeshes = [];


// Create four point objects

for (
    let i = 0;
    i < MAX_POINTS;
    i++
) {

    // Outer glow

    const glowGeometry =
        new THREE.CircleGeometry(
            18,
            32
        );


    const glowMaterial =
        new THREE.MeshBasicMaterial({

            color: 0x00ff66,

            transparent: true,

            opacity: 0.15

        });


    const glow =
        new THREE.Mesh(

            glowGeometry,

            glowMaterial

        );


    // Main point

    const geometry =
        new THREE.CircleGeometry(
            8,
            32
        );


    const point =
        new THREE.Mesh(

            geometry,

            pointMaterial.clone()

        );


    // Add glow behind point

    glow.position.z =
        -1;


    point.add(
        glow
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
// 11. LABELS
// ============================================================

const labels = [];


// Create P1/P2/P3/P4 labels

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
        canvas.width,
        canvas.height
    );


    ctx.font =
        "bold 32px Arial";


    ctx.fillStyle =
        "#00ff66";


    ctx.shadowColor =
        "#00ff66";


    ctx.shadowBlur =
        10;


    ctx.fillText(

        `P${i + 1}`,

        10,
        38

    );


    const texture =
        new THREE.CanvasTexture(
            canvas
        );


    const material =
        new THREE.SpriteMaterial({

            map: texture,

            transparent: true,

            depthTest: false

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
        10;


    scene.add(
        sprite
    );


    labels.push(
        sprite
    );

}


// ============================================================
// 12. EDGE LINES
//
// P1 → P2
// P2 → P3
// P3 → P4
// P4 → P1
// ============================================================

const edgeLines = [];


// Four edges

for (
    let i = 0;
    i < 4;
    i++
) {

    // Outer glow

    const glowMaterial =
        new THREE.LineBasicMaterial({

            color: 0x00ffff,

            transparent: true,

            opacity: 0.18

        });


    const glowGeometry =
        new THREE.BufferGeometry();


    const glowLine =
        new THREE.Line(

            glowGeometry,

            glowMaterial

        );


    glowLine.visible =
        false;


    glowLine.scale.set(
        1,
        1,
        1
    );


    scene.add(
        glowLine
    );


    // Main line

    const lineMaterial =
        new THREE.LineBasicMaterial({

            color: 0x00ffff,

            transparent: true,

            opacity: 1

        });


    const lineGeometry =
        new THREE.BufferGeometry();


    const line =
        new THREE.Line(

            lineGeometry,

            lineMaterial

        );


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
// 13. CONVERT MOUSE → THREE COORDINATES
// ============================================================

function mouseToWorld(
    event
) {

    const rect =
        renderer.domElement
            .getBoundingClientRect();


    const x =
        event.clientX -
        rect.left;


    const y =
        event.clientY -
        rect.top;


    return new THREE.Vector3(

        x,

        y,

        0

    );

}


// ============================================================
// 14. DISTANCE FROM MOUSE TO POINT
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
// 15. FIND NEAREST POINT
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
            d < nearestDistance
        ) {

            nearestDistance =
                d;

            nearest =
                i;

        }

    }


    return {

        index: nearest,

        distance:
            nearestDistance

    };

}


// ============================================================
// 16. MOUSE DOWN
// ============================================================

renderer.domElement.addEventListener(

    "pointerdown",

    event => {

        const mouse =
            mouseToWorld(
                event
            );


        // ----------------------------------------------------
        // FIRST: TRY TO DRAG EXISTING POINT
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
                nearest.distance < 30
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
        // OTHERWISE CREATE NEW POINT
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

        }

    }

);


// ============================================================
// 17. POINTER MOVE
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


        const mouse =
            mouseToWorld(
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

    }

);


// ============================================================
// 18. POINTER UP
// ============================================================

renderer.domElement.addEventListener(

    "pointerup",

    event => {

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

        catch (error) {}

        
        updateStatus();

    }

);


// ============================================================
// 19. UPDATE POINT VISUALS
// ============================================================

function updateVisuals() {


    // --------------------------------------------------------
    // POINTS
    // --------------------------------------------------------

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

                5

            );


            mesh.visible =
                true;


            label.position.set(

                p.x + 25,

                p.y - 20,

                10

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


    // --------------------------------------------------------
    // EDGES
    // --------------------------------------------------------

    for (
        let i = 0;
        i < 4;
        i++
    ) {

        const edge =
            edgeLines[i];


        // Need at least two points

        if (
            points.length <
            2
        ) {

            edge.line.visible =
                false;

            edge.glowLine.visible =
                false;

            continue;

        }


        // Don't draw edge until
        // its points exist

        const aIndex =
            i;


        const bIndex =
            (i + 1) % 4;


        if (
            aIndex >=
            points.length ||
            bIndex >=
            points.length
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


        const vertices =
            new Float32Array([

                a.x,
                a.y,
                2,

                b.x,
                b.y,
                2

            ]);


        edge.line.geometry.setAttribute(

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


        edge.line.visible =
            true;


        // ----------------------------------------------------
        // GLOW
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


        edge.glowLine.visible =
            true;

    }

}


// ============================================================
// 20. STATUS
// ============================================================

function updateStatus() {

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
            "✅ 4 POINTS CALIBRATED — DRAG TO EDIT";

    }

}


// ============================================================
// 21. RESET
// ============================================================

window.addEventListener(

    "keydown",

    event => {

        if (
            event.key.toLowerCase() ===
            "r"
        ) {

            points.length =
                0;


            selectedPoint =
                null;


            dragging =
                false;


            updateVisuals();

            updateStatus();


            console.log(
                "🔄 Four points reset"
            );

        }

    }

);


// ============================================================
// 22. RESIZE
// ============================================================

window.addEventListener(

    "resize",

    () => {

        camera.left =
            0;

        camera.right =
            window.innerWidth;

        camera.top =
            window.innerHeight;

        camera.bottom =
            0;


        camera.updateProjectionMatrix();


        renderer.setSize(

            window.innerWidth,

            window.innerHeight

        );


        updateVisuals();

    }

);


// ============================================================
// 23. GLOW ANIMATION
// ============================================================

let glowTime =
    0;


function animateGlow(
    delta
) {

    glowTime +=
        delta;


    // Pulsing point glow

    const pulse =
        0.10 +
        (
            Math.sin(
                glowTime * 4
            ) + 1
        ) * 0.08;


    for (
        const mesh of pointMeshes
    ) {

        if (
            mesh.visible
        ) {

            const glow =
                mesh.children[0];


            glow.material.opacity =
                pulse;

        }

    }


    // Pulsing edge glow

    const edgePulse =
        0.12 +
        (
            Math.sin(
                glowTime * 3
            ) + 1
        ) * 0.08;


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
// 24. ANIMATION LOOP
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
// START
// ============================================================

updateStatus();

console.log(
    "🚀 LeapVE browser 4-point calibration ready"
);