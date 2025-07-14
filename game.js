import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.167.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.167.0/examples/jsm/postprocessing/UnrealBloomPass.js';

class GameEngine {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.world = new CANNON.World();
        this.gameObjects = { enemies: [], bullets: [], powerUps: [], players: {} };
        this.pools = { particles: [] };
        this.gameState = {
            score: 0,
            health: 100,
            level: 1,
            difficulty: 1,
            shielded: false,
            fireRate: 0.2,
            paused: false
        };
        this.audio = {};
        this.ui = {};
        this.pathfindingGrid = new PF.Grid(20, 20);
        this.controls = { forward: false, backward: false, left: false, right: false, jump: false, shoot: false };
        this.socket = io('https://laser-ops-server.onrender.com', { transports: ['websocket'], upgrade: false }); // Mode solo par défaut
        this.init();
    }

    init() {
        this.setupRenderer();
        this.setupWorld();
        this.setupCamera();
        this.setupLighting();
        this.setupUI();
        this.setupAudio();
        this.setupControls();
        this.setupPathfinding();
        this.setupPostProcessing();
        this.createGun();
        this.createObstacles();
        this.spawnEnemies(3);
        this.spawnPowerUps();
        this.animate();
    }

    setupRenderer() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);
        window.addEventListener('resize', () => {
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        });
    }

    setupWorld() {
        this.world.gravity.set(0, -9.82, 0);
        const groundMaterial = new CANNON.Material('ground');
        const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
        groundBody.addShape(new CANNON.Plane());
        this.world.addBody(groundBody);
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        ground.rotation.x = -Math.PI / 2;
        this.scene.add(ground);
    }

    setupCamera() {
        this.camera.position.set(0, 1.6, 0);
        this.controlsManager = new OrbitControls(this.camera, this.renderer.domElement);
        this.controlsManager.enable = false;
        const playerShape = new CANNON.Sphere(0.5);
        this.playerBody = new CANNON.Body({ mass: 1, shape: playerShape });
        this.playerBody.position.set(0, 1.6, 0);
        this.world.addBody(this.playerBody);
        this.createPlayerModel(this.playerBody);
    }

    createPlayerModel(playerBody) {
        const loader = new THREE.GLTFLoader();
        const player = new THREE.Group();
        loader.load(
            'https://threejs.org/examples/models/gltf/Soldier/Soldier.glb',
            (gltf) => {
                const model = gltf.scene;
                model.scale.set(0.5, 0.5, 0.5);
                model.position.y = 0.8;
                player.add(model);
            }
        );
        this.scene.add(player);
        this.gameObjects.players['self'] = { object: player, body: playerBody };
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(0, 10, 10);
        this.scene.add(directionalLight);
    }

    setupUI() {
        this.ui.menu = document.getElementById('menu');
        this.ui.gameUI = document.getElementById('game-ui');
        this.ui.healthElement = document.getElementById('health');
        this.ui.scoreElement = document.getElementById('score');
        this.ui.playersPanel = document.getElementById('players-panel');
        this.ui.levelUpElement = document.getElementById('level-up');
        document.getElementById('new-game').addEventListener('click', () => this.startGame());
        document.getElementById('resume-game').addEventListener('click', () => this.togglePause());
        document.getElementById('settings').addEventListener('click', () => this.showSettings());
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('share-score').addEventListener('click', () => this.shareScore());
        document.getElementById('quit').addEventListener('click', () => this.quitGame());
        this.leaderboard = JSON.parse(localStorage.getItem('leaderboard') || '[]');
        this.updateLeaderboard();
    }

    setupAudio() {
        this.audioListener = new THREE.AudioListener();
        this.camera.add(this.audioListener);
        this.audio.shoot = { sound: new Audio('https://www.soundjay.com/buttons/laser.wav'), volume: 0.5 };
        this.audio.explosion = { sound: new Audio('https://www.soundjay.com/explosions/explosion-01.wav'), volume: 0.5 };
        this.audio.powerUp = { sound: new Audio('https://www.soundjay.com/misc/power-up.wav'), volume: 0.5 };
        this.audio.hit = { sound: new Audio('https://www.soundjay.com/human/pain-01.wav'), volume: 0.5 };
    }

    setupControls() {
        if (this.isMobile()) {
            this.setupTouchControls();
        } else {
            document.addEventListener('keydown', (e) => this.handleKey(e, true));
            document.addEventListener('keyup', (e) => this.handleKey(e, false));
            document.addEventListener('mousedown', () => this.controls.shoot = true);
            document.addEventListener('mouseup', () => this.controls.shoot = false);
        }
    }

    isMobile() {
        return /Android|iPhone|iPad/i.test(navigator.userAgent);
    }

    setupTouchControls() {
        const joystick = document.getElementById('joystick');
        const fireButton = document.getElementById('fire-button');
        let joystickActive = false;
        let joystickStart = { x: 0, y: 0 };
        joystick.addEventListener('touchstart', (e) => {
            joystickActive = true;
            joystickStart.x = e.touches[0].clientX;
            joystickStart.y = e.touches[0].clientY;
        });
        joystick.addEventListener('touchmove', (e) => {
            if (joystickActive) {
                const deltaX = e.touches[0].clientX - joystickStart.x;
                const deltaY = e.touches[0].clientY - joystickStart.y;
                this.controls.forward = deltaY < -20;
                this.controls.backward = deltaY > 20;
                this.controls.left = deltaX < -20;
                this.controls.right = deltaX > 20;
            }
        });
        joystick.addEventListener('touchend', () => {
            joystickActive = false;
            this.controls.forward = this.controls.backward = this.controls.left = this.controls.right = false;
        });
        fireButton.addEventListener('touchstart', () => this.controls.shoot = true);
        fireButton.addEventListener('touchend', () => this.controls.shoot = false);
    }

    handleKey(event, state) {
        switch (event.key) {
            case 'w': this.controls.forward = state; break;
            case 's': this.controls.backward = state; break;
            case 'a': this.controls.left = state; break;
            case 'd': this.controls.right = state; break;
            case ' ': this.controls.jump = state; break;
            case 'Escape': this.togglePause(); break;
        }
    }

    setupPathfinding() {
        for (let x = 0; x < 20; x++) {
            for (let z = 0; z < 20; z++) {
                this.pathfindingGrid.setWalkableAt(x, z, true);
            }
        }
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        this.composer.addPass(bloomPass);
    }

    createGun() {
        const loader = new THREE.GLTFLoader();
        loader.load(
            'https://threejs.org/examples/models/gltf/Soldier/Soldier.glb',
            (gltf) => {
                this.gameObjects.gun = gltf.scene;
                this.gameObjects.gun.scale.set(0.3, 0.3, 0.3);
                this.gameObjects.gun.position.set(0.5, -0.3, -1);
                this.gameObjects.gun.rotation.y = Math.PI;
                this.camera.add(this.gameObjects.gun);
                this.gunAnimations = {
                    shoot: gsap.to(this.gameObjects.gun.position, { z: -0.8, duration: 0.1, yoyo: true, repeat: 1, paused: true })
                };
            }
        );
    }

    createObstacles() {
        const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
        const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
        const boxShape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
        for (let i = 0; i < 10; i++) {
            const box = new THREE.Mesh(boxGeometry, boxMaterial);
            const boxBody = new CANNON.Body({ mass: 0, shape: boxShape });
            boxBody.position.set(Math.random() * 80 - 40, 1, Math.random() * 80 - 40);
            box.position.copy(boxBody.position);
            this.scene.add(box);
            this.world.addBody(boxBody);
            const gridX = Math.floor((boxBody.position.x + 50) / 5);
            const gridZ = Math.floor((boxBody.position.z + 50) / 5);
            this.pathfindingGrid.setWalkableAt(gridX, gridZ, false);
        }
    }

    spawnEnemies(count) {
        const loader = new THREE.GLTFLoader();
        for (let i = 0; i < count; i++) {
            const enemy = new THREE.Group();
            loader.load(
                'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
                (gltf) => {
                    const model = gltf.scene;
                    model.scale.set(0.5, 0.5, 0.5);
                    model.position.y = 0.8;
                    enemy.add(model);
                }
            );
            const enemyShape = new CANNON.Sphere(0.5);
            const enemyBody = new CANNON.Body({ mass: 1, shape: enemyShape });
            enemyBody.position.set(Math.random() * 80 - 40, 0.8, Math.random() * 80 - 40);
            this.world.addBody(enemyBody);
            enemy.position.copy(enemyBody.position);
            enemy.userData = {
                body: enemyBody,
                health: 100 * this.gameState.difficulty,
                speed: 2 * this.gameState.difficulty,
                damage: 10 * this.gameState.difficulty,
                lastShot: 0,
                shotDelay: 2 / this.gameState.difficulty,
                path: [],
                target: new THREE.Vector3(),
                lastPathUpdate: 0
            };
            this.scene.add(enemy);
            this.gameObjects.enemies.push(enemy);
            this.socket.emit('enemy-spawn', { position: enemyBody.position, health: enemy.userData.health });
        }
    }

    spawnPowerUps() {
        const types = [
            { color: 0xffff00, type: 'health', effect: () => this.gameState.health = Math.min(100, this.gameState.health + 20) },
            { color: 0x00ff00, type: 'fireRate', effect: () => this.gameState.fireRate *= 0.5 },
            { color: 0x0000ff, type: 'shield', effect: () => this.gameState.shielded = true }
        ];
        types.forEach(type => {
            const geometry = new THREE.SphereGeometry(0.5, 16, 16);
            const material = new THREE.MeshStandardMaterial({ color: type.color, emissive: type.color, emissiveIntensity: 0.5 });
            const powerUp = new THREE.Mesh(geometry, material);
            const powerUpBody = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(0.5) });
            powerUpBody.position.set(Math.random() * 80 - 40, 0.5, Math.random() * 80 - 40);
            powerUp.position.copy(powerUpBody.position);
            this.world.addBody(powerUpBody);
            powerUp.userData = { body: powerUpBody, type: type.type, effect: type.effect };
            this.scene.add(powerUp);
            this.gameObjects.powerUps.push(powerUp);
        });
    }

    startGame() {
        this.ui.menu.style.display = 'none';
        this.ui.gameUI.style.display = 'block';
        this.gameState.paused = false;
        document.getElementById('resume-game').style.display = 'block';
    }

    togglePause() {
        this.gameState.paused = !this.gameState.paused;
        this.ui.menu.style.display = this.gameState.paused ? 'block' : 'none';
        this.ui.gameUI.style.display = this.gameState.paused ? 'none' : 'block';
    }

    showSettings() {
        document.getElementById('settings-panel').style.display = 'block';
        document.getElementById('sensitivity').value = this.controlsManager.mouseSensitivity || 1;
        document.getElementById('volume').value = this.audio.shoot.volume;
    }

    saveSettings() {
        this.controlsManager.mouseSensitivity = parseFloat(document.getElementById('sensitivity').value);
        const volume = parseFloat(document.getElementById('volume').value);
        this.audio.shoot.volume = volume;
        this.audio.explosion.volume = volume;
        this.audio.powerUp.volume = volume;
        this.audio.hit.volume = volume;
        document.getElementById('settings-panel').style.display = 'none';
    }

    shareScore() {
        const tweet = `J'ai atteint ${Math.floor(this.gameState.score)} points dans Laser Ops - Édition Elite ! #LaserOps`;
        window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}`);
    }

    quitGame() {
        this.gameState.paused = true;
        this.ui.menu.style.display = 'block';
        this.ui.gameUI.style.display = 'none';
        this.gameState.score = 0;
        this.gameState.health = 100;
        this.gameState.level = 1;
        this.updateScore();
        this.updateHealth();
    }

    updateScore() {
        this.ui.scoreElement.textContent = Math.floor(this.gameState.score);
        this.leaderboard.push({ score: Math.floor(this.gameState.score), date: new Date().toLocaleString() });
        this.leaderboard.sort((a, b) => b.score - a.score);
        this.leaderboard = this.leaderboard.slice(0, 5);
        localStorage.setItem('leaderboard', JSON.stringify(this.leaderboard));
        this.updateLeaderboard();
    }

    updateLeaderboard() {
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '';
        this.leaderboard.forEach(entry => {
            const li = document.createElement('li');
            li.textContent = `${entry.score} - ${entry.date}`;
            list.appendChild(li);
        });
    }

    updateHealth() {
        this.ui.healthElement.style.width = `${this.gameState.health}%`;
        if (this.gameState.health <= 30) {
            this.ui.healthElement.style.background = '#ff0000';
        } else {
            this.ui.healthElement.style.background = '#00f7ff';
        }
        if (this.gameState.health <= 0) {
            this.quitGame();
        }
    }

    createHitParticles(position) {
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(20 * 3);
        for (let i = 0; i < 20; i++) {
            positions[i * 3] = position.x + (Math.random() - 0.5) * 0.2;
            positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.2;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.2;
        }
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMaterial = new THREE.PointsMaterial({ color: 0xff0000, size: 0.1 });
        const particles = new THREE.Points(particleGeometry, particleMaterial);
        particles.userData = { lifetime: 0.5 };
        this.scene.add(particles);
        this.pools.particles.push(particles);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.gameState.paused) return;
        const delta = this.clock.getDelta();
        this.world.step(delta);
        this.updatePlayer(delta);
        this.updateEnemies(delta);
        this.updateBullets(delta);
        this.updatePowerUps(delta);
        this.updateParticles(delta);
        this.composer.render();
    }

    updatePlayer(delta) {
        const speed = 5;
        const velocity = new THREE.Vector3();
        if (this.controls.forward) velocity.z -= speed;
        if (this.controls.backward) velocity.z += speed;
        if (this.controls.left) velocity.x -= speed;
        if (this.controls.right) velocity.x += speed;
        if (this.controls.jump && this.playerBody.position.y <= 1.6) {
            this.playerBody.velocity.y = 5;
        }
        this.playerBody.velocity.x = velocity.x;
        this.playerBody.velocity.z = velocity.z;
        this.camera.position.copy(this.playerBody.position);
        this.camera.position.y += 1.6;
        if (this.controls.shoot && !this.lastShot) {
            this.shoot();
            this.lastShot = this.gameState.fireRate;
        }
        if (this.lastShot) {
            this.lastShot -= delta;
            if (this.lastShot < 0) this.lastShot = 0;
        }
        this.socket.emit('player-update', { position: this.playerBody.position });
    }

    shoot() {
        const bulletGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
        const bulletMaterial = new THREE.MeshStandardMaterial({ color: 0x00f7ff, emissive: 0x00f7ff, emissiveIntensity: 1 });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        bullet.position.copy(this.camera.position);
        bullet.quaternion.copy(this.camera.quaternion);
        bullet.position.add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
        const sound = new THREE.PositionalAudio(this.audioListener);
        sound.setMediaElementSource(this.audio.shoot.sound);
        sound.setRefDistance(10);
        sound.play();
        bullet.add(sound);
        this.scene.add(bullet);
        const bulletBody = new CANNON.Body({ mass: 0.1, shape: new CANNON.Cylinder(0.05, 0.05, 1, 8) });
        bulletBody.position.copy(bullet.position);
        bulletBody.quaternion.copy(bullet.quaternion);
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        bulletBody.velocity.set(direction.x * 50, direction.y * 50, direction.z * 50);
        this.world.addBody(bulletBody);
        bullet.userData = { body: bulletBody, damage: 10 * this.gameState.difficulty };
        this.gameObjects.bullets.push(bullet);
        this.gunAnimations.shoot.play();
        this.socket.emit('shoot', { position: bullet.position, quaternion: bullet.quaternion });
    }

    updateEnemies(delta) {
        this.gameObjects.enemies.forEach(enemy => {
            if (Date.now() - enemy.userData.lastPathUpdate > 2000 || enemy.userData.path.length === 0) {
                const start = enemy.position.clone();
                const end = this.camera.position.clone();
                end.y = 0;
                const gridX = Math.floor((start.x + 50) / 5);
                const gridZ = Math.floor((start.z + 50) / 5);
                const targetX = Math.floor((end.x + 50) / 5);
                const targetZ = Math.floor((end.z + 50) / 5);
                const finder = new PF.AStarFinder();
                const path = finder.findPath(gridX, gridZ, targetX, targetZ, this.pathfindingGrid.clone());
                enemy.userData.path = path.map(p => new THREE.Vector3(p[0] * 5 - 50, 0, p[1] * 5 - 50));
                enemy.userData.target.copy(enemy.userData.path[0] || end);
                enemy.userData.lastPathUpdate = Date.now();
            }
            let direction = new THREE.Vector3();
            if (enemy.userData.path.length > 0) {
                direction.subVectors(enemy.userData.target, enemy.position).normalize();
                if (enemy.position.distanceTo(enemy.userData.target) < 2) {
                    enemy.userData.path.shift();
                    enemy.userData.target.copy(enemy.userData.path[0] || this.camera.position);
                }
            }
            enemy.userData.body.velocity.set(direction.x * enemy.userData.speed, 0, direction.z * enemy.userData.speed);
            enemy.position.copy(enemy.userData.body.position);
            enemy.lookAt(this.camera.position);
            enemy.userData.lastShot += delta;
            if (enemy.userData.lastShot > enemy.userData.shotDelay && enemy.position.distanceTo(this.camera.position) < 20) {
                this.enemyShoot(enemy);
                enemy.userData.lastShot = 0;
            }
            if (enemy.position.distanceTo(this.camera.position) < 2 && !this.gameState.shielded) {
                this.gameState.health -= enemy.userData.damage * delta;
                this.updateHealth();
            }
        });
    }

    enemyShoot(enemy) {
        const bulletGeometry = new THREE.SphereGeometry(0.2, 8, 8);
        const bulletMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 1 });
        const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
        bullet.position.copy(enemy.position);
        bullet.position.y += 0.8;
        const sound = new THREE.PositionalAudio(this.audioListener);
        sound.setMediaElementSource(this.audio.shoot.sound);
        sound.setRefDistance(10);
        sound.play();
        bullet.add(sound);
        this.scene.add(bullet);
        const bulletBody = new CANNON.Body({ mass: 0.1, shape: new CANNON.Sphere(0.2) });
        bulletBody.position.copy(bullet.position);
        const direction = new THREE.Vector3().subVectors(this.camera.position, bullet.position).normalize();
        bulletBody.velocity.set(direction.x * 30, direction.y * 30, direction.z * 30);
        this.world.addBody(bulletBody);
        bullet.userData = { body: bulletBody, damage: enemy.userData.damage };
        this.gameObjects.bullets.push(bullet);
    }

    updateBullets(delta) {
        this.gameObjects.bullets.forEach((bullet, index) => {
            bullet.position.copy(bullet.userData.body.position);
            bullet.quaternion.copy(bullet.userData.body.quaternion);
            this.gameObjects.enemies.forEach(enemy => {
                if (bullet.position.distanceTo(enemy.position) < 1) {
                    enemy.userData.health -= bullet.userData.damage;
                    this.createHitParticles(bullet.position);
                    if (enemy.userData.health <= 0) {
                        this.destroyEnemy(enemy);
                    }
                    this.scene.remove(bullet);
                    this.world.removeBody(bullet.userData.body);
                    this.gameObjects.bullets.splice(index, 1);
                }
            });
            if (bullet.position.distanceTo(this.camera.position) < 1 && !this.gameState.shielded) {
                this.gameState.health -= bullet.userData.damage;
                this.updateHealth();
                this.scene.remove(bullet);
                this.world.removeBody(bullet.userData.body);
                this.gameObjects.bullets.splice(index, 1);
            }
            if (bullet.position.y < 0 || bullet.position.y > 100) {
                this.scene.remove(bullet);
                this.world.removeBody(bullet.userData.body);
                this.gameObjects.bullets.splice(index, 1);
            }
        });
    }

    destroyEnemy(enemy) {
        this.gameState.score += 100 * this.gameState.difficulty;
        this.updateScore();
        const sound = new THREE.PositionalAudio(this.audioListener);
        sound.setMediaElementSource(this.audio.explosion.sound);
        sound.setRefDistance(10);
        sound.play();
        enemy.add(sound);
        this.createHitParticles(enemy.position);
        this.scene.remove(enemy);
        this.world.removeBody(enemy.userData.body);
        this.gameObjects.enemies = this.gameObjects.enemies.filter(e => e !== enemy);
        this.spawnEnemies(1);
        if (this.gameState.score >= 1000 * this.gameState.level) {
            this.levelUp();
        }
    }

    levelUp() {
        this.gameState.level++;
        this.gameState.difficulty += 0.2;
        this.ui.levelUpElement.style.display = 'block';
        gsap.to(this.ui.levelUpElement, { opacity: 0, duration: 2, onComplete: () => this.ui.levelUpElement.style.display = 'none' });
        this.scene.background = new THREE.Color(`hsl(${this.gameState.level * 10}, 50%, 50%)`);
        this.spawnEnemies(1);
    }

    updatePowerUps(delta) {
        this.gameObjects.powerUps.forEach((powerUp, index) => {
            powerUp.position.copy(powerUp.userData.body.position);
            if (powerUp.position.distanceTo(this.camera.position) < 1) {
                powerUp.userData.effect();
                const sound = new THREE.PositionalAudio(this.audioListener);
                sound.setMediaElementSource(this.audio.powerUp.sound);
                sound.setRefDistance(10);
                sound.play();
                powerUp.add(sound);
                this.scene.remove(powerUp);
                this.world.removeBody(powerUp.userData.body);
                this.gameObjects.powerUps.splice(index, 1);
                setTimeout(() => this.spawnPowerUps(), 10000);
                if (powerUp.userData.type === 'fireRate') {
                    setTimeout(() => this.gameState.fireRate = 0.2, 10000);
                }
                if (powerUp.userData.type === 'shield') {
                    setTimeout(() => this.gameState.shielded = false, 5000);
                }
            }
        });
    }

    updateParticles(delta) {
        this.pools.particles.forEach((particle, index) => {
            particle.userData.lifetime -= delta;
            if (particle.userData.lifetime <= 0) {
                this.scene.remove(particle);
                this.pools.particles.splice(index, 1);
            }
        });
    }
}

const CONFIG = {
    LEVELS: {
        SCORE_REQUIREMENT: 1000
    }
};

const game = new GameEngine();
game.clock = new THREE.Clock();
