async function unmapJS(jsUrl) {
    try {
        const jsResp = await fetch(jsUrl);
        if (!jsResp.ok) throw new Error("Failed to fetch JS file");

        const jsText = await jsResp.text();

        // 1. find the sourcemap URL inside JS
        const match = jsText.match(/\/\/# sourceMappingURL=(.*)/);
        if (!match) throw new Error("No SourceMap found in JS file");

        let mapUrl = match[1].trim();

        // Fix relative URL
        if (!mapUrl.startsWith("http")) {
            const base = jsUrl.split("/").slice(0, -1).join("/");
            mapUrl = base + "/" + mapUrl;
        }

        // 2. Download the .map file
        const mapResp = await fetch(mapUrl);
        if (!mapResp.ok) throw new Error("Failed to fetch .map file");

        const mapJson = await mapResp.json();

        // 3. Return sources
        return mapJson.sources.map((file, i) => ({
            filename: file,
            content: mapJson.sourcesContent[i] || "No content"
        }));

    } catch (err) {
        return { error: err.message };
    }
}

document.getElementById("unmapBtn").onclick = async () => {
    const url = document.getElementById("urlInput").value.trim();
    const resultDiv = document.getElementById("result");
    resultDiv.innerHTML = "Processing...";

    const files = await unmapJS(url);

    if (files.error) {
        resultDiv.innerHTML = `<span style="color:red">${files.error}</span>`;
        return;
    }

    let output = "";
    files.forEach(file => {
        output += `\n\n===== ${file.filename} =====\n\n`;
        output += file.content;
    });

    resultDiv.textContent = output;
};
