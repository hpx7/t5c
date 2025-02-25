import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BlackAndWhitePostProcess } from "@babylonjs/core/PostProcesses/blackAndWhitePostProcess";

export class PlayerCamera {
    public camera;
    private _scene: Scene;
    private _input;
    public _camRoot;
    private _postProcess: BlackAndWhitePostProcess; //

    constructor(scene: Scene, input) {
        this._scene = scene;
        this._input = input;
        this._build();
    }

    private _build() {
        // root camera parent that handles positioning of the camera to follow the player
        this._camRoot = new TransformNode("root");
        this._camRoot.position = new Vector3(0, 1.5, 0); //initialized at (0,0,0)

        // to face the player from behind (180 degrees)
        this._camRoot.rotation = new Vector3(0, (3 / 4) * Math.PI, 0);

        // rotations along the x-axis (up/down tilting)
        const yTilt = new TransformNode("ytilt");

        // adjustments to camera view to point down at our player
        yTilt.rotation = new Vector3(0.6, 0, 0);
        yTilt.parent = this._camRoot;

        // our actual camera that's pointing at our root's position
        this.camera = new UniversalCamera("cam", new Vector3(0, 0, -45), this._scene);
        this.camera.lockedTarget = this._camRoot.position;
        this.camera.fov = 0.35;
        this.camera.parent = yTilt;

        // set as active camera
        this._scene.activeCamera = this.camera;
    }

    // post processing effect black and white
    // used when current player dies and click ressurects
    public bw(activate: boolean) {
        if (activate === true && !this._postProcess) {
            this._postProcess = new BlackAndWhitePostProcess("bandw", 1.0, this.camera);
        }
        if (activate === false && this._postProcess) {
            this._postProcess.dispose();
            this._postProcess = null;
        }
    }

    public follow(playerPosition, rotationY): void {
        // camera must follow player
        let centerPlayer = playerPosition.y;
        this._camRoot.position = Vector3.Lerp(this._camRoot.position, new Vector3(playerPosition.x, centerPlayer, playerPosition.z), 0.4);

        // to implement when the direction of the player depends on the mouse position clicked on the terrain and not on the screen
        // this._camRoot.rotation = new Vector3(this._camRoot.rotation.x, rotationY, 0);

        // rotate camera around the Y position if right click is true
        if (this._input.right_click) {
            // ddaydd to implement
            const rotationX =
                Math.abs(this._camRoot.rotation.x + this._input.movementY) < 0.5 ? this._camRoot.rotation.x + this._input.movementY : this._camRoot.rotation.x;
            const rotationY = this._camRoot.rotation.y + this._input.movementX;
            this._camRoot.rotation = new Vector3(rotationX, rotationY, 0);
        }
    }

    public zoom(deltaY): void {
        // zoom in/out
        if (deltaY > 0 && this.camera.position.z > -50) this.camera.position.z -= 1;
        if (deltaY < 0 && this.camera.position.z < -20) this.camera.position.z += 1;
    }
}
