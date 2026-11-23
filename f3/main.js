(() => {
    const runtimeCanvas = "resources/fnaf 3.cch";
    const partCount = 10;

    const resourceMap = new Map();
    const blobUrls = [];

    const progressContainer = document.getElementById("progress-container");

    function updateProgress(id, percent) {
        const bar = document.getElementById(id + "-bar");
        const text = document.getElementById(id + "-text");

        if (bar) bar.style.width = percent + "%";
        if (text) text.innerText = percent + "%";
    }

    function showError(error) {
        console.error("[FNAF 3 Loader]", error);

        let element = document.getElementById("loading-error");

        if (!element) {
            element = document.createElement("pre");
            element.id = "loading-error";
            element.style.cssText =
                "color:#ff7777;white-space:pre-wrap;padding:12px;font:14px monospace;";
            document.body.appendChild(element);
        }

        element.textContent =
            "Failed to load Five Nights at Freddy's 3:\n" +
            (error?.stack || error?.message || String(error));
    }

    async function fetchWithFallback(filename) {
        const errors = [];

        for (const base of cdnBases) {
            const url = base + filename;

            try {
                const response = await fetch(url, {
                    cache: "no-store"
                });

                if (!response.ok) {
                    throw new Error("HTTP " + response.status);
                }

                return response;
            } catch (error) {
                errors.push(url + ": " + error.message);
            }
        }

        throw new Error(
            "Could not download " + filename + "\n" + errors.join("\n")
        );
    }

    function normalizePath(path) {
        return decodeURIComponent(path)
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .toLowerCase();
    }

    async function downloadAndMergeParts() {
        const buffers = [];
        let totalLoaded = 0;

        for (let i = 1; i <= partCount; i++) {
            const filename = "resources.zip.part" + i;

            const response = await fetchWithFallback(filename);
            const buffer = await response.arrayBuffer();

            buffers.push(buffer);
            totalLoaded += buffer.byteLength;

            updateProgress(
                "download",
                Math.floor((i / partCount) * 100)
            );
        }

        return new Blob(buffers, {
            type: "application/zip"
        });
    }

    async function extractResources(zipBlob) {
        const zip = await JSZip.loadAsync(zipBlob);
        const files = Object.keys(zip.files).filter(
            name => !zip.files[name].dir
        );

        if (!files.length) {
            throw new Error("The resource ZIP contains no files.");
        }

        for (let i = 0; i < files.length; i++) {
            const name = files[i];
            const file = zip.files[name];
            const blob = await file.async("blob");
            const url = URL.createObjectURL(blob);

            blobUrls.push(url);

            const normalized = normalizePath(name);
            const basename = normalized.split("/").pop();

            resourceMap.set(normalized, url);
            resourceMap.set(basename, url);

            updateProgress(
                "extract",
                Math.floor(((i + 1) / files.length) * 100)
            );
        }
    }

    function findResource(input) {
        if (typeof input !== "string") return null;

        let path;

        try {
            path = new URL(input, document.baseURI).pathname;
        } catch {
            path = input;
        }

        path = normalizePath(path);

        const resourceIndex = path.lastIndexOf("resources/");

        if (resourceIndex !== -1) {
            path = path.substring(resourceIndex + "resources/".length);
        }

        return resourceMap.get(path) ||
            resourceMap.get(path.split("/").pop()) ||
            null;
    }

    function installInterceptors() {
        const originalFetch = window.fetch;

        window.fetch = function(input, init) {
            const originalUrl =
                input instanceof Request ? input.url : input;

            const replacement = findResource(originalUrl);

            if (replacement) {
                return originalFetch.call(this, replacement, init);
            }

            return originalFetch.call(this, input, init);
        };

        const originalOpen = XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            const replacement = findResource(url);

            if (replacement) {
                url = replacement;
            }

            return originalOpen.call(this, method, url, ...args);
        };

        const mediaTypes = [
            HTMLImageElement,
            HTMLAudioElement,
            HTMLVideoElement
        ];

        for (const Tag of mediaTypes) {
            const descriptor = Object.getOwnPropertyDescriptor(
                Tag.prototype,
                "src"
            );

            if (!descriptor || !descriptor.set) continue;

            Object.defineProperty(Tag.prototype, "src", {
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
                    script.onerror = () => reject(
                        new Error("Failed to load " + script.src)
                    );

                    document.head.appendChild(script);
                });

                if (typeof Runtime !== "function") {
                    throw new Error("Runtime.js loaded, but Runtime is unavailable.");
                }

                new Runtime("MMFCanvas", runtimeCanvas);

                if (progressContainer) {
                    progressContainer.style.display = "none";
                }

                return;
            } catch (error) {
                lastError = error;
                script.remove();
            }
        }

        throw lastError || new Error("Could not load Runtime.js.");
    }

    async function start() {
        if (typeof JSZip === "undefined") {
            throw new Error("JSZip is not loaded.");
        }

        const zipBlob = await downloadAndMergeParts();

        await extractResources(zipBlob);

        installInterceptors();

        await loadRuntime();
    }

    window.addEventListener("pagehide", () => {
        for (const url of blobUrls) {
            URL.revokeObjectURL(url);
        }
    });

    start().catch(showError);
})();