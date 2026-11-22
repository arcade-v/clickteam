(() => {
    "use strict";

    const runtimeCanvas = "resources/FiveNights2NOHACKS.cch";
    const partCount = 9;
    const resourceMap = new Map();
    const blobUrls = [];

    function updateProgress(id, percent) {
        const bar = document.getElementById(id + "-bar");
        const text = document.getElementById(id + "-text");

        percent = Math.max(0, Math.min(100, Math.floor(percent)));

        if (bar) bar.style.width = percent + "%";
        if (text) text.textContent = percent + "%";
    }

    function showError(error) {
        console.error("FNAF 2 loading error:", error);

        const container = document.getElementById("loading-error");

        if (container) {
            container.textContent =
                "Game loading failed: " +
                (error?.message || String(error));

            container.style.display = "block";
        }
    }

    function normalizePath(path) {
        return String(path)
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .replace(/^\.\/+/, "");
    }

    async function fetchWithFallback(filename) {
        let lastError;

        for (const base of cdnBases) {
            const url = base + filename;

            try {
                const response = await fetch(url, {
                    cache: "no-store"
                });

                if (!response.ok) {
                    throw new Error(
                        "HTTP " + response.status + " loading " + url
                    );
                }

                return response;
            } catch (error) {
                console.warn("CDN failed:", url, error);
                lastError = error;
            }
        }

        throw lastError || new Error("All CDNs failed: " + filename);
    }

    async function mergeParts() {
        const buffers = [];
        let totalLoaded = 0;

        for (let i = 1; i <= partCount; i++) {
            const filename = "resources.zip.part" + i;

            console.log("Downloading:", filename);

            const response = await fetchWithFallback(filename);
            const buffer = await response.arrayBuffer();

            buffers.push(buffer);
            totalLoaded++;

            updateProgress(
                "download",
                (totalLoaded / partCount) * 100
            );
        }

        return new Blob(buffers, {
            type: "application/zip"
        });
    }

    async function extractResources() {
        if (!window.JSZip) {
            throw new Error("JSZip is not available.");
        }

        const mergedZip = await mergeParts();
        const zip = await JSZip.loadAsync(mergedZip);

        const files = Object.keys(zip.files).filter(
            name => !zip.files[name].dir
        );

        if (!files.length) {
            throw new Error("The ZIP archive contains no files.");
        }

        for (let i = 0; i < files.length; i++) {
            const filename = files[i];
            const file = zip.files[filename];

            const blob = await file.async("blob");
            const blobUrl = URL.createObjectURL(blob);

            blobUrls.push(blobUrl);

            const normalized = normalizePath(filename);
            const basename = normalized.split("/").pop();

            resourceMap.set(normalized, blobUrl);
            resourceMap.set(basename, blobUrl);

            updateProgress(
                "extract",
                ((i + 1) / files.length) * 100
            );
        }

        console.log("Extracted resources:", files.length);
    }

    function findResource(input) {
        if (typeof input !== "string") return null;

        let pathname;

        try {
            pathname = new URL(input, document.baseURI).pathname;
        } catch {
            pathname = input;
        }

        pathname = normalizePath(
            decodeURIComponent(pathname)
        );

        const resourcesIndex = pathname.lastIndexOf("resources/");

        if (resourcesIndex !== -1) {
            pathname = pathname.slice(resourcesIndex);
        }

        if (resourceMap.has(pathname)) {
            return resourceMap.get(pathname);
        }

        const basename = pathname.split("/").pop();

        return resourceMap.get(basename) || null;
    }

    function installInterceptors() {
        // Fetch interception
        const originalFetch = window.fetch;

        window.fetch = function (input, init) {
            const originalUrl =
                input instanceof Request ? input.url : input;

            const replacement = findResource(originalUrl);

            if (replacement) {
                if (input instanceof Request) {
                    return originalFetch(
                        new Request(replacement, input),
                        init
                    );
                }

                return originalFetch(replacement, init);
            }

            return originalFetch(input, init);
        };

        // XMLHttpRequest interception
        const originalOpen = XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open = function (
            method,
            url,
            ...args
        ) {
            const replacement = findResource(url);

            if (replacement) {
                url = replacement;
            }

            return originalOpen.call(
                this,
                method,
                url,
                ...args
            );
        };

        // Image, audio, and video interception
        const mediaTypes = [
            HTMLImageElement,
            HTMLAudioElement,
            HTMLVideoElement
        ];

        for (const ElementType of mediaTypes) {
            const descriptor = Object.getOwnPropertyDescriptor(
                ElementType.prototype,
                "src"
            );

            if (!descriptor || !descriptor.set) continue;

            Object.defineProperty(ElementType.prototype, "src", {
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

    async function loadRuntime() {
        let lastError;

        for (const base of cdnBases) {
            const script = document.createElement("script");
            script.src = base + "Runtime.js";

            try {
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = () => {
                        script.remove();
                        reject(
                            new Error("Failed to load " + script.src)
                        );
                    };

                    document.head.appendChild(script);
                });

                if (typeof window.Runtime !== "function") {
                    throw new Error(
                        "Runtime.js loaded, but Runtime was not defined."
                    );
                }

                return;
            } catch (error) {
                console.warn("Runtime CDN failed:", error);
                lastError = error;
            }
        }

        throw lastError || new Error("Could not load Runtime.js.");
    }

    async function startGame() {
        try {
            updateProgress("download", 0);
            updateProgress("extract", 0);

            await extractResources();

            installInterceptors();

            await loadRuntime();

            new Runtime("MMFCanvas", runtimeCanvas);

            const progress = document.getElementById(
                "progress-container"
            );

            if (progress) {
                progress.style.display = "none";
            }

            console.log("FNAF 2 started successfully.");
        } catch (error) {
            showError(error);
        }
    }

    window.addEventListener("pagehide", () => {
        for (const url of blobUrls) {
            URL.revokeObjectURL(url);
        }

        blobUrls.length = 0;
    });

    startGame();
})();