window.__ModuleLoader__.load({
	id: "dsh-models-3d",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

		const NS = "dsh-models-3d";
		const API = "/api/models";
		const ASSETS = API + "/assets/";
		const VENDOR = ASSETS + "vendor/";

		/* ------------------------------------------------------------------ *
		 * copy
		 * ------------------------------------------------------------------ */

		const zh = {
			nav: "模型 3D",
			roomsNav: "安静的屋子",
			roomsTitle: "五间安静的屋子 · Quiet Rooms",
			title: "模型 3D · 展厅",
			subtitle: "四座地标，也可以导入你自己的模型",
			exhibits: "件展品",
			built: "程序化建模",
			indexTitle: "展品",
			stageLoading: "正在布置展厅…",
			modelLoading: "正在载入模型…",
			engineLoading: "正在唤醒 3D 引擎…",
			modelFailed: "模型载入失败",
			manifestFailed: "展厅资源没有就绪",
			manifestHint: "浏览器没能读到插件的模型清单，请稍后重试。",
			retry: "重试",
			autoRotate: "自动旋转",
			autoRotateOn: "暂停旋转",
			reset: "复位视角",
			fullscreen: "全屏",
			exitFullscreen: "退出全屏",
			hint: "拖拽旋转 · 滚轮缩放 · 双击复位",
			year: "落成",
			scale: "尺度",
			file: "模型",
			empty: "没有可展示的模型",
			importBtn: "导入模型",
			importTitle: "导入一个模型",
			importUploadTab: "本机文件",
			importBlendTab: "Blender 工程",
			importUploadHint: "选择一个 .glb 文件，上传后立即加入展架。",
			importBlendHint: "填入本机 .blend 的完整路径，Blender 会把它转成 GLB 再入库。",
			importPath: "例如 D:\models\chair.blend",
			importChoose: "选择 GLB 文件",
			importConvert: "转换并导入",
			importBusy: "正在处理…",
			importDone: "已导入",
			importFail: "导入失败",
			importClose: "关闭",
			importCancel: "取消",
			blenderFound: "已找到 Blender",
			blenderMissing: "没有找到 Blender",
			blenderMissingHint: "可以设置环境变量 DSH_BLENDER 指向 blender.exe，或先把 .blend 导出成 GLB。",
			importedTag: "本机导入",
			deleteModel: "删除这个模型",
			deleteConfirm: "确定删除这个导入的模型吗？",
		};

		const en = {
			nav: "Models 3D",
			roomsNav: "Quiet Rooms",
			roomsTitle: "Five Quiet Rooms",
			title: "Models 3D · Gallery",
			subtitle: "Four landmarks — or import a model of your own",
			exhibits: "exhibits",
			built: "procedural build",
			indexTitle: "Exhibits",
			stageLoading: "Preparing the gallery…",
			modelLoading: "Loading model…",
			engineLoading: "Waking up the 3D engine…",
			modelFailed: "Model failed to load",
			manifestFailed: "Gallery assets are not ready",
			manifestHint: "The browser could not read the plugin's model manifest. Try again in a moment.",
			retry: "Retry",
			autoRotate: "Auto-rotate",
			autoRotateOn: "Pause rotation",
			reset: "Reset view",
			fullscreen: "Fullscreen",
			exitFullscreen: "Exit fullscreen",
			hint: "Drag to orbit · scroll to zoom · double-click to reset",
			year: "Completed",
			scale: "Scale",
			file: "Model",
			empty: "No model to show",
		};

		/* ------------------------------------------------------------------ *
		 * three.js bootstrapping (classic UMD scripts, cached process-wide)
		 * ------------------------------------------------------------------ */

		let threePromise = null;

		function loadScript(src) {
			return new Promise((resolve, reject) => {
				const el = document.createElement("script");
				el.src = src;
				el.async = false;
				el.onload = () => resolve();
				el.onerror = () => reject(new Error("failed to load " + src));
				document.head.appendChild(el);
			});
		}

		function ensureThree() {
			if (window.THREE && window.THREE.GLTFLoader && window.THREE.OrbitControls && window.THREE.RoomEnvironment) {
				return Promise.resolve(window.THREE);
			}
			if (!threePromise) {
				threePromise = loadScript(VENDOR + "three.min.js")
					.then(() => loadScript(VENDOR + "GLTFLoader.js"))
					.then(() => loadScript(VENDOR + "OrbitControls.js"))
					.then(() => loadScript(VENDOR + "RoomEnvironment.js"))
					.then(() => {
						if (!window.THREE || !window.THREE.GLTFLoader) throw new Error("three.js runtime incomplete");
						return window.THREE;
					})
					.catch((error) => {
						threePromise = null;
						throw error;
					});
			}
			return threePromise;
		}

		/* ------------------------------------------------------------------ *
		 * viewer — one WebGL stage, several cached scenes
		 * ------------------------------------------------------------------ */

		const NORMALIZED_SIZE = 4.2;
		const CAMERA_DISTANCE = 8.8;

		function createViewer(host, THREE) {
			const renderer = new THREE.WebGLRenderer({
				antialias: true,
				alpha: true,
				powerPreference: "high-performance",
			});
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setClearColor(0x000000, 0);
			renderer.outputEncoding = THREE.sRGBEncoding;
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.12;
			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE.PCFSoftShadowMap;
			renderer.domElement.setAttribute("aria-label", "3D landmark model");
			renderer.domElement.style.display = "block";
			renderer.domElement.style.width = "100%";
			renderer.domElement.style.height = "100%";
			renderer.domElement.style.touchAction = "none";
			host.appendChild(renderer.domElement);

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

			const controls = new THREE.OrbitControls(camera, renderer.domElement);
			controls.enableDamping = true;
			controls.dampingFactor = 0.075;
			controls.enablePan = false;
			controls.minDistance = 2.8;
			controls.maxDistance = 18;
			controls.minPolarAngle = 0.22;
			controls.maxPolarAngle = Math.PI * 0.492;
			controls.target.set(0, 1.5, 0);

			// Camera direction is fixed; the distance is re-fitted per model so that
			// a tall tower and a wide wall both sit in the frame with the same margin.
			const frameDir = new THREE.Vector3(0.64, 0.33, 0.69).normalize();
			const focus = new THREE.Vector3(0, 1.5, 0);
			const home = new THREE.Vector3().copy(frameDir).multiplyScalar(CAMERA_DISTANCE).add(focus);

			function fitCamera(root) {
				root.updateMatrixWorld(true);
				const box = new THREE.Box3().setFromObject(root);
				const size = box.getSize(new THREE.Vector3());
				const sphere = box.getBoundingSphere(new THREE.Sphere());
				const aim = new THREE.Vector3(0, Math.max(0.35, size.y * 0.5), 0);
				const vFov = (camera.fov * Math.PI) / 180;
				const aspect = Math.max(0.45, camera.aspect || 1.6);
				const distV = sphere.radius / Math.sin(vFov / 2);
				const distH = sphere.radius / Math.sin(Math.atan(Math.tan(vFov / 2) * aspect));
				const dist = Math.max(distV, distH) * 1.06 + 0.25;
				focus.copy(aim);
				home.copy(frameDir).multiplyScalar(dist).add(aim);
				controls.target.copy(aim);
				camera.position.copy(home);
				controls.minDistance = Math.max(1.8, sphere.radius * 1.05);
				controls.maxDistance = Math.max(controls.minDistance * 2.4, dist * 2.4);
				controls.update();
			}

			const pivot = new THREE.Group();
			scene.add(pivot);

			// environment: bright neutral room, kept subtle so the gallery mood survives
			const pmrem = new THREE.PMREMGenerator(renderer);
			pmrem.compileEquirectangularShader();
			const envScene = new THREE.RoomEnvironment();
			const envTexture = pmrem.fromScene(envScene, 0.04).texture;
			scene.environment = envTexture;
			envScene.dispose?.();

			const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x33291f, 0.55);
			scene.add(hemi);

			const key = new THREE.DirectionalLight(0xfff1dc, 2.7);
			key.position.set(6.5, 9.5, 5.5);
			key.castShadow = true;
			key.shadow.mapSize.set(2048, 2048);
			key.shadow.camera.left = -6;
			key.shadow.camera.right = 6;
			key.shadow.camera.top = 7;
			key.shadow.camera.bottom = -6;
			key.shadow.camera.near = 0.5;
			key.shadow.camera.far = 30;
			key.shadow.bias = -0.0004;
			key.shadow.normalBias = 0.02;
			scene.add(key);

			const rim = new THREE.DirectionalLight(0x9db9ff, 1.15);
			rim.position.set(-7, 4.5, -6.5);
			scene.add(rim);

			const shadowPlane = new THREE.Mesh(
				new THREE.CircleGeometry(7, 64),
				new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.26 })
			);
			shadowPlane.rotation.x = -Math.PI / 2;
			shadowPlane.position.y = -0.004;
			shadowPlane.receiveShadow = true;
			scene.add(shadowPlane);

			const loader = new THREE.GLTFLoader();
			const cache = new Map();

			let current = null;
			let currentUrl = null;
			let autoRotate = true;
			let enterStart = 0;
			let raf = 0;
			let disposed = false;
			let last = performance.now();
			let pendingToken = 0;

			function applyMaterial(material) {
				if (!material) return;
				const list = Array.isArray(material) ? material : [material];
				for (const item of list) {
					if (item.isMeshStandardMaterial) {
						item.envMapIntensity = 0.8;
					}
					item.shadowSide = THREE.FrontSide;
				}
			}

			function normalize(root) {
				root.updateMatrixWorld(true);
				const box = new THREE.Box3().setFromObject(root);
				const size = box.getSize(new THREE.Vector3());
				const maxDim = Math.max(size.x, size.y, size.z) || 1;
				const scale = NORMALIZED_SIZE / maxDim;
				root.scale.setScalar(scale);
				root.updateMatrixWorld(true);
				box.setFromObject(root);
				const center = box.getCenter(new THREE.Vector3());
				root.position.x -= center.x;
				root.position.z -= center.z;
				root.position.y -= box.min.y;
				root.updateMatrixWorld(true);
				return box;
			}

			function clearCurrent() {
				if (!current) return;
				pivot.remove(current);
				current = null;
			}

			function show(url, cb = {}) {
				if (disposed) return;
				const token = ++pendingToken;
				const cached = cache.get(url);
				if (cached) {
					clearCurrent();
					current = cached;
					pivot.add(cached);
					pivot.rotation.y = 0;
					pivot.scale.setScalar(1);
					fitCamera(pivot);
					enterStart = performance.now();
					currentUrl = url;
					cb.onProgress?.(1);
					cb.onReady?.();
					return;
				}
				currentUrl = url;
				loader.load(
					url,
					(gltf) => {
						if (disposed || token !== pendingToken) {
							disposeObject(gltf.scene);
							return;
						}
						const root = gltf.scene;
						root.traverse((obj) => {
							if (obj.isMesh) {
								obj.castShadow = true;
								obj.receiveShadow = true;
								applyMaterial(obj.material);
							}
						});
						normalize(root);
						cache.set(url, root);
						clearCurrent();
						current = root;
						pivot.add(root);
						pivot.rotation.y = 0;
						pivot.scale.setScalar(1);
						fitCamera(pivot);
						enterStart = performance.now();
						cb.onProgress?.(1);
						cb.onReady?.();
					},
					(event) => {
						if (event && event.total) cb.onProgress?.(Math.min(1, event.loaded / event.total));
						else if (event && event.loaded) cb.onProgress?.(Math.min(0.9, event.loaded / 3000000));
					},
					(error) => {
						if (token !== pendingToken) return;
						cb.onError?.(error instanceof Error ? error : new Error(String(error)));
					}
				);
			}

			function setAutoRotate(value) {
				autoRotate = !!value;
			}

			function reset() {
				camera.position.copy(home);
				controls.target.copy(focus);
				pivot.rotation.y = 0;
				controls.update();
			}

			function resize() {
				const rect = host.getBoundingClientRect();
				const width = Math.max(1, Math.floor(rect.width));
				const height = Math.max(1, Math.floor(rect.height));
				renderer.setSize(width, height, false);
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
			}

			function tick(now) {
				raf = requestAnimationFrame(tick);
				const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
				last = now;
				if (autoRotate && current) pivot.rotation.y += dt * 0.24;
				if (enterStart) {
					const k = Math.min(1, (now - enterStart) / 620);
					const eased = 1 - Math.pow(1 - k, 3);
					pivot.scale.setScalar(0.94 + 0.06 * eased);
					if (k >= 1) enterStart = 0;
				}
				controls.update();
				renderer.render(scene, camera);
			}

			function disposeObject(root) {
				root.traverse?.((obj) => {
					if (!obj.isMesh) return;
					obj.geometry?.dispose?.();
					const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
					for (const material of materials) {
						if (!material) continue;
						for (const value of Object.values(material)) {
							if (value && value.isTexture) value.dispose();
						}
						material.dispose?.();
					}
				});
			}

			const resizeObserver = new ResizeObserver(() => resize());
			resizeObserver.observe(host);
			resize();

			camera.position.copy(home);
			controls.update();
			document.addEventListener("visibilitychange", onVisibility);
			function onVisibility() {
				last = performance.now();
			}
			renderer.domElement.addEventListener("dblclick", reset);
			raf = requestAnimationFrame(tick);

			function dispose() {
				disposed = true;
				cancelAnimationFrame(raf);
				document.removeEventListener("visibilitychange", onVisibility);
				renderer.domElement.removeEventListener("dblclick", reset);
				resizeObserver.disconnect();
				clearCurrent();
				for (const root of cache.values()) disposeObject(root);
				cache.clear();
				controls.dispose();
				envTexture.dispose();
				pmrem.dispose();
				shadowPlane.geometry.dispose();
				shadowPlane.material.dispose();
				renderer.dispose();
				renderer.domElement.remove();
			}

			return {
				show,
				setAutoRotate,
				reset,
				resize,
				dispose,
				get currentUrl() {
					return currentUrl;
				},
			};
		}

		/* ------------------------------------------------------------------ *
		 * icons
		 * ------------------------------------------------------------------ */

		function TowerGlyph(props) {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: props.size ?? 16,
					height: props.size ?? 16,
					fill: "currentColor",
					"aria-hidden": "true",
					focusable: "false",
				},
				h("path", {
					d: "M11.1 2.1h1.8v2.2h-1.8zM10.9 4.9h2.2l.35 1.1h-2.9zM11.15 6.7h1.7l.5 3.3h-2.7zM10.55 10.7h2.9l.65 3.2h-4.2zM9.75 14.6h4.5l.75 3.3h-6zM8.85 18.6h6.3l.8 3.2H8.05z",
				})
			);
		}

		function GlobeGlyph(props) {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: props.size ?? 20,
					height: props.size ?? 20,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.4,
					"aria-hidden": "true",
					focusable: "false",
				},
				h("circle", { cx: 12, cy: 12, r: 8.4 }),
				h("ellipse", { cx: 12, cy: 12, rx: 3.6, ry: 8.4 }),
				h("path", { d: "M3.8 9.2h16.4M3.8 14.8h16.4" })
			);
		}

		function OrbitIcon(props) {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: props.size ?? 16,
					height: props.size ?? 16,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					"aria-hidden": "true",
					focusable: "false",
				},
				h("path", { d: "M20 12a8 8 0 1 1-2.35-5.65" }),
				h("path", { d: "M20 4v4.4h-4.4" })
			);
		}

		function ResetIcon(props) {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: props.size ?? 16,
					height: props.size ?? 16,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					focusable: "false",
				},
				h("path", { d: "M4 12a8 8 0 1 0 2.35-5.65" }),
				h("path", { d: "M4 4v4.4h4.4" }),
				h("circle", { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" })
			);
		}

		function ExpandIcon(props) {
			return h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: props.size ?? 16,
					height: props.size ?? 16,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					focusable: "false",
				},
				h("path", { d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" })
			);
		}

		/* ------------------------------------------------------------------ *
		 * styles (theme tokens for chrome; the stage is artwork and adapts by scheme)
		 * ------------------------------------------------------------------ */

		const CSS = `
.lmk-root {
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	background: var(--dsw-alias-bg-base);
	color: var(--dsw-alias-label-primary);
	overflow: hidden;
}
.lmk-head {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 18px;
	padding: 20px 24px 14px;
	flex-wrap: wrap;
}
.lmk-head-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.lmk-mark {
	width: 34px; height: 34px; flex: none;
	display: grid; place-items: center;
	border-radius: 10px;
	color: #fff7e6;
	background: linear-gradient(145deg, #d9b46b 0%, #a97a2e 100%);
	box-shadow: 0 6px 16px -8px rgba(169, 122, 46, 0.9), inset 0 1px 0 rgba(255,255,255,.35);
}
.lmk-title { font-size: 18px; font-weight: 650; letter-spacing: .01em; line-height: 1.25; }
.lmk-sub { margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.lmk-head-meta { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.lmk-count {
	font-variant-numeric: tabular-nums;
	padding: 3px 9px; border-radius: 999px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1);
}
.lmk-tag {
	padding: 3px 9px; border-radius: 999px;
	border: 1px dashed var(--dsw-alias-border-l2);
	color: var(--dsw-alias-label-secondary);
}

.lmk-body {
	display: grid;
	grid-template-columns: 286px minmax(0, 1fr);
	gap: 16px;
	padding: 0 24px 22px;
	flex: 1;
	min-height: 0;
}

.lmk-rail {
	display: flex; flex-direction: column; gap: 8px;
	min-height: 0; overflow: auto; padding: 2px;
	scrollbar-width: thin;
}
.lmk-rail-label {
	display: flex; align-items: center; gap: 8px;
	font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
	color: var(--dsw-alias-label-secondary);
	padding: 2px 6px 4px;
}
.lmk-rail-label::after {
	content: ""; flex: 1; height: 1px; background: var(--dsw-alias-border-l1);
}
.lmk-card {
	position: relative;
	display: grid;
	grid-template-columns: 54px minmax(0, 1fr);
	grid-template-rows: auto auto;
	column-gap: 12px;
	align-items: center;
	width: 100%;
	padding: 8px 12px 8px 8px;
	border-radius: 14px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-1);
	color: inherit;
	text-align: left;
	cursor: pointer;
	transition: background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease;
}
.lmk-card:hover {
	background: var(--dsw-alias-bg-layer-2);
	border-color: var(--dsw-alias-border-l2);
	transform: translateY(-1px);
}
.lmk-card:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary);
	outline-offset: 2px;
}
.lmk-card.is-active {
	border-color: color-mix(in srgb, var(--lmk-accent) 62%, var(--dsw-alias-border-l2));
	background:
		linear-gradient(90deg, color-mix(in srgb, var(--lmk-accent) 12%, transparent), transparent 62%),
		var(--dsw-alias-bg-layer-1);
	box-shadow: 0 10px 26px -18px color-mix(in srgb, var(--lmk-accent) 80%, transparent);
}
.lmk-card-thumb {
	grid-row: 1 / span 2;
	position: relative;
	width: 54px; height: 54px;
	border-radius: 11px;
	overflow: hidden;
	display: grid; place-items: center;
	color: color-mix(in srgb, var(--lmk-accent) 78%, var(--dsw-alias-label-secondary));
	background:
		radial-gradient(85% 85% at 50% 18%, color-mix(in srgb, var(--lmk-accent) 20%, transparent), transparent 72%),
		var(--dsw-alias-bg-layer-2);
	border: 1px solid var(--dsw-alias-border-l1);
}
.lmk-card-thumb img {
	position: relative; z-index: 1;
	width: 100%; height: 100%;
	object-fit: contain;
	filter: drop-shadow(0 6px 8px rgba(0,0,0,.32));
}
.lmk-card-name { font-size: 13.5px; font-weight: 600; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lmk-card-place { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lmk-card-no {
	position: absolute; top: 8px; right: 10px;
	font-size: 10px; font-variant-numeric: tabular-nums;
	color: var(--dsw-alias-label-secondary); opacity: .8;
}
.lmk-card.is-active .lmk-card-no { color: var(--lmk-accent); opacity: 1; }
.lmk-rail-foot { margin-top: auto; padding: 10px 6px 2px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }

.lmk-stage {
	position: relative;
	min-height: 0;
	border-radius: 18px;
	overflow: hidden;
	border: 1px solid var(--dsw-alias-border-l1);
	isolation: isolate;
}
.lmk-root[data-scheme="dark"] .lmk-stage {
	background:
		radial-gradient(85% 62% at 50% 16%, #24324a 0%, #151d2b 48%, #0a0e16 100%);
}
.lmk-root[data-scheme="light"] .lmk-stage {
	background:
		radial-gradient(85% 62% at 50% 16%, #ffffff 0%, #f3ede2 50%, #e4dccd 100%);
}
.lmk-glow {
	position: absolute; inset: 0; z-index: 0; pointer-events: none;
	background: radial-gradient(38% 30% at 50% 66%, var(--lmk-accent), transparent 72%);
	opacity: .16;
}
.lmk-root[data-scheme="light"] .lmk-glow { opacity: .13; mix-blend-mode: multiply; }
.lmk-canvas { position: absolute; inset: 0; z-index: 1; }
.lmk-canvas canvas { display: block; width: 100%; height: 100%; }

.lmk-stage-top {
	position: absolute; inset: 14px 16px auto;
	z-index: 3;
	display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
	pointer-events: none;
}
.lmk-stage-top > * { pointer-events: auto; }
.lmk-place {
	display: flex; flex-direction: column; gap: 3px;
	padding: 7px 11px 7px 12px;
	border-radius: 10px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 72%, transparent);
	backdrop-filter: blur(10px);
	font-size: 11px; color: var(--dsw-alias-label-secondary);
	letter-spacing: .04em;
}
.lmk-place b { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); letter-spacing: 0; }
.lmk-tools { display: flex; gap: 6px; }
.lmk-tool {
	width: 34px; height: 34px;
	display: grid; place-items: center;
	border-radius: 10px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 76%, transparent);
	color: var(--dsw-alias-label-primary);
	backdrop-filter: blur(10px);
	cursor: pointer;
	transition: background .16s ease, border-color .16s ease, color .16s ease;
}
.lmk-tool:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.lmk-tool[aria-pressed="true"] {
	color: var(--lmk-accent);
	border-color: color-mix(in srgb, var(--lmk-accent) 55%, var(--dsw-alias-border-l2));
	background: color-mix(in srgb, var(--lmk-accent) 12%, var(--dsw-alias-bg-layer-1));
}
.lmk-tool:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.lmk-info {
	position: absolute; left: 16px; bottom: 16px; z-index: 3;
	width: min(430px, calc(100% - 130px));
	padding: 13px 16px 14px;
	border-radius: 14px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 76%, transparent);
	backdrop-filter: blur(16px) saturate(1.1);
	box-shadow: 0 18px 40px -28px rgba(0,0,0,.7);
	animation: lmk-rise .32s ease both;
}
@keyframes lmk-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.lmk-info-eyebrow {
	display: flex; align-items: center; gap: 7px;
	font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
	color: var(--lmk-accent);
	font-weight: 600;
}
.lmk-info-eyebrow::before {
	content: ""; width: 14px; height: 2px; border-radius: 1px; background: currentColor;
}
.lmk-info h2 { margin: 6px 0 1px; font-size: 19px; font-weight: 650; letter-spacing: .01em; line-height: 1.25; }
.lmk-info-en { font-size: 11.5px; color: var(--dsw-alias-label-secondary); letter-spacing: .02em; }
.lmk-info p { margin: 8px 0 0; font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
.lmk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.lmk-chip {
	display: inline-flex; align-items: baseline; gap: 5px;
	padding: 3px 8px; border-radius: 999px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: color-mix(in srgb, var(--dsw-alias-bg-base) 46%, transparent);
	font-size: 10.5px; color: var(--dsw-alias-label-secondary);
}
.lmk-chip b { font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }

.lmk-hint {
	position: absolute; right: 18px; bottom: 18px; z-index: 3;
	font-size: 10.5px; letter-spacing: .02em;
	color: var(--dsw-alias-label-secondary);
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 62%, transparent);
	border-radius: 999px;
	padding: 5px 10px;
	backdrop-filter: blur(8px);
	opacity: .85;
}

.lmk-overlay {
	position: absolute; inset: 0; z-index: 4;
	display: grid; place-items: center;
	background: color-mix(in srgb, var(--dsw-alias-bg-base) 28%, transparent);
	backdrop-filter: blur(2px);
	text-align: center;
	padding: 24px;
}
.lmk-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.lmk-spinner {
	width: 34px; height: 34px; border-radius: 50%;
	border: 2px solid color-mix(in srgb, var(--lmk-accent) 26%, transparent);
	border-top-color: var(--lmk-accent);
	animation: lmk-spin .9s linear infinite;
}
@keyframes lmk-spin { to { transform: rotate(360deg); } }
.lmk-loading-text { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.lmk-bar { width: 190px; height: 3px; border-radius: 2px; overflow: hidden; background: var(--dsw-alias-border-l1); }
.lmk-bar i { display: block; height: 100%; border-radius: inherit; background: var(--lmk-accent); transition: width .15s ease; }
.lmk-error { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 340px; }
.lmk-error-title { font-size: 13px; font-weight: 600; }
.lmk-error-text { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.lmk-retry {
	margin-top: 4px;
	padding: 6px 14px;
	border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	font-size: 12px;
	cursor: pointer;
}
.lmk-retry:hover { background: var(--dsw-alias-bg-layer-2); }

.lmk-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 2px; }
.lmk-skeleton-row {
	height: 70px; border-radius: 14px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: linear-gradient(100deg, var(--dsw-alias-bg-layer-1) 30%, var(--dsw-alias-bg-layer-2) 50%, var(--dsw-alias-bg-layer-1) 70%);
	background-size: 220% 100%;
	animation: lmk-shimmer 1.5s ease-in-out infinite;
}
@keyframes lmk-shimmer { from { background-position: 130% 0; } to { background-position: -30% 0; } }

@media (max-width: 860px) {
	.lmk-head { padding: 16px 16px 10px; }
	.lmk-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); padding: 0 16px 16px; gap: 10px; }
	.lmk-rail { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }
	.lmk-rail-label { display: none; }
	.lmk-card { min-width: 208px; width: 208px; }
	.lmk-rail-foot { display: none; }
	.lmk-info { width: calc(100% - 32px); left: 16px; bottom: 16px; padding: 11px 13px 12px; }
	.lmk-info p { display: none; }
	.lmk-hint { display: none; }
}

@media (prefers-reduced-motion: reduce) {
	.lmk-card, .lmk-tool, .lmk-bar i { transition: none; }
	.lmk-spinner { animation-duration: 2.2s; }
	.lmk-info { animation: none; }
	.lmk-skeleton-row { animation: none; }
}
.qr-root {
	position: relative;
	height: 100%;
	min-height: 0;
	background: #07080a;
	overflow: hidden;
}
.qr-fallback {
	display: flex;
	align-items: center;
	justify-content: center;
	color: rgba(255, 255, 255, 0.7);
	font-size: 13px;
}
.qr-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
}
.qr-spin {
	width: 24px;
	height: 24px;
	border-radius: 50%;
	border: 1px solid rgba(255, 255, 255, 0.2);
	border-top-color: rgba(255, 255, 255, 0.75);
	animation: qr-spin 0.9s linear infinite;
}
@keyframes qr-spin { to { transform: rotate(360deg); } }
.qr-frame {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
	background: #07080a;
}


.lmk-import-btn {
	display: inline-flex; align-items: center; gap: 5px;
	height: 28px; padding: 0 11px 0 8px;
	border-radius: 999px;
	border: 1px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	font: inherit; font-size: 11.5px; font-weight: 600;
	cursor: pointer;
	transition: background .18s ease, border-color .18s ease, transform .18s ease;
}
.lmk-import-btn:hover {
	background: var(--dsw-alias-bg-layer-2);
	border-color: var(--dsw-alias-brand-primary);
	transform: translateY(-1px);
}
.lmk-import-plus { font-size: 14px; line-height: 1; color: var(--lmk-accent); }

.lmk-backdrop {
	position: fixed; inset: 0; z-index: 60;
	display: grid; place-items: center;
	padding: 24px;
	background: color-mix(in srgb, #000 52%, transparent);
	backdrop-filter: blur(3px);
}
.lmk-modal {
	width: min(440px, 100%);
	border-radius: 18px;
	border: 1px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-layer-1);
	color: var(--dsw-alias-label-primary);
	box-shadow: 0 30px 70px -30px rgba(0,0,0,.7);
	padding: 18px 18px 16px;
}
.lmk-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.lmk-modal-title { font-size: 16px; font-weight: 650; letter-spacing: .01em; }
.lmk-modal-sub { margin-top: 4px; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.lmk-close {
	appearance: none; border: 0; background: transparent;
	width: 26px; height: 26px; border-radius: 8px;
	color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px;
}
.lmk-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.lmk-tabs { display: flex; gap: 6px; margin: 14px 0 12px; }
.lmk-tab {
	appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: transparent;
	height: 28px; padding: 0 12px; border-radius: 999px;
	color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; cursor: pointer;
}
.lmk-tab.is-on {
	border-color: color-mix(in srgb, var(--lmk-accent) 55%, var(--dsw-alias-border-l2));
	background: color-mix(in srgb, var(--lmk-accent) 14%, transparent);
	color: var(--dsw-alias-label-primary);
}
.lmk-modal-body { display: flex; flex-direction: column; gap: 10px; }
.lmk-drop {
	position: relative; display: grid; gap: 4px; place-items: center;
	padding: 20px 14px; border-radius: 14px;
	border: 1px dashed var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-layer-2);
	cursor: pointer; text-align: center;
}
.lmk-drop:hover { border-color: var(--dsw-alias-brand-primary); }
.lmk-drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.lmk-drop-icon { font-size: 18px; color: var(--lmk-accent); }
.lmk-drop-name { font-size: 12.5px; font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lmk-drop-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.lmk-primary {
	height: 34px; border-radius: 10px; border: 1px solid transparent;
	background: var(--dsw-alias-brand-primary); color: #fff;
	font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer;
	transition: opacity .18s ease, transform .18s ease;
}
.lmk-primary:hover:not(:disabled) { transform: translateY(-1px); }
.lmk-primary:disabled { opacity: .45; cursor: not-allowed; }
.lmk-blender {
	display: flex; align-items: center; gap: 8px;
	font-size: 11.5px; color: var(--dsw-alias-label-secondary);
	padding: 8px 10px; border-radius: 10px;
	border: 1px solid var(--dsw-alias-border-l1);
	background: var(--dsw-alias-bg-layer-2);
}
.lmk-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary, #c98a2a); }
.lmk-blender.is-ok .lmk-dot { background: var(--dsw-alias-state-success-primary, #3f9d63); }
.lmk-blender-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lmk-text {
	height: 34px; border-radius: 10px; padding: 0 11px;
	border: 1px solid var(--dsw-alias-border-l2);
	background: var(--dsw-alias-bg-base);
	color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px;
}
.lmk-text:focus { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); outline-offset: 1px; }
.lmk-modal-hint { font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.lmk-modal-error {
	font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-error-primary, #d3564d);
	word-break: break-word;
}
.lmk-delete {
	align-self: flex-start; margin-top: 10px;
	appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: transparent;
	height: 24px; padding: 0 9px; border-radius: 7px;
	font: inherit; font-size: 11px; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.lmk-delete:hover { border-color: var(--dsw-alias-state-error-primary, #d3564d); color: var(--dsw-alias-state-error-primary, #d3564d); }
.lmk-chip.is-imported { color: var(--lmk-accent); border-color: color-mix(in srgb, var(--lmk-accent) 45%, transparent); }

`;

		/* ------------------------------------------------------------------ *
		 * sidebar entry (icon only; the host renders the label)
		 * ------------------------------------------------------------------ */

		function SidebarIcon(owner = {}) {
			return h(
				"span",
				{
					className: "lmk-nav-icon",
					style: {
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: owner.size ?? 16,
						height: owner.size ?? 16,
						opacity: owner.active ? 1 : 0.92,
					},
				},
				h(TowerGlyph, { size: owner.size ?? 16 })
			);
		}


		function ImportDialog(props) {
			const { t, onClose, onImported } = props;
			const [tab, setTab] = useState("upload");
			const [file, setFile] = useState(null);
			const [pathValue, setPathValue] = useState("");
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);
			const [blender, setBlender] = useState(null);

			useEffect(() => {
				let alive = true;
				fetch(API + "/blender", { cache: "no-store" })
					.then((r) => r.json())
					.then((data) => { if (alive) setBlender(data || { found: false }); })
					.catch(() => { if (alive) setBlender({ found: false }); });
				return () => { alive = false; };
			}, []);

			useEffect(() => {
				const onKey = (event) => { if (event.key === "Escape" && !busy) onClose(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [busy, onClose]);

			async function upload() {
				if (!file || busy) return;
				setBusy(true);
				setError(null);
				try {
					const res = await fetch(API + "/import?name=" + encodeURIComponent(file.name), {
						method: "POST",
						headers: { "content-type": "application/octet-stream" },
						body: file,
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(data.detail || data.error || "HTTP " + res.status);
					onImported(data.model);
				} catch (err) {
					setError(err && err.message ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}

			async function convert() {
				const target = pathValue.trim();
				if (!target || busy) return;
				setBusy(true);
				setError(null);
				try {
					const res = await fetch(API + "/import-blend", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path: target }),
					});
					const data = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(data.detail || data.error || "HTTP " + res.status);
					onImported(data.model);
				} catch (err) {
					setError(err && err.message ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}

			return h(
				"div",
				{
					className: "lmk-backdrop",
					onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onClose(); },
				},
				h(
					"div",
					{ className: "lmk-modal", role: "dialog", "aria-modal": "true", "aria-label": t("importTitle") },
					h(
						"div",
						{ className: "lmk-modal-head" },
						h(
							"div",
							null,
							h("div", { className: "lmk-modal-title" }, t("importTitle")),
							h("div", { className: "lmk-modal-sub" }, tab === "upload" ? t("importUploadHint") : t("importBlendHint"))
						),
						h("button", { type: "button", className: "lmk-close", onClick: onClose, disabled: busy, "aria-label": t("importClose") }, "✕")
					),
					h(
						"div",
						{ className: "lmk-tabs" },
						h("button", { type: "button", className: "lmk-tab" + (tab === "upload" ? " is-on" : ""), onClick: () => { setTab("upload"); setError(null); } }, t("importUploadTab")),
						h("button", { type: "button", className: "lmk-tab" + (tab === "blend" ? " is-on" : ""), onClick: () => { setTab("blend"); setError(null); } }, t("importBlendTab"))
					),
					tab === "upload"
						? h(
								"div",
								{ className: "lmk-modal-body" },
								h("label", { className: "lmk-drop" },
									h("input", {
										type: "file",
										accept: ".glb,.gltf,model/gltf-binary,model/gltf+json",
										onChange: (event) => setFile((event.target.files && event.target.files[0]) || null),
									}),
									h("span", { className: "lmk-drop-icon" }, "＋"),
									h("span", { className: "lmk-drop-name" }, file ? file.name : t("importChoose")),
									h("span", { className: "lmk-drop-hint" }, t("importUploadHint"))
								),
								h("button", { type: "button", className: "lmk-primary", onClick: upload, disabled: busy || !file }, busy ? t("importBusy") : t("importChoose"))
							)
						: h(
								"div",
								{ className: "lmk-modal-body" },
								h(
									"div",
									{ className: "lmk-blender" + (blender && blender.found ? " is-ok" : "") },
									h("span", { className: "lmk-dot" }),
									h("span", { className: "lmk-blender-text" }, blender ? (blender.found ? t("blenderFound") + " · " + String(blender.path).split(/[\\/]/).pop() : t("blenderMissing")) : "…")
								),
								h("input", {
									type: "text",
									className: "lmk-text",
									value: pathValue,
									placeholder: t("importPath"),
									spellCheck: false,
									onChange: (event) => setPathValue(event.target.value),
								}),
								blender && !blender.found ? h("div", { className: "lmk-modal-hint" }, t("blenderMissingHint")) : null,
								h("button", { type: "button", className: "lmk-primary", onClick: convert, disabled: busy || !pathValue.trim() || (blender && !blender.found) }, busy ? t("importBusy") : t("importConvert"))
							),
					error ? h("div", { className: "lmk-modal-error" }, t("importFail") + " · " + error) : null
				)
			);
		}

		function useSnapshot(store) {
			return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
		}

		function pick(value, lang) {
			if (value == null) return "";
			if (typeof value === "string") return value;
			return value[lang] ?? value.zh ?? value.en ?? "";
		}

		function formatBytes(bytes) {
			if (!bytes) return "";
			if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
			return (bytes / (1024 * 1024)).toFixed(1) + " MB";
		}

		function LandmarksPanel(props) {
			const { t, themeStore, localeStore } = props;
			const theme = useSnapshot(themeStore);
			const locale = useSnapshot(localeStore);
			const scheme = theme?.active?.colorScheme === "light" ? "light" : "dark";
			const lang = String(locale?.active ?? "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
			const reduced = useMemo(
				() => typeof window !== "undefined" && window.matchMedia
					? window.matchMedia("(prefers-reduced-motion: reduce)").matches
					: false,
				[]
			);

			const [state, setState] = useState({ phase: "boot", data: null, error: null });
			const [attempt, setAttempt] = useState(0);
			const [activeIndex, setActiveIndex] = useState(0);
			const [autoRotate, setAutoRotate] = useState(!reduced);
			const [importOpen, setImportOpen] = useState(false);
			const [pendingId, setPendingId] = useState(null);

			useEffect(() => {
				let alive = true;
				setState((prev) => ({ ...prev, phase: "boot", error: null }));
				fetch(API + "/manifest", { cache: "no-store", headers: { accept: "application/json" } })
					.then((response) => {
						if (!response.ok) throw new Error("HTTP " + response.status);
						return response.json();
					})
					.then((data) => {
						if (!alive) return;
						if (!data || !Array.isArray(data.models) || data.models.length === 0) {
							throw new Error("manifest has no models");
						}
						setState({ phase: "ready", data, error: null });
						setActiveIndex((index) => Math.min(index, data.models.length - 1));
					})
					.catch((error) => {
						if (!alive) return;
						setState({ phase: "error", data: null, error: error instanceof Error ? error : new Error(String(error)) });
					});
				return () => {
					alive = false;
				};
			}, [attempt]);

			useEffect(() => {
				if (!pendingId || state.phase !== "ready") return;
				const index = (state.data?.models ?? []).findIndex((item) => item.id === pendingId && item.imported);
				if (index >= 0) setActiveIndex(index);
				setPendingId(null);
			}, [pendingId, state]);

			async function removeModel(model) {
				if (!model || !model.imported) return;
				if (!window.confirm(t("deleteConfirm"))) return;
				try {
					await fetch(API + "/import?id=" + encodeURIComponent(model.id), { method: "DELETE" });
				} finally {
					setAttempt((n) => n + 1);
				}
			}

			const models = state.data?.models ?? [];
			const version = state.data?.version ?? "1";
			const active = models[activeIndex] ?? null;
			const accent = active?.accent || "#d9b46b";

			const assetUrl = useCallback(
				(relative) => {
					const raw = String(relative ?? "");
					const base = /^\/|^https?:/i.test(raw) ? raw : ASSETS + raw.replace(/^\/+/, "");
					return base + (base.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(version);
				},
				[version]
			);

			return h(
				"div",
				{ className: "lmk-root", "data-scheme": scheme, style: { "--lmk-accent": accent } },
				h(
					"header",
					{ className: "lmk-head" },
					h(
						"div",
						{ className: "lmk-head-main" },
						h("span", { className: "lmk-mark" }, h(TowerGlyph, { size: 20 })),
						h(
							"div",
							null,
							h("div", { className: "lmk-title" }, t("title")),
							h("div", { className: "lmk-sub" }, t("subtitle"))
						)
					),
					h(
						"div",
						{ className: "lmk-head-meta" },
						h("span", { className: "lmk-count" }, String(models.length || 4).padStart(2, "0") + " " + t("exhibits")),
						h("span", { className: "lmk-tag" }, t("built")),
						h(
							"button",
							{ type: "button", className: "lmk-import-btn", onClick: () => setImportOpen(true) },
							h("span", { className: "lmk-import-plus" }, "＋"),
							t("importBtn")
						)
					)
				),
				h(
					"div",
					{ className: "lmk-body" },
					h(
						"aside",
						{ className: "lmk-rail", "aria-label": t("indexTitle") },
						state.phase === "ready"
							? [
									h("div", { className: "lmk-rail-label", key: "label" }, t("indexTitle")),
									...models.map((model, index) =>
										h(
											"button",
											{
												key: model.id,
												type: "button",
												className: "lmk-card" + (index === activeIndex ? " is-active" : ""),
												style: { "--lmk-accent": model.accent || accent },
												onClick: () => setActiveIndex(index),
												"aria-pressed": index === activeIndex,
												title: pick(model.name, lang),
											},
											h(
												"span",
												{ className: "lmk-card-thumb" },
												h(GlobeGlyph, { size: 20 }),
												model.thumb
													? h("img", {
															src: assetUrl(model.thumb),
															alt: "",
															loading: "lazy",
															decoding: "async",
															onError: (event) => {
																event.currentTarget.style.display = "none";
															},
														})
													: null
											),
											h("span", { className: "lmk-card-name" }, pick(model.name, lang)),
											h("span", { className: "lmk-card-place" }, pick(model.place, lang)),
											h("span", { className: "lmk-card-no" }, String(index + 1).padStart(2, "0"))
										)
									),
									h(
										"div",
										{ className: "lmk-rail-foot", key: "foot" },
										pick(state.data?.credit, lang) || "Blender · glTF 2.0"
									),
								]
							: h(
									"div",
									{ className: "lmk-skeleton" },
									h("div", { className: "lmk-skeleton-row" }),
									h("div", { className: "lmk-skeleton-row" }),
									h("div", { className: "lmk-skeleton-row" }),
									h("div", { className: "lmk-skeleton-row" })
								)
					),
					active
						? h(Stage, {
								key: "stage",
								model: active,
								models,
								index: activeIndex,
								lang,
								t,
								accent,
								assetUrl,
								autoRotate,
								setAutoRotate,
								onDelete: removeModel,
							})
						: h(
								"section",
								{ className: "lmk-stage", "aria-busy": state.phase === "boot" },
								h(
									"div",
									{ className: "lmk-overlay" },
									state.phase === "error"
										? h(
												"div",
												{ className: "lmk-error" },
												h("div", { className: "lmk-error-title" }, t("manifestFailed")),
												h("div", { className: "lmk-error-text" }, t("manifestHint")),
												h(
													"button",
													{ type: "button", className: "lmk-retry", onClick: () => setAttempt((n) => n + 1) },
													t("retry")
												)
											)
										: h(
												"div",
												{ className: "lmk-loading" },
												h("div", { className: "lmk-spinner" }),
												h("div", { className: "lmk-loading-text" }, t("stageLoading"))
											)
								)
							)
				),
				importOpen
					? h(ImportDialog, {
							t,
							onClose: () => setImportOpen(false),
							onImported: (model) => {
								setImportOpen(false);
								setPendingId(model?.id ?? null);
								setAttempt((n) => n + 1);
							},
						})
					: null
			);
		}

		function Stage(props) {
			const { model, models, index, lang, t, accent, assetUrl, autoRotate, setAutoRotate, onDelete } = props;
			const stageRef = useRef(null);
			const hostRef = useRef(null);
			const engineRef = useRef(null);
			const [enginePhase, setEnginePhase] = useState("boot");
			const [load, setLoad] = useState({ phase: "idle", progress: 0, error: null });
			const [engineError, setEngineError] = useState(null);
			const [attempt, setAttempt] = useState(0);
			const [fullscreen, setFullscreen] = useState(false);

			useEffect(() => {
				let alive = true;
				setEnginePhase("boot");
				setEngineError(null);
				ensureThree()
					.then((THREE) => {
						if (!alive || !hostRef.current) return;
						const viewer = createViewer(hostRef.current, THREE);
						engineRef.current = viewer;
						setEnginePhase("ready");
					})
					.catch((error) => {
						if (!alive) return;
						setEnginePhase("error");
						setEngineError(error instanceof Error ? error : new Error(String(error)));
					});
				return () => {
					alive = false;
					engineRef.current?.dispose();
					engineRef.current = null;
					setEnginePhase("boot");
				};
			}, [attempt]);

			useEffect(() => {
				const viewer = engineRef.current;
				if (!viewer || enginePhase !== "ready") return;
				const url = assetUrl(model.model);
				setLoad({ phase: "loading", progress: 0, error: null });
				viewer.show(url, {
					onProgress: (progress) => setLoad((prev) => (prev.phase === "ready" ? prev : { ...prev, progress })),
					onReady: () => setLoad({ phase: "ready", progress: 1, error: null }),
					onError: (error) => setLoad({ phase: "error", progress: 0, error }),
				});
			}, [enginePhase, model.model, assetUrl, attempt]);

			useEffect(() => {
				engineRef.current?.setAutoRotate(autoRotate);
			}, [autoRotate, enginePhase]);

			useEffect(() => {
				const onFullscreen = () => setFullscreen(!!document.fullscreenElement);
				document.addEventListener("fullscreenchange", onFullscreen);
				return () => document.removeEventListener("fullscreenchange", onFullscreen);
			}, []);

			const toggleFullscreen = useCallback(() => {
				const element = stageRef.current;
				if (!element) return;
				if (document.fullscreenElement) {
					document.exitFullscreen?.().catch(() => {});
				} else {
					element.requestFullscreen?.().catch(() => {});
				}
			}, []);

			const resetView = useCallback(() => {
				engineRef.current?.reset();
			}, []);

			const reload = useCallback(() => {
				setAttempt((n) => n + 1);
			}, []);

			const busy = enginePhase !== "ready" || load.phase === "loading";
			const failed = enginePhase === "error" || load.phase === "error";
			const progress = Math.round((load.progress || 0) * 100);

			return h(
				"section",
				{
					ref: stageRef,
					className: "lmk-stage",
					"aria-label": pick(model.name, lang),
					"aria-busy": busy,
				},
				h("div", { className: "lmk-glow", "aria-hidden": "true" }),
				h("div", { className: "lmk-canvas", ref: hostRef }),
				h(
					"div",
					{ className: "lmk-stage-top" },
					h(
						"div",
						{ className: "lmk-place" },
						h("b", null, pick(model.name, lang)),
						h("span", null, String(index + 1).padStart(2, "0") + " / " + String(models.length).padStart(2, "0") + " · " + pick(model.place, lang))
					),
					h(
						"div",
						{ className: "lmk-tools" },
						h(
							"button",
							{
								type: "button",
								className: "lmk-tool",
								"aria-pressed": autoRotate,
								"aria-label": autoRotate ? t("autoRotateOn") : t("autoRotate"),
								title: autoRotate ? t("autoRotateOn") : t("autoRotate"),
								onClick: () => setAutoRotate((value) => !value),
							},
							h(OrbitIcon, { size: 16 })
						),
						h(
							"button",
							{ type: "button", className: "lmk-tool", "aria-label": t("reset"), title: t("reset"), onClick: resetView },
							h(ResetIcon, { size: 16 })
						),
						h(
							"button",
							{
								type: "button",
								className: "lmk-tool",
								"aria-label": fullscreen ? t("exitFullscreen") : t("fullscreen"),
								title: fullscreen ? t("exitFullscreen") : t("fullscreen"),
								onClick: toggleFullscreen,
							},
							h(ExpandIcon, { size: 16 })
						)
					)
				),
				load.phase === "ready" && !busy
					? h(
							"div",
							{ className: "lmk-info" },
							h("div", { className: "lmk-info-eyebrow" }, pick(model.place, lang)),
							h("h2", null, pick(model.name, lang)),
							h("div", { className: "lmk-info-en" }, lang === "zh" ? model.name?.en ?? "" : model.name?.zh ?? ""),
							model.blurb ? h("p", null, pick(model.blurb, lang)) : null,
							h(
								"div",
								{ className: "lmk-chips" },
								model.year ? h("span", { className: "lmk-chip" }, t("year"), " ", h("b", null, model.year)) : null,
								model.scale ? h("span", { className: "lmk-chip" }, t("scale"), " ", h("b", null, pick(model.scale, lang))) : null,
								model.bytes
									? h("span", { className: "lmk-chip" }, t("file"), " ", h("b", null, formatBytes(model.bytes)))
									: null,
								model.imported ? h("span", { className: "lmk-chip is-imported" }, t("importedTag")) : null
							),
							model.imported
								? h("button", { type: "button", className: "lmk-delete", onClick: () => onDelete?.(model), title: t("deleteModel") }, "✕ " + t("deleteModel"))
								: null
						)
					: null,
				load.phase === "ready" && !busy ? h("div", { className: "lmk-hint" }, t("hint")) : null,
				failed
					? h(
							"div",
							{ className: "lmk-overlay" },
							h(
								"div",
								{ className: "lmk-error" },
								h("div", { className: "lmk-error-title" }, enginePhase === "error" ? t("engineLoading") + " ✗" : t("modelFailed")),
								h(
									"div",
									{ className: "lmk-error-text" },
									String((engineError || load.error)?.message || "").slice(0, 180)
								),
								h("button", { type: "button", className: "lmk-retry", onClick: reload }, t("retry"))
							)
						)
					: busy
						? h(
								"div",
								{ className: "lmk-overlay" },
								h(
									"div",
									{ className: "lmk-loading" },
									h("div", { className: "lmk-spinner" }),
									h("div", { className: "lmk-loading-text" }, enginePhase !== "ready" ? t("engineLoading") : t("modelLoading")),
									h("div", { className: "lmk-bar" }, h("i", { style: { width: Math.max(6, progress) + "%" } }))
								)
							)
						: null
			);
		}

		/* ------------------------------------------------------------------ *
		 * plugin module
		 * ------------------------------------------------------------------ */

		const name = "models-3d";
		const inject = ["slots", "locale", "theme"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-models-3d: dictionaries");

			const t = ctx.locale.bind(NS);
			const themeStore = {
				subscribe: (callback) => ctx.on("theme/change", () => callback()),
				getSnapshot: () => ctx.theme.getTheme(),
			};
			const localeStore = {
				subscribe: (callback) => ctx.locale.subscribe(callback),
				getSnapshot: () => ctx.locale.getSnapshot(),
			};

			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.dshPlugin = "dsh-models-3d";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-models-3d: styles");

			// 侧栏与主面板的 slot 由 shell 自己的条目声明，可能晚于本插件激活；
			// 直接 register 会抛 `slot "…" is not declared` 并让整个 web boot 失败，
			// 必须用 slots.inject 等声明出现后再注册。
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: "models-3d",
						order: 24,
						label: () => t("nav"),
						locale: NS,
					},
					(owner = {}) => h(SidebarIcon, owner)
				)
			);

			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: "models-3d",
						locale: NS,
						inject: () => ({ t }),
					},
					() => h(LandmarksPanel, { t, themeStore, localeStore })
				)
			);

		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	},
});
