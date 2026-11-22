(() => {
    const runtimecanvas = "resources/fnac2.cch";
    const parts = 12;

    const map = new Map();
    const blobUrls = [];
    const originalFetch = window.fetch.bind(window);

    function updateProgress(id, percent) {
        percent = Math.max(0, Math.min(100, Math.floor(percent)));

        const bar = document.getElementById(id + "-bar");
        const text = document.getElementById(id + "-text");

        if (bar) bar.style.width = percent + "%";
        if (text) text.innerText = percent + "%";
    }

    function showError(error) {
        console.error(error);

        const container = document.getElementById("loading-error");

        if (container) {
            container.textContent =
                "Game loading failed: " +
                (error?.message || String(error));

            container.style.display = "block";
        }
    }

    function makeBlobUrl(blob) {
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        return url;
    }

    async function fetchWithFallback(path) {
        let lastError;

        for (const base of cdnBases) {
            const url = base + path;

            try {
                const response = await originalFetch(url);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${url}`);
                }

                return response;
            } catch (error) {
                lastError = error;
                console.warn("CDN failed:", url, error);
            }
        }

        throw lastError || new Error("All CDN sources failed: " + path);
    }

    function getMappedResource(url) {
        if (typeof url !== "string") return null;

        let path = url;

        try {
            path = new URL(url, document.baseURI).pathname;
        } catch (_) {}

        try {
            path = decodeURIComponent(path);
        } catch (_) {}

        const resourceIndex = path.lastIndexOf("/resources/");

        if (resourceIndex !== -1) {
            path = path.slice(resourceIndex + "/resources/".length);
        } else {
            path = path.replace(/^resources\//, "");
        }

        if (map.has(path)) {
            return map.get(path);
        }

        const fileName = path.split("/").pop();

        if (map.has(fileName)) {
            return map.get(fileName);
        }

        return null;
    }

    async function intercept() {
        // Fetch interception
        window.fetch = async function (input, init) {
            const inputUrl =
                typeof input === "string" ? input :
                input instanceof Request ? input.url : "";

            const mapped = getMappedResource(inputUrl);

            if (mapped) {
                return originalFetch(mapped, init);
            }

            return originalFetch(input, init);
        };

        // XMLHttpRequest interception
        const originalOpen = XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            const mapped = getMappedResource(url);

            if (mapped) {
                url = mapped;
            }

            return originalOpen.call(this, method, url, ...args);
        };

        // Image, audio, and video interception
        const mediaTypes = [
            HTMLImageElement,
            HTMLAudioElement,
            HTMLVideoElement
        ];

        for (const Tag of mediaTypes) {
            const descriptor =
                Object.getOwnPropertyDescriptor(Tag.prototype, "src");

            if (!descriptor || !descriptor.set) continue;

            Object.defineProperty(Tag.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,

                set: function (value) {
                    const mapped = getMappedResource(value);

                    if (mapped) {
                        value = mapped;
                    }

                    descriptor.set.call(this, value);
                }
            });
        }
    }

    async function downloadPart(partNumber) {
        const path = `resources.zip.part${partNumber}`;
        const response = await fetchWithFallback(path);

        return await response.arrayBuffer();
    }

    async function mergeFiles() {
        const buffers = [];

        for (let i = 1; i <= parts; i++) {
            console.log(`Downloading resources.zip part ${i}/${parts}`);

            const buffer = await downloadPart(i);
            buffers.push(buffer);

            updateProgress("download", (i / parts) * 100);
        }

        const mergedBlob = new Blob(buffers, {
            type: "application/zip"
        });

        return makeBlobUrl(mergedBlob);
    }

    async function extract(zipUrl) {
        if (!window.JSZip) {
            throw new Error("JSZip is not available.");
        }

        const response = await originalFetch(zipUrl);

        if (!response.ok) {
            throw new Error("Could not read the merged resources ZIP.");
        }

        const arrayBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const files = Object.keys(zip.files).filter(
            name => !zip.files[name].dir
        );

        if (!files.length) {
            throw new Error("The resources ZIP contains no files.");
        }

        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];
            const file = zip.files[filePath];

            const blob = await file.async("blob");
            const url = makeBlobUrl(blob);

            // Store the relative path and basename.
            const normalizedPath = filePath.replace(/^resources\//, "");

            map.set(normalizedPath, url);
            map.set(filePath, url);
            map.set(filePath.split("/").pop(), url);

            updateProgress("extract", ((i + 1) / files.length) * 100);
        }

        console.log(`Extracted ${files.length} resource files.`);
    }

    async function loadRuntime() {
        let lastError;

        for (const base of cdnBases) {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement("script");

                    script.src = base + "Runtime.js";
                    script.onload = resolve;

                    script.onerror = () => {
                        script.remove();
                        reject(new Error("Runtime.js failed to load from " + base));
                    };

                    document.head.appendChild(script);
                });

                console.log("Runtime.js loaded from:", base);
                return;
            } catch (error) {
                lastError = error;
                console.warn(error);
            }
        }

        throw lastError || new Error("Runtime.js could not be loaded.");
    }

    async function startGame() {
        try {
            if (!window.JSZip) {
                throw new Error("JSZip has not loaded.");
            }

            // Download and merge all 12 ZIP parts.
            const resourcesUrl = await mergeFiles();

            // Extract the merged ZIP.
            await extract(resourcesUrl);

            // Redirect resource requests to extracted Blob URLs.
            await intercept();

            // Load the Clickteam runtime.
            await loadRuntime();

            if (typeof Runtime !== "function") {
                throw new Error("Runtime.js loaded, but Runtime is unavailable.");
            }

            document.getElementById("progress-container").style.display = "none";

            new Runtime("MMFCanvas", runtimecanvas);

        } catch (error) {
            showError(error);
        }
    }

    window.addEventListener("pagehide", () => {
        for (const url of blobUrls) {
            URL.revokeObjectURL(url);
        }
    });

    startGame();
})();