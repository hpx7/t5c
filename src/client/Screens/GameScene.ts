import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { Scene } from "@babylonjs/core/scene";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";

import State from "./Screens";
import { PlayerInput } from "../Controllers/PlayerInput";
import { Environment } from "../Controllers/Environment";
import { UserInterface } from "../Controllers/UserInterface";
import { Player } from "../../shared/Entities/Player";
import { Entity } from "../../shared/Entities/Entity";
import { Item } from "../../shared/Entities/Item";
import Config from "../../shared/Config";
import { Room } from "colyseus.js";
import { PlayerInputs } from "../../shared/types";
import { NavMesh } from "../../shared/yuka";
import { SceneController } from "../Controllers/Scene";
import { AuthController } from "../Controllers/AuthController";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";

export class GameScene {
    private _app;
    private _auth: AuthController;
    private _scene: Scene;
    private _input: PlayerInput;
    private _ui;
    private _shadow: CascadedShadowGenerator;
    private _environment: Environment;
    private _navMesh: NavMesh;

    private _roomId: string;
    private room: Room<any>;
    private chatRoom: Room<any>;
    private _currentPlayer: Player;
    private _loadedAssets: AssetContainer[] = [];

    // networked entities
    private entities: Entity[] = [];
    private players: Player[] = [];
    private items: Item[] = [];

    private _entities: (Player | Entity | Item)[] = [];

    constructor() {}

    async createScene(app): Promise<void> {
        // app
        this._app = app;

        // auth controller
        this._auth = AuthController.getInstance();

        // show loading screen
        this._app.engine.displayLoadingUI();

        // create scene
        let scene = new Scene(app.engine);

        // set scene
        this._scene = scene;

        // if no user logged in, force a auto login
        // to be remove later or
        if (!this._auth.currentUser) {
            await this._auth.forceLogin();
        }

        // check if user token is valid
        let user = await this._auth.loggedIn();
        if (!user) {
            // if token not valid, send back to login screen
            SceneController.goToScene(State.LOGIN);
        }

        //
        let location = this._auth.currentLocation;

        // black background
        if (location.skyColor) {
            scene.clearColor = new Color4(location.skyColor, location.skyColor, location.skyColor, 1);
        }

        if (location.sun) {
            // ambient light
            var ambientLight = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
            ambientLight.intensity = 1;
            ambientLight.groundColor = new Color3(0.13, 0.13, 0.13);
            ambientLight.specular = Color3.Black();
        }

        // fox
        scene.fogMode = Scene.FOGMODE_LINEAR;
        scene.fogStart = 60.0;
        scene.fogEnd = 120.0;
        scene.fogColor = new Color3(0.9, 0.9, 0.85);

        // shadow light
        var light = new DirectionalLight("DirectionalLight", new Vector3(-1, -2, -1), scene);
        light.position = new Vector3(100, 100, 100);
        light.radius = 0.27;
        light.intensity = location.sunIntensity;
        light.autoCalcShadowZBounds = true;

        // shadow generator
        this._shadow = new CascadedShadowGenerator(1024, light);
        this._shadow.autoCalcDepthBounds = true;
        this._shadow.filteringQuality = CascadedShadowGenerator.QUALITY_LOW;
        this._shadow.lambda = 0.94;
        this._shadow.bias = 0.018;
        this._shadow.autoCalcDepthBounds = true;
        this._shadow.shadowMaxZ = 1000;
        this._shadow.stabilizeCascades = false;
        this._shadow.depthClamp = true;

        // load assets and remove them all from scene
        this._environment = new Environment(this._scene, this._shadow, this._loadedAssets);
        this._navMesh = await this._environment.loadNavMesh();
        await this._environment.loadAssets();

        // load the rest
        this._app.engine.displayLoadingUI();
        await this._environment.prepareAssets();
        await this._initNetwork();
    }

    private async _initNetwork(): Promise<void> {
        try {
            let character = this._auth.currentCharacter;
            let currentLocationKey = character.location;
            let room = await this._app.client.findCurrentRoom(currentLocationKey);

            if (room) {
                // join game room
                this.room = await this._app.client.joinRoom(room.roomId, this._auth.currentUser.token, character.id);

                // join global chat room (match sessionId to gameRoom)
                this.chatRoom = await this._app.client.joinChatRoom({ sessionId: this.room.sessionId });

                // set global vars
                this._roomId = this.room.roomId;

                await this._initEvents();
            } else {
            }
        } catch (e) {
            alert("Failed to connect.");
            //SceneController.goToScene(State.CHARACTER_SELECTION);
        }
    }

    private async _initEvents() {
        // setup hud
        this._ui = new UserInterface(this._scene, this._app.engine, this.room, this.chatRoom, this._entities, this._currentPlayer, this._loadedAssets);

        // setup input Controller
        this._input = new PlayerInput(this._scene, this.room, this._ui);

        ////////////////////////////////////////////////////
        //  when a entity joins the room event
        this.room.state.players.onAdd((entity, sessionId) => {
            var isCurrentPlayer = sessionId === this.room.sessionId;

            //////////////////
            // if player type
            if (isCurrentPlayer) {
                // create player entity
                let _player = new Player(entity, this.room, this._scene, this._ui, this._shadow, this._navMesh, this._loadedAssets, this._input);

                // set currentPlayer
                this._currentPlayer = _player;

                // add player specific ui
                this._ui.setCurrentPlayer(_player);

                // add to entities
                this._entities[sessionId] = _player;

                // player is loaded, let's hide the loading gui
                this._app.engine.hideLoadingUI();

                //////////////////
                // else if entity or another player
            } else {
                this._entities[sessionId] = new Entity(entity, this.room, this._scene, this._ui, this._shadow, this._navMesh, this._loadedAssets);
            }
        });

        // add non player entities
        this.room.state.entities.onAdd((entity, sessionId) => {
            this._entities[sessionId] = new Entity(entity, this.room, this._scene, this._ui, this._shadow, this._navMesh, this._loadedAssets);
        });

        // add items entities
        this.room.state.items.onAdd((entity, sessionId) => {
            this._entities[sessionId] = new Item(entity, this.room, this._scene, this._ui, this._shadow, this._loadedAssets);
        });

        /////////////////////////////////////////////////////////////
        ////////////////////  REMOVING EVENTS  //////////////////
        /////////////////////////////////////////////////////////////

        // when a player leaves the room event
        this.room.state.players.onRemove((player, sessionId) => {
            if (this._entities[sessionId]) {
                this._entities[sessionId].remove();
                delete this._entities[sessionId];
            }
        });

        // remove items entities
        this.room.state.items.onRemove((item, sessionId) => {
            if (this._entities[sessionId]) {
                this._entities[sessionId].remove();
                delete this._entities[sessionId];
            }
        });

        // when a entity leaves the room event
        this.room.state.entities.onRemove((entity, sessionId) => {
            if (this._entities[sessionId]) {
                this._entities[sessionId].remove();
                delete this._entities[sessionId];
            }
        });

        ////////////////////////////////////////////////////

        ////////////////////////////////////////////////////
        // main game loop
        let timeThen = Date.now();
        let sequence = 0;
        let latestInput: PlayerInputs;
        this._scene.registerBeforeRender(() => {
            let delta = this._app.engine.getFps();

            // entities update
            for (let sessionId in this._entities) {
                const entity = this._entities[sessionId];
                entity.update(delta);
                entity.lod(this._currentPlayer);
            }

            /////////////////
            // server update rate
            // every 100ms loop
            let timeNow = Date.now();
            let timePassed = (timeNow - timeThen) / 1000;
            let updateRate = Config.updateRate / 1000; // game is networked update every 100ms
            if (timePassed >= updateRate) {
                // player uppdate at server rate
                for (let sessionId in this._entities) {
                    const entity = this._entities[sessionId];
                    if (entity && entity.type === "player") {
                        entity.updateServerRate(Config.updateRate);
                    }
                }

                // detect movement
                if (this._input.player_can_move && !this._currentPlayer.blocked) {
                    // increment seq
                    sequence++;

                    // prepare input to be sent
                    latestInput = {
                        seq: sequence,
                        h: this._input.horizontal,
                        v: this._input.vertical,
                    };

                    // sent current input to server for processing
                    this.room.send("playerInput", latestInput);

                    // do client side prediction
                    this._currentPlayer.moveController.predictionMove(latestInput);
                }

                timeThen = timeNow;
            }
        });
    }

    // triggered on resize event
    public resize() {
        if (this._ui) {
            this._ui.resize();
        }
    }
}
