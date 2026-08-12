import * as THREE from "three";


// ============================================================
// LEAPVE AR
// THREE.JS BROWSER 4-POINT CALIBRATION
//
// CAMERA
//   ↓
// THREE.JS TRANSPARENT OVERLAY
//   ↓
// CLICK 4 POINTS
//   ↓
// GLOWING CORNERS
//   ↓
// GLOWING BORDER
//   ↓
// DRAG TO EDIT
//
// OpenCV is NOT involved yet.
// ============================================================


// ============================================================
// DOM
// ============================================================

const container =
    document.getElementById("three-container");

const initializeButton =
    document.getElementById("initializeButton");

const resetButton =
    document.getElementById("resetButton");

const statusElement =
    document.getElementById("status");


// ============================================================
// THREE.JS SCENE
// ============================================================

const scene =
    new THREE.Scene();


// ============================================================
// ORTHOGRAPHIC CAMERA
// ============================================================

const camera =
    new THREE.OrthographicCamera(
        -1,
         1,
         1,
        -1,
        0.1,
        100
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


renderer.setSize(
    window.innerWidth,
    window.innerHeight
);


// IMPORTANT
// Transparent Three.js layer.

renderer.setClearColor(
    0x000000,
    0
);


container.appendChild(
    renderer.domElement
);


// ============================================================
// ALLOW MOUSE INPUT
// ============================================================

renderer.domElement.style.pointerEvents =
    "auto";


// ============================================================
// STATE
// ============================================================

let initialized = false;

let points = [];

let draggingPoint = -1;


// ============================================================
// POINT LIMIT
// ============================================================

const MAX_POINTS = 4;


// ============================================================
// COLORS
// ============================================================

const POINT_COLOR =
    0x00ffcc;

const GLOW_COLOR =
    0x00ffff;


// ============================================================
// POINT GROUP
// ============================================================

const pointGroup =
    new THREE.Group();

scene.add(
    pointGroup
);


// ============================================================
// LINE GROUP
// ============================================================

const lineGroup =
    new THREE.Group();

scene.add(
    lineGroup
);


// ============================================================
// CREATE GLOWING POINT
// ============================================================

function createPointMesh(
    x,
    y,
    index
) {

    const group =
        new THREE.Group();


    // --------------------------------------------------------
    // OUTER GLOW
    // --------------------------------------------------------

    const glowGeometry =
        new THREE.CircleGeometry(
            0.035,
            32
        );


    const glowMaterial =
        new THREE.MeshBasicMaterial({

            color: GLOW_COLOR,

            transparent: true,

            opacity: 0.20,

            depthWrite: false

        });


    const glow =
        new THREE.Mesh(
            glowGeometry,
            glowMaterial
        );


    group.add(
        glow
    );


    // --------------------------------------------------------
    // MIDDLE GLOW
    // --------------------------------------------------------

    const middleGeometry =
        new THREE.CircleGeometry(
            0.022,
            32
        );


    const middleMaterial =
        new THREE.MeshBasicMaterial({

            color: GLOW_COLOR,

            transparent: true,

            opacity: 0.45,

            depthWrite: false

        });


    const middle =
        new THREE.Mesh(
            middleGeometry,
            middleMaterial
        );


    group.add(
        middle
    );


    // --------------------------------------------------------
    // CORE
    // --------------------------------------------------------

    const coreGeometry =
        new THREE.CircleGeometry(
            0.012,
            32
        );


    const coreMaterial =
        new THREE.MeshBasicMaterial({

            color: POINT_COLOR

        });


    const core =
        new THREE.Mesh(
            coreGeometry,
            coreMaterial
        );


    group.add(
        core
    );


    // --------------------------------------------------------
    // POSITION
    // --------------------------------------------------------

    group.position.set(
        x,
        y,
        5
    );


    group.userData.index =
        index;


    pointGroup.add(
        group
    );


    return group;
}


// ============================================================
// GLOWING LINE
// ============================================================

function createGlowLine(
    start,
    end
) {

    const group =
        new THREE.Group();


    // --------------------------------------------------------
    // OUTER GLOW
    // --------------------------------------------------------

    const glowGeometry =
        new THREE.BufferGeometry();


    glowGeometry.setAttribute(
        "position",

        new THREE.Float32BufferAttribute(
            [
                start.x,
                start.y,
                1,

                end.x,
                end.y,
                1
            ],
            3
        )
    );


    const glowMaterial =
        new THREE.LineBasicMaterial({

            color: GLOW_COLOR,

            transparent: true,

            opacity: 0.20,

            linewidth: 1
        });


    const glowLine =
        new THREE.Line(
            glowGeometry,
            glowMaterial
        );


    group.add(
        glowLine
    );


    // --------------------------------------------------------
    // MAIN LINE
    // --------------------------------------------------------

    const mainGeometry =
        new THREE.BufferGeometry();


    mainGeometry.setAttribute(
        "position",

        new THREE.Float32BufferAttribute(
            [
                start.x,
                start.y,
                2,

                end.x,
                end.y,
                2
            ],
            3
        )
    );


    const mainMaterial =
        new THREE.LineBasicMaterial({

            color: GLOW_COLOR,

            transparent: true,

            opacity: 0.95
        });


    const mainLine =
        new THREE.Line(
            mainGeometry,
            mainMaterial
        );


    group.add(
        mainLine
    );


    lineGroup.add(
        group
    );


    return group;
}


// ============================================================
// CONVERT SCREEN → THREE
// ============================================================

function screenToThree(
    mouseX,
    mouseY
) {

    const rect =
        renderer.domElement.getBoundingClientRect();


    const x =
        mouseX -
        rect.left;


    const y =
        mouseY -
        rect.top;


    const nx =
        x /
        rect.width;


    const ny =
        y /
        rect.height;


    return new THREE.Vector3(

        -1 +
        nx * 2,

        1 -
        ny * 2,

        5

    );
}


// ============================================================
// CONVERT THREE → SCREEN
// ============================================================

function threeToScreen(
    position
) {

    const x =
        (
            position.x + 1
        ) / 2 *
        window.innerWidth;


    const y =
        (
            1 - position.y
        ) / 2 *
        window.innerHeight;


    return {
        x,
        y
    };
}


// ============================================================
// FIND CLOSEST POINT
// ============================================================

function findPointAtMouse(
    mouseX,
    mouseY
) {

    const mouse =
        screenToThree(
            mouseX,
            mouseY
        );


    let closest =
        -1;


    let closestDistance =
        Infinity;


    for (
        let i = 0;
        i < points.length;
        i++
    ) {

        const point =
            points[i];


        const dx =
            point.mesh.position.x -
            mouse.x;


        const dy =
            point.mesh.position.y -
            mouse.y;


        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );


        if (
            distance <
            closestDistance
        ) {

            closestDistance =
                distance;

            closest =
                i;

        }

    }


    // Click radius

    if (
        closest !== -1 &&
        closestDistance < 0.10
    ) {

        return closest;

    }


    return -1;
}


// ============================================================
// UPDATE LINES
// ============================================================

function updateLines() {

    // Remove old lines.

    while (
        lineGroup.children.length
    ) {

        const child =
            lineGroup.children.pop();

        child.traverse(
            object => {

                if (
                    object.geometry
                ) {

                    object.geometry.dispose();

                }

                if (
                    object.material
                ) {

                    object.material.dispose();

                }

            }
        );

    }


    if (
        points.length < 2
    ) {

        return;

    }


    // --------------------------------------------------------
    // P1 → P2
    // P2 → P3
    // P3 → P4
    // P4 → P1
    // --------------------------------------------------------

    for (
        let i = 0;
        i < points.length;
        i++
    ) {

        if (
            i === points.length - 1
            &&
            points.length < 4
        ) {

            break;

        }


        const next =
            (
                i + 1
            ) %
            points.length;


        const start =
            points[i].mesh.position;


        const end =
            points[next].mesh.position;


        createGlowLine(
            start,
            end
        );

    }

}


// ============================================================
// UPDATE STATUS
// ============================================================

function updateStatus() {

    if (!initialized) {

        statusElement.innerHTML =
            "READY<br>" +
            "Click INITIALIZE 4 POINTS";

        return;
    }


    statusElement.innerHTML =
        "CALIBRATION ACTIVE<br>" +
        "POINTS: " +
        points.length +
        "/4";


    if (
        points.length === 4
    ) {

        statusElement.innerHTML +=
            "<br>✅ 4 POINTS READY";

    }

}


// ============================================================
// INITIALIZE
// ============================================================

initializeButton.addEventListener(
    "click",
    () => {

        initialized = true;

        points = [];

        draggingPoint = -1;


        // Clear scene.

        while (
            pointGroup.children.length
        ) {

            pointGroup.remove(
                pointGroup.children[0]
            );

        }


        while (
            lineGroup.children.length
        ) {

            lineGroup.remove(
                lineGroup.children[0]
            );

        }


        updateStatus();


        console.log(
            "🟢 LeapVE 4-point calibration initialized"
        );

    }
);


// ============================================================
// RESET
// ============================================================

resetButton.addEventListener(
    "click",
    () => {

        initialized = false;

        points = [];

        draggingPoint = -1;


        while (
            pointGroup.children.length
        ) {

            pointGroup.remove(
                pointGroup.children[0]
            );

        }


        while (
            lineGroup.children.length
        ) {

            lineGroup.remove(
                lineGroup.children[0]
            );

        }


        updateStatus();


        console.log(
            "🔄 LeapVE points reset"
        );

    }
);


// ============================================================
// MOUSE DOWN
// ============================================================

renderer.domElement.addEventListener(
    "pointerdown",
    event => {

        if (!initialized) {

            return;

        }


        // ----------------------------------------------------
        // DRAG EXISTING POINT
        // ----------------------------------------------------

        const existing =
            findPointAtMouse(
                event.clientX,
                event.clientY
            );


        if (
            existing !== -1
        ) {

            draggingPoint =
                existing;


            renderer.domElement.setPointerCapture(
                event.pointerId
            );


            return;

        }


        // ----------------------------------------------------
        // CREATE NEW POINT
        // ----------------------------------------------------

        if (
            points.length >= MAX_POINTS
        ) {

            return;

        }


        const position =
            screenToThree(
                event.clientX,
                event.clientY
            );


        const mesh =
            createPointMesh(
                position.x,
                position.y,
                points.length
            );


        points.push({

            mesh: mesh,

            index: points.length

        });


        updateLines();

        updateStatus();


        console.log(
            `P${points.length} created`,
            position.x,
            position.y
        );

    }
);


// ============================================================
// POINTER MOVE
// ============================================================

renderer.domElement.addEventListener(
    "pointermove",
    event => {

        if (
            draggingPoint === -1
        ) {

            return;

        }


        const position =
            screenToThree(
                event.clientX,
                event.clientY
            );


        points[
            draggingPoint
        ].mesh.position.x =
            position.x;


        points[
            draggingPoint
        ].mesh.position.y =
            position.y;


        updateLines();

    }
);


// ============================================================
// POINTER UP
// ============================================================

renderer.domElement.addEventListener(
    "pointerup",
    event => {

        if (
            draggingPoint !== -1
        ) {

            draggingPoint =
                -1;


            renderer.domElement.releasePointerCapture(
                event.pointerId
            );

        }

    }
);


// ============================================================
// RESIZE
// ============================================================

window.addEventListener(
    "resize",
    () => {

        renderer.setSize(
            window.innerWidth,
            window.innerHeight
        );

    }
);


// ============================================================
// ANIMATION
// ============================================================

const clock =
    new THREE.Clock();


function animate() {

    requestAnimationFrame(
        animate
    );


    const time =
        clock.getElapsedTime();


    // --------------------------------------------------------
    // PULSING GLOW
    // --------------------------------------------------------

    for (
        const point of points
    ) {

        const glow =
            point.mesh.children[0];


        if (glow) {

            const pulse =
                1 +
                Math.sin(
                    time * 4
                ) *
                0.20;


            glow.scale.set(
                pulse,
                pulse,
                1
            );


            glow.material.opacity =
                0.15 +
                (
                    Math.sin(
                        time * 4
                    ) + 1
                ) *
                0.08;

        }

    }


    renderer.render(
        scene,
        camera
    );

}


animate();


// ============================================================
// INITIAL STATUS
// ============================================================

updateStatus();

console.log(
    "LeapVE Three.js calibration layer loaded."
);