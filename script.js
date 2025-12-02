// Global state for pagination
window.sourceMapData = null;
window.currentPage = 0;
const FILES_PER_PAGE = 50;

// Drag & drop support
document.addEventListener('DOMContentLoaded', function() {
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        document.body.classList.add('drag-over');
    });

    document.body.addEventListener('dragleave', () => {
        document.body.classList.remove('drag-over');
    });

    document.body.addEventListener('drop', async (e) => {
        e.preventDefault();
        document.body.classList.remove('drag-over');

        let file = e.dataTransfer.files[0];
        if (file) {
            await handleFileLoad(file);
        }
    });
});

// Handle file loading (shared by upload and drag-drop)
async function handleFileLoad(file) {
    let output = document.getElementById("output");
    output.innerHTML = `<p>⏳ Reading ${file.name} (${formatSize(file.size)})...</p>`;

    let reader = new FileReader();
    reader.onload = async function(e) {
        try {
            let text = e.target.result;
            output.innerHTML = `<p>⏳ Parsing ${formatSize(text.length)}...</p>`;

            let json = await parseJSONAsync(text);
            await processSourceMap(json, output, `📦 Loaded ${formatSize(text.length)} from ${file.name}`);
        } catch (err) {
            output.innerHTML = `<p class="error">❌ Failed to parse file.</p><pre>${err}</pre>`;
        }
    };
    reader.onerror = function() {
        output.innerHTML = '<p class="error">❌ Failed to read file.</p>';
    };
    reader.readAsText(file);
}

function unmapSourceMap(sm) {
    // Store for pagination
    window.sourceMapData = sm;
    window.currentPage = 0;

    let html = '<div class="summary">';
    html += '<h3>📦 Unmapped Source Files</h3>';

    // Debug info
    let totalSize = JSON.stringify(sm).length;
    html += `<p>Version: ${sm.version || 'unknown'} | `;
    html += `Sources: ${sm.sources ? sm.sources.length : 0} | `;
    html += `With Content: ${sm.sourcesContent ? sm.sourcesContent.length : 0} | `;
    html += `Size: ${formatSize(totalSize)}</p>`;

    // Large file warning
    if (totalSize > 5000000) {
        html += `<p class="warning">⚠️ Large source map detected! Files are collapsed by default - click headers to expand.</p>`;
    }

    if (!sm.sources || sm.sources.length === 0) {
        return html + '<p class="error">❌ No "sources" array found in this sourcemap!</p></div>';
    }

    if (!sm.sourcesContent || sm.sourcesContent.length === 0) {
        return html + '<p class="error">❌ No "sourcesContent" found! This map only contains mappings, not original source code.</p></div>';
    }

    // Count file extensions (excluding skipped)
    let extCounts = {};
    let skippedCount = 0;
    sm.sources.forEach((src, idx) => {
        let fileType = detectFileType(src, sm.sourcesContent[idx]);
        if (fileType.type === 'skip') {
            skippedCount++;
            return;
        }
        let ext = src.split('.').pop().toLowerCase() || 'unknown';
        extCounts[ext] = (extCounts[ext] || 0) + 1;
    });

    html += '<div class="ext-summary"><strong>📁 File Types:</strong> ';
    Object.entries(extCounts).sort((a,b) => b[1] - a[1]).forEach(([ext, count]) => {
        html += `<span class="ext-badge">.${ext} (${count})</span> `;
    });
    if (skippedCount > 0) {
        html += `<span class="ext-badge skipped">${skippedCount} skipped</span>`;
    }
    html += '</div>';

    // Controls
    html += '<div class="controls">';
    html += '<button onclick="expandAll()">📂 Expand All</button>';
    html += '<button onclick="collapseAll()">📁 Collapse All</button>';
    html += '</div>';
    html += '</div>';

    // Store binary files for download
    window.binaryFiles = {};

    // Add container for files
    html += '<div id="files-container"></div>';
    html += '<div id="load-more-container"></div>';

    // Render first page after a small delay to show UI first
    setTimeout(() => renderFilesPage(), 10);

    return html;
}

// Render files in pages
function renderFilesPage() {
    let sm = window.sourceMapData;
    if (!sm) return;

    let container = document.getElementById('files-container');
    let loadMoreContainer = document.getElementById('load-more-container');
    if (!container) return;

    let isLargeFile = JSON.stringify(sm).length > 5000000;
    let startIdx = window.currentPage * FILES_PER_PAGE;
    let displayedCount = 0;
    let processedCount = 0;
    let html = '';

    for (let idx = 0; idx < sm.sources.length && displayedCount < FILES_PER_PAGE; idx++) {
        // Skip already rendered
        if (processedCount < startIdx) {
            let fileType = detectFileType(sm.sources[idx], sm.sourcesContent[idx]);
            if (fileType.type !== 'skip') processedCount++;
            continue;
        }

        let src = sm.sources[idx];
        let ext = src.split('.').pop().toLowerCase();
        let content = sm.sourcesContent[idx];
        let fileType = detectFileType(src, content);

        // Skip fonts and images completely
        if (fileType.type === 'skip') continue;

        processedCount++;
        displayedCount++;

        let collapsed = isLargeFile ? 'collapsed' : '';

        html += `<div class="file-block ${collapsed}">`;
        html += `<div class="file-header" data-ext="${ext}" data-type="${fileType.type}" onclick="toggleFile(this)">`;
        html += `<span class="collapse-icon">${isLargeFile ? '▶' : '▼'}</span>`;
        html += `<span class="file-index">#${idx + 1}</span>`;
        html += `<span class="file-path">${escapeHtml(src)}</span>`;
        if (src.includes('.')) {
            html += `<span class="file-ext">.${ext}</span>`;
        }
        if (content) {
            html += `<span class="file-size">${formatSize(content.length)}</span>`;
        }
        if (fileType.type === 'binary') {
            html += `<span class="file-type-badge binary">${fileType.label}</span>`;
        }
        html += '</div>';

        if (content) {
            if (fileType.type === 'binary') {
                let fileId = 'binary_' + idx;
                window.binaryFiles[fileId] = { content, filename: src.split('/').pop() || 'binary_file' };

                html += `<div class="file-body binary-download">`;
                html += `<p>⚠️ File without extension maybe js file or if Binary file - Download to inspect with <code>strings</code> or hex editor`;
                html += `<button onclick="event.stopPropagation(); downloadBinary('${fileId}')" class="btn-download">⬇️ Download ${escapeHtml(src.split('/').pop())}</button>`;
                html += `</div>`;
            } else {
                html += `<div class="file-body"><pre class="file-content">${escapeHtml(content)}</pre></div>`;
            }
        } else {
            html += '<div class="file-body"><pre class="file-content empty">(empty or null)</pre></div>';
        }
        html += '</div>';
    }

    container.innerHTML += html;
    window.currentPage++;

    // Check if more files to load
    let totalDisplayable = sm.sources.filter((src, idx) =>
        detectFileType(src, sm.sourcesContent[idx]).type !== 'skip'
    ).length;

    let loadedSoFar = window.currentPage * FILES_PER_PAGE;

    if (loadedSoFar < totalDisplayable) {
        loadMoreContainer.innerHTML = `
            <button onclick="renderFilesPage()" class="btn-load-more">
                📥 Load More (${loadedSoFar}/${totalDisplayable} files shown)
            </button>`;
    } else {
        loadMoreContainer.innerHTML = `<p class="all-loaded">✅ All ${totalDisplayable} files loaded</p>`;
    }
}

// Toggle file expand/collapse
function toggleFile(header) {
    let block = header.parentElement;
    let icon = header.querySelector('.collapse-icon');
    block.classList.toggle('collapsed');
    icon.textContent = block.classList.contains('collapsed') ? '▶' : '▼';
}

// Expand all files
function expandAll() {
    document.querySelectorAll('.file-block').forEach(el => {
        el.classList.remove('collapsed');
        el.querySelector('.collapse-icon').textContent = '▼';
    });
}

// Collapse all files
function collapseAll() {
    document.querySelectorAll('.file-block').forEach(el => {
        el.classList.add('collapsed');
        el.querySelector('.collapse-icon').textContent = '▶';
    });
}

// Download binary file
function downloadBinary(fileId) {
    let file = window.binaryFiles[fileId];
    if (!file) return alert('File not found');

    let blob = new Blob([file.content], { type: 'application/octet-stream' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Detect if file is binary, font (skip), etc.
function detectFileType(filename, content) {
    let ext = filename.split('.').pop().toLowerCase();

    // Font files - SKIP completely
    const fontExts = ['woff', 'woff2', 'ttf', 'eot', 'otf'];
    if (fontExts.includes(ext)) {
        return { type: 'skip', label: 'FONT (SKIPPED)' };
    }

    // Image files - skip
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp'];
    if (imageExts.includes(ext)) {
        return { type: 'skip', label: 'IMAGE (SKIPPED)' };
    }

    // Known binary extensions that might contain strings
    const binaryExts = ['wasm', 'so', 'dll', 'exe', 'bin', 'dat', 'db'];
    if (binaryExts.includes(ext)) {
        return { type: 'binary', label: '📦 BINARY' };
    }

    // No extension - could be binary
    if (filename === ext || !filename.includes('.')) {
        return { type: 'binary', label: '📦 NO EXTENSION' };
    }

    if (!content) return { type: 'empty', label: 'EMPTY' };

    // Check for base64 data URL - skip images/fonts
    if (content.startsWith('data:')) {
        if (content.startsWith('data:image') || content.startsWith('data:font') ||
            content.startsWith('data:application/font')) {
            return { type: 'skip', label: 'BASE64 ASSET (SKIPPED)' };
        }
        return { type: 'binary', label: '📦 BASE64 DATA' };
    }

    // Check for binary content (non-printable characters)
    let nonPrintable = 0;
    let sampleSize = Math.min(content.length, 1000);
    for (let i = 0; i < sampleSize; i++) {
        let code = content.charCodeAt(i);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            nonPrintable++;
        }
    }
    if (nonPrintable / sampleSize > 0.1) {
        return { type: 'binary', label: '📦 BINARY DATA' };
    }

    return { type: 'code', label: 'CODE' };
}

function formatSize(chars) {
    if (chars < 1000) return `${chars} chars`;
    if (chars < 1000000) return `${(chars/1000).toFixed(1)}K`;
    return `${(chars/1000000).toFixed(1)}M`;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Async JSON parse to prevent UI freeze
async function parseJSONAsync(text) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            try {
                resolve(JSON.parse(text));
            } catch (e) {
                reject(e);
            }
        }, 10);
    });
}

// Process source map with progress
async function processSourceMap(json, output, infoText) {
    output.innerHTML = `<p class="info">${infoText}</p><p>⏳ Processing ${json.sources ? json.sources.length : 0} files...</p>`;

    // Let UI update
    await new Promise(r => setTimeout(r, 50));

    let result = unmapSourceMap(json);
    output.innerHTML = `<p class="info">${infoText}</p>` + result;
}

// Fetch from URL
async function loadFromURL() {
    let url = document.getElementById("sourcemapUrl").value.trim();
    let output = document.getElementById("output");

    if (!url) return alert("Enter a .map URL!");

    output.innerHTML = "<p>⏳ Fetching...</p>";

    try {
        let res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        let text = await res.text();
        output.innerHTML = `<p>⏳ Parsing ${formatSize(text.length)}...</p>`;

        let json = await parseJSONAsync(text);
        await processSourceMap(json, output, `📦 Received ${formatSize(text.length)}`);
    } catch (e) {
        output.innerHTML = `<p class="error">❌ Failed to fetch. Maybe CORS blocked it.</p><pre>${e}</pre>`;
    }
}

// Load from file upload
function loadFromFile() {
    let fileInput = document.getElementById("fileInput");
    if (!fileInput.files || fileInput.files.length === 0) {
        return alert("Select a .map file first!");
    }
    handleFileLoad(fileInput.files[0]);
}

// Load from pasted JSON
async function loadFromText() {
    let text = document.getElementById("sourcemapText").value.trim();
    let output = document.getElementById("output");

    if (!text) return alert("Paste source map JSON!");

    output.innerHTML = `<p>⏳ Parsing ${formatSize(text.length)}...</p>`;

    // Let UI update before heavy parsing
    await new Promise(r => setTimeout(r, 50));

    try {
        let json = await parseJSONAsync(text);
        await processSourceMap(json, output, `📦 Parsed ${formatSize(text.length)}`);
    } catch (e) {
        output.innerHTML = `<p class="error">❌ Invalid JSON.</p><pre>${e}\n\nFirst 200 chars:\n${escapeHtml(text.substring(0, 200))}</pre>`;
    }
}

// Secret patterns to search for - comprehensive list for bug bounty
const SECRET_PATTERNS = [
    // === CLOUD PROVIDER KEYS ===
    { name: "🔴 AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
    { name: "🔴 AWS Secret Key", regex: /(?:aws)?[_-]?secret[_-]?(?:access)?[_-]?key['"`]?\s*[:=]\s*['"`]?([A-Za-z0-9\/+=]{40})['"`]?/gi },
    { name: "🔴 AWS ARN", regex: /arn:aws:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:[a-zA-Z0-9-_\/]+/g },
    { name: "🔴 Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/g },
    { name: "🔴 Google OAuth", regex: /[0-9]+-[a-z0-9_]{32}\.apps\.googleusercontent\.com/gi },
    { name: "🔴 Azure Key", regex: /[a-zA-Z0-9+\/]{86}==/g },
    { name: "🔴 Azure Connection String", regex: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+/gi },

    // === AUTH TOKENS ===
    { name: "🟠 JWT Token", regex: /eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g },
    { name: "🟠 Bearer Token", regex: /[Bb]earer\s+[a-zA-Z0-9\-_\.]+/g },
    { name: "🟠 Basic Auth", regex: /[Bb]asic\s+[A-Za-z0-9+\/=]{10,}/g },
    { name: "🟠 Authorization Header", regex: /['"`]?[Aa]uthorization['"`]?\s*[:=]\s*['"`]([^'"`]{10,})['"`]/gi },
    { name: "🟠 Auth Token", regex: /['"`]?auth[_-]?token['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟠 Access Token", regex: /['"`]?access[_-]?token['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟠 Refresh Token", regex: /['"`]?refresh[_-]?token['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟠 Session Token", regex: /['"`]?session[_-]?(?:token|id|key)['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },

    // === API KEYS & SECRETS ===
    { name: "🟡 API Key", regex: /['"`]?api[_-]?key['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟡 API Secret", regex: /['"`]?api[_-]?secret['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟡 App Key", regex: /['"`]?app[_-]?(?:key|id|secret)['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟡 Client ID", regex: /['"`]?client[_-]?id['"`]?\s*[:=]\s*['"`]([^'"`\s]{10,})['"`]/gi },
    { name: "🟡 Client Secret", regex: /['"`]?client[_-]?secret['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟡 Secret Key", regex: /['"`]?secret[_-]?key['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟡 Private Key", regex: /['"`]?private[_-]?key['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟡 Encryption Key", regex: /['"`]?(?:encrypt|aes|cipher)[_-]?key['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },

    // === PASSWORDS & CREDENTIALS ===
    { name: "🔴 Password", regex: /['"`]?(?:password|passwd|pwd)['"`]?\s*[:=]\s*['"`]([^'"`]{4,})['"`]/gi },
    { name: "🔴 Credentials", regex: /['"`]?(?:credentials|creds)['"`]?\s*[:=]\s*['"`]([^'"`]{4,})['"`]/gi },
    { name: "🔴 Hardcoded Admin", regex: /['"`](admin|root|administrator)['"`]\s*[:=]\s*['"`]([^'"`]{3,})['"`]/gi },
    { name: "🔴 Database URL", regex: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s'"]+/gi },
    { name: "🔴 Connection String", regex: /['"`]?(?:connection[_-]?string|db[_-]?url|database[_-]?url)['"`]?\s*[:=]\s*['"`]([^'"`]{10,})['"`]/gi },

    // === PLATFORM SPECIFIC ===
    { name: "🟣 GitHub Token", regex: /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g },
    { name: "🟣 GitHub OAuth", regex: /[0-9a-f]{40}/g },
    { name: "🟣 GitLab Token", regex: /glpat-[A-Za-z0-9\-_]{20,}/g },
    { name: "🟣 Slack Token", regex: /xox[baprs]-[0-9a-zA-Z\-]{10,}/g },
    { name: "🟣 Slack Webhook", regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]+/g },
    { name: "🟣 Discord Webhook", regex: /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g },
    { name: "🟣 Discord Token", regex: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g },
    { name: "🟣 Stripe Key", regex: /(sk|pk|rk)_(test|live)_[0-9a-zA-Z]{24,}/g },
    { name: "🟣 Stripe Webhook", regex: /whsec_[A-Za-z0-9]+/g },
    { name: "🟣 PayPal Token", regex: /access_token\$production\$[a-z0-9]+\$[a-f0-9]+/gi },
    { name: "🟣 Square Token", regex: /sq0[a-z]{3}-[A-Za-z0-9\-_]{22,}/g },
    { name: "🟣 Twilio", regex: /SK[a-f0-9]{32}/g },
    { name: "🟣 Sendgrid", regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
    { name: "🟣 Mailgun", regex: /key-[a-f0-9]{32}/g },
    { name: "🟣 Mailchimp", regex: /[a-f0-9]{32}-us[0-9]{1,2}/g },
    { name: "🟣 Firebase URL", regex: /[a-z0-9-]+\.firebaseio\.com/gi },
    { name: "🟣 Firebase Key", regex: /AAAA[a-zA-Z0-9_-]{7}:[a-zA-Z0-9_-]{140}/g },
    { name: "🟣 Heroku API Key", regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
    { name: "🟣 NPM Token", regex: /npm_[A-Za-z0-9]{36}/g },
    { name: "🟣 PyPI Token", regex: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9\-_]{50,}/g },

    // === CRYPTO KEYS ===
    { name: "🔑 RSA Private Key", regex: /-----BEGIN\s*RSA\s*PRIVATE\s*KEY-----/g },
    { name: "🔑 DSA Private Key", regex: /-----BEGIN\s*DSA\s*PRIVATE\s*KEY-----/g },
    { name: "🔑 EC Private Key", regex: /-----BEGIN\s*EC\s*PRIVATE\s*KEY-----/g },
    { name: "🔑 OpenSSH Key", regex: /-----BEGIN\s*OPENSSH\s*PRIVATE\s*KEY-----/g },
    { name: "🔑 PGP Private", regex: /-----BEGIN\s*PGP\s*PRIVATE\s*KEY\s*BLOCK-----/g },

    // === GENERIC SENSITIVE ===
    { name: "🟢 Token Generic", regex: /['"`]?token['"`]?\s*[:=]\s*['"`]([^'"`\s]{10,})['"`]/gi },
    { name: "🟢 Secret Generic", regex: /['"`]?secret['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟢 Key Generic", regex: /['"`]?(?<!public[_-])key['"`]?\s*[:=]\s*['"`]([a-zA-Z0-9\-_]{20,})['"`]/gi },
    { name: "🟢 Hash/Salt", regex: /['"`]?(?:hash|salt)['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },
    { name: "🟢 Signing Key", regex: /['"`]?(?:signing|sign)[_-]?(?:key|secret)['"`]?\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/gi },

    // === S3 & STORAGE ===
    { name: "📦 S3 Bucket", regex: /[a-z0-9.-]+\.s3\.amazonaws\.com/gi },
    { name: "📦 S3 URL", regex: /s3:\/\/[a-z0-9.-]+/gi },
    { name: "📦 GCS Bucket", regex: /storage\.googleapis\.com\/[a-z0-9._-]+/gi },

    // === IP & INTERNAL ===
    { name: "🌐 Internal IP", regex: /(?:10\.[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}/g },
    { name: "🌐 Localhost URL", regex: /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):[0-9]+[^\s'"]*/gi },
];

// Find secrets in output
function findSecrets() {
    let output = document.getElementById("output").textContent;
    let secretsDiv = document.getElementById("secrets");

    if (!output || output.length < 50) {
        return alert("First load a source map!");
    }

    let results = "🔐 === SECRET SCAN RESULTS ===\n\n";
    let foundCount = 0;

    SECRET_PATTERNS.forEach(pattern => {
        let matches = output.match(pattern.regex);
        if (matches) {
            // Remove duplicates
            matches = [...new Set(matches)];
            foundCount += matches.length;
            results += `\n🚨 ${pattern.name} (${matches.length} found):\n`;
            matches.forEach(m => {
                results += `   → ${m}\n`;
            });
        }
    });

    if (foundCount === 0) {
        results += "✅ No obvious secrets found.\n\nTip: Manual review recommended for:\n";
        results += "- Config files\n- Environment variables\n- Hardcoded URLs with params\n";
    } else {
        results = `🔥 FOUND ${foundCount} POTENTIAL SECRETS!\n\n` + results;
    }

    secretsDiv.style.display = "block";
    secretsDiv.textContent = results;
    secretsDiv.scrollIntoView({ behavior: 'smooth' });
}

// Find API endpoints
function findEndpoints() {
    let output = document.getElementById("output").textContent;
    let secretsDiv = document.getElementById("secrets");

    if (!output || output.length < 50) {
        return alert("First load a source map!");
    }

    let results = "🌐 === ENDPOINT SCAN RESULTS ===\n\n";

    // URL patterns
    const urlPatterns = [
        { name: "Full URLs", regex: /https?:\/\/[^\s'"`<>)}\]]+/g },
        { name: "API Paths", regex: /['"`](\/api\/[^'"`\s]+)['"`]/g },
        { name: "GraphQL", regex: /['"`](\/graphql[^'"`\s]*)['"`]/gi },
        { name: "REST Endpoints", regex: /['"`](\/(v[0-9]+\/)?[a-z]+\/[a-z]+[^'"`\s]*)['"`]/gi },
    ];

    let foundCount = 0;

    urlPatterns.forEach(pattern => {
        let matches = output.match(pattern.regex);
        if (matches) {
            matches = [...new Set(matches)];
            foundCount += matches.length;
            results += `\n📍 ${pattern.name} (${matches.length} found):\n`;
            matches.slice(0, 50).forEach(m => {  // Limit to 50
                results += `   → ${m}\n`;
            });
            if (matches.length > 50) {
                results += `   ... and ${matches.length - 50} more\n`;
            }
        }
    });

    if (foundCount === 0) {
        results += "No endpoints found.\n";
    } else {
        results = `📡 FOUND ${foundCount} ENDPOINTS!\n\n` + results;
    }

    secretsDiv.style.display = "block";
    secretsDiv.textContent = results;
    secretsDiv.scrollIntoView({ behavior: 'smooth' });
}

// Copy output
function copyOutput() {
    let output = document.getElementById("output").textContent;
    let secrets = document.getElementById("secrets").textContent;
    navigator.clipboard.writeText(output + "\n\n" + secrets);
    alert("Copied to clipboard!");
}

// Clear output
function clearOutput() {
    document.getElementById("output").textContent = "";
    document.getElementById("secrets").textContent = "";
    document.getElementById("secrets").style.display = "none";
}
