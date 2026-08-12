import * as THREE from "three";


// ============================================================
// LEAPVE
// THREE.JS 4-POINT VISUALIZER
// ============================================================


// ============================================================
// 1. SOCKET.IO
// ============================================================

const socket = io("http://localhost:5000");


// ============================================================
// 2. PIANO DATA
// ============================================================

let pianoPoints = null;

let pianoNormalized = null;

let pianoFrame = {
    width: 640,
    height: 480
};


// ============================================================
// 3. SOCKET CONNECTION
// ============================================================

socket.on("connect", () => {

    console.log(
        "✅ Three.js connected to OpenCV"
    );

});


socket.on("disconnect", () => {

    console.log(
        "❌ OpenCV disconnected"
    );

});


// ============================================================
// 4. RECEIVE 4 POINTS
// ============================================================

socket.on(
    "piano_points",
    (data) => {

        if (
            !data ||
            !data.points ||
            data.points.length !== 4
        ) {

            return;

        }


        pianoPoints = data.points;


        pianoNormalized =
            data.normalized;


        pianoFrame =
            data.frame;


        console.log(
            "📐 Piano points:",
            pianoPoints
        );

    }
);


// ============================================================
// 5. THREE.JS SCENE
// ============================================================

const scene =
    new THREE.Scene();


scene.background =
    new THREE.Color(
        0x111111
    );


// ============================================================
// 6. CAMERA
// ============================================================

const camera =
    new THREE.OrthographicCamera(
        -1,
        1,
        1,
        -1,
        0.1,
        10
    );


camera.position.z = 1;


// ============================================================
// 7. RENDERER
// ============================================================

const renderer =
    new THREE.WebGLRenderer({
        antialias: true
    });


renderer.setPixelRatio(
    window.devicePixelRatio
);


renderer.setSize(
    window.innerWidth,
    window.innerHeight
);


document.body.appendChild(
    renderer.domElement
);


// ============================================================
// 8. 2D POINTS
// ============================================================

const pointMaterial =
    new THREE.PointsMaterial({

        color: 0x00ffcc,

        size: 12,

        sizeAttenuation: false

    });


const pointGeometry =
    new THREE.BufferGeometry();


const pointMesh =
    new THREE.Points(
        pointGeometry,
        pointMaterial
    );


scene.add(
    pointMesh
);


// ============================================================
// 9. PIANO OUTLINE
// ============================================================

let outlineGeometry =
    new THREE.BufferGeometry();


let outlineMaterial =
    new THREE.LineBasicMaterial({

        color: 0x00ffff,

        linewidth: 3

    });


let pianoOutline =
    new THREE.Line(
        outlineGeometry,
        outlineMaterial
    );


scene.add(
    pianoOutline
);


// ============================================================
// 10. FOUR CORNER LABELS
// ============================================================

const labels = [];

for (let i = 0; i < 4; i++) {

    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width = 256;

    canvas.height = 128;


    const context =
        canvas.getContext("2d");


    context.font =
        "bold 48px Arial";


    context.fillStyle =
        "#00ffcc";


    context.fillText(
        `P${i + 1}`,
        20,
        60
    );


    const texture =
        new THREE.CanvasTexture(
            canvas
        );


    const material =
        new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });


    const sprite =
        new THREE.Sprite(
            material
        );


    sprite.scale.set(
        0.12,
        0.06,
        1
    );


    scene.add(
        sprite
    );


    labels.push(
        sprite
    );

}


// ============================================================
// 11. CONVERT NORMALIZED OPENCV
//     TO THREE.JS COORDINATES
//
// OpenCV:
//
// 0,0 ---------------- 1,0
// |                      |
// |        PIANO         |
// |                      |
// 0,1 ---------------- 1,1
//
// Three.js:
//
// -1,+1 -------------- +1,+1
// |                      |
// |        PIANO         |
// |                      |
// -1,-1 -------------- +1,-1
//
// ============================================================

function normalizedToThree(
    point
) {

    const nx =
        point[0];

    const ny =
        point[1];


    const x =
        -1 +
        nx * 2;


    const y =
        1 -
        ny * 2;


    return {
        x,
        y
    };

}


// ============================================================
// 12. UPDATE PIANO VISUAL
// ============================================================

function updatePianoVisual() {

    if (
        !pianoNormalized ||
        pianoNormalized.length !== 4
    ) {

        return;

    }


    const positions = [];


    // --------------------------------------------------------
    // FOUR CORNER POINTS
    // --------------------------------------------------------

    for (
        let i = 0;
        i < 4;
        i++
    ) {

        const point =
            normalizedToThree(
                pianoNormalized[i]
            );


        positions.push(
            point.x,
            point.y,
            0
        );


        // Label

        labels[i].position.set(
            point.x + 0.06,
            point.y + 0.06,
            0.1
        );

    }


    // --------------------------------------------------------
    // UPDATE POINT CLOUD
    // --------------------------------------------------------

    pointGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            positions,
            3
        )
    );


    pointGeometry.attributes.position.needsUpdate =
        true;


    // --------------------------------------------------------
    // OUTLINE
    //
    // P1 -> P2 -> P3 -> P4 -> P1
    // --------------------------------------------------------

    const outlinePositions = [

        positions[0],
        positions[1],
        positions[2],

        positions[3],
        positions[4],
        positions[5],

        positions[6],
        positions[7],
        positions[8],

        positions[9],
        positions[10],
        positions[11],

        positions[0],
        positions[1],
        positions[2]

    ];


    outlineGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            outlinePositions,
            3
        )
    );


    outlineGeometry.attributes.position.needsUpdate =
        true;

}


// ============================================================
// 13. GRID
// ============================================================

const gridMaterial =
    new THREE.LineBasicMaterial({

        color: 0x222222

    });


const gridPositions = [];


// Vertical lines

for (
    let i = 0;
    i <= 10;
    i++
) {

    const x =
        -1 +
        (i / 10) * 2;


    gridPositions.push(
        x,
        -1,
        -0.1,

        x,
        1,
        -0.1
    );

}


// Horizontal lines

for (
    let i = 0;
    i <= 10;
    i++
) {

    const y =
        -1 +
        (i / 10) * 2;


    gridPositions.push(
        -1,
        y,
        -0.1,

        1,
        y,
        -0.1
    );

}


const gridGeometry =
    new THREE.BufferGeometry();


gridGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
        gridPositions,
        3
    )
);


const grid =
    new THREE.LineSegments(
        gridGeometry,
        gridMaterial
    );


scene.add(
    grid
);


// ============================================================
// 14. RESIZE
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
// 15. ANIMATION
// ============================================================

function animate() {

    requestAnimationFrame(
        animate
    );


    updatePianoVisual();


    renderer.render(
        scene,
        camera
    );

}


animate();