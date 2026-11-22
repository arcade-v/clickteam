(() => {
    "use strict";

    const runtimeCanvas = "resources/FNAF1HTML5.cch";
    const partCount = 8;
    const resourceMap = new Map();
    const blobURLs = [];

    function updateProgress(id, percent) {
        const bar = document.getElementById(id + "-bar");
        const text = document.getElementById(id + "-text");

        const value = Math.max(0, Math.min(100, Math.floor(percent)));

        if (bar) bar.style.width = value + "%";
        if (text) text.textContent = value + "%";
    }

    function showError(error) {
        console.error(error);

        const container = document.getElementById("loading-error");
        if (container) {
            container.textContent =
                "Game loading failed: " +
                (error.message || String(error));

            container.style.display = "block";
        }
    }

    async function fetchWithFallback(filename) {
        let lastError;

        for (const base of cdnBases) {
            const url = base + filename;

            try {
                console.log("Trying:", url);

                const response = await fetch(url, {
                    method: "GET",
                    cache: "no-store"
                });

                if (!response.ok) {
                    throw new Error(
                        "HTTP " + response.status + " for " + url
                    );
                }

                return response;
            } catch (error) {
                console.warn("CDN failed:", url, error);
                lastError = error;
            }
        }

        throw lastError || new Error("Unable to download " + filename);
    }

    async function mergeParts() {
        const buffers = [];

        for (let i = 1; i <= partCount; i++) {
            const filename = "resources.zip.part" + i;

            const response = await fetchWithFallback(filename);
            const buffer = await response.arrayBuffer();

            if (!buffer.byteLength) {
                throw new Error("Empty ZIP part: " + filename);
            }

            buffers.push(buffer);

            updateProgress("download", (i / partCount) * 100);
            console.log("Downloaded part", i, "of", partCount);
        }

        return new Blob(buffers, {
            type: "application/zip"
        });
    }

    function normalizePath(path) {
        return String(path)
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .replace(/^\.\/+/, "");
    }

    async function extractResources(zipBlob) {
        const zip = await JSZip.loadAsync(zipBlob);

        const files = Object.keys(zip.files).filter(name => {
            return !zip.files[name].dir;
        });

        if (!files.length) {
            throw new Error("The ZIP archive contains no files.");
        }

        for (let i = 0; i < files.length; i++) {
            const filename = files[i];
            const file = zip.files[filename];

            const blob = await file.async("blob");
            const url = URL.createObjectURL(blob);

            blobURLs.push(url);

            const normalized = normalizePath(filename);
            const basename = normalized.split("/").pop();

            resourceMap.set(normalized, url);
            resourceMap.set(basename, url);

            updateProgress(
                "extract",
                ((i + 1) / files.length) * 100
            );
        }

        console.log("Extracted", files.length, "resources.");
    }

    function findResource(input) {
        if (typeof input !== "string") return null;

        let pathname = input;

        try {
            pathname = new URL(input, document.baseURI).pathname;
        } catch (_) {}

        pathname = normalizePath(pathname);

        const resourceIndex = pathname.lastIndexOf("resources/");

        if (resourceIndex !== -1) {
            pathname = pathname.slice(resourceIndex);
        }

        if (resourceMap.has(pathname)) {
            return resourceMap.get(pathname);
        }

        const basename = pathname.split("/").pop();

        if (resourceMap.has(basename)) {
            return resourceMap.get(basename);
        }

        return null;
    }

    function installInterceptors() {
        // Fetch interception.
        const originalFetch = window.fetch;

        window.fetch = function(input, init) {
            const originalURL =
                typeof input === "string"
                    ? input
                    : input instanceof Request
                        ? input.url
                        : "";

            const replacement = findResource(originalURL);

            if (replacement) {
                return originalFetch.call(window, replacement, init);
            }

            return originalFetch.call(window, input, init);
        };

        // XMLHttpRequest interception.
        const originalOpen = XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            const replacement = findResource(url);

            if (replacement) {
                url = replacement;
            }

            return originalOpen.call(this, method, url, ...args);
        };

        // Image, audio, and video source interception.
        const mediaTypes = [
            HTMLImageElement,
            HTMLAudioElement,
            HTMLVideoElement
        ];

        for (const Type of mediaTypes) {
            const descriptor =
                Object.getOwnPropertyDescriptor(Type.prototype, "src");

            if (!descriptor || !descriptor.set) continue;

            Object.defineProperty(Type.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,

                get: descriptor.get,

                set(value) {
                    const replacement = findResource(value);

                    descriptor.set.call(
                        this,
                        replacement || value
                    );
                }
            });
        }
    }

    function loadRuntime() {
        return new Promise((resolve, reject) => {
            let index = 0;

            function attempt() {
                if (index >= cdnBases.length) {
                    reject(new Error(
                        "Could not load Runtime.js from any CDN."
                    ));
                    return;
                }

                const url = cdnBases[index++] + "Runtime.js";
                const script = document.createElement("script");

                script.src = url;

                script.onload = () => {
                    console.log("Runtime.js loaded:", url);

                    try {
                        if (typeof Runtime !== "function") {
                            throw new Error(
                                "Runtime.js loaded, but Runtime is unavailable."
                            );
                        }

                        new Runtime("MMFCanvas", runtimeCanvas);

                        const progress =
                            document.getElementById("progress-container");

                        if (progress) {
                            progress.style.display = "none";
                        }

                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };

                script.onerror = () => {
                    console.warn("Runtime.js failed:", url);
                    script.remove();
                    attempt();
                };

                document.head.appendChild(script);
            }

            attempt();
        });
    }

    async function startGame() {
        try {
            if (typeof JSZip === "undefined") {
                throw new Error("JSZip is not available.");
            }

            console.log("Downloading FNAF 1 resources...");

            const zipBlob = await mergeParts();

            console.log("Extracting FNAF 1 resources...");

            await extractResources(zipBlob);

            installInterceptors();

            console.log("Starting Clickteam runtime...");

            await loadRuntime();

        } catch (error) {
            showError(error);
        }
    }

    window.addEventListener("pagehide", () => {
        for (const url of blobURLs) {
            URL.revokeObjectURL(url);
        }

        blobURLs.length = 0;
    });

    startGame();
})();
