import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * ============================================================================
 * Litefin Tauri Artifact Relocation Utility
 * ============================================================================
 * 
 * Tauri distributes desktop and Android build outputs deep inside nested
 * build target directories:
 *   - Desktop: src-tauri/target/{release,debug}/bundle/{nsis,msi,deb,...}
 *   - Android APK: src-tauri/gen/android/app/build/outputs/apk/{abi}/{buildType}
 *   - Android AAB: src-tauri/gen/android/app/build/outputs/bundle/{buildType}
 * 
 * This script identifies all final compiled installation packages, formats
 * Android package names into canonical Litefin versioned filenames matching
 * our Tizen (.wgt) and webOS (.ipk) convention, and moves them directly to
 * the root directory of the Litefin repository.
 * ============================================================================
 */

// Root project directory reference
const rootDir = process.cwd();

/**
 * Retrieve the current application version string.
 * Priority: config.xml (Single Source of Truth) -> package.json
 * 
 * @returns {string} Semantic version string (e.g., "1.9.40")
 */
function getProjectVersion() {
    // Check config.xml first as it is Litefin's primary version manifest
    const configXmlPath = path.join(rootDir, 'config.xml');
    if (fs.existsSync(configXmlPath)) {
        const configXmlContent = fs.readFileSync(configXmlPath, 'utf8');
        const match = configXmlContent.match(/<widget[^>]*\sversion="([^"]+)"/);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    // Fallback to package.json if config.xml is unavailable
    const pkgJsonPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        if (pkg.version) {
            return pkg.version.trim();
        }
    }

    return '0.0.0';
}

/**
 * Recursively scan a folder for all files matching an array of extensions.
 * 
 * @param {string} dirPath - Directory to traverse.
 * @param {string[]} validExtensions - Extensions to retain (e.g. ['.exe', '.apk']).
 * @returns {string[]} Absolute file paths matching criteria.
 */
function scanDirectoryForExtensions(dirPath, validExtensions) {
    const results = [];

    // Safely exit if target search directory does not exist
    if (!fs.existsSync(dirPath)) {
        return results;
    }

    // Read current directory entries
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            // Traverse child directories recursively
            results.push(...scanDirectoryForExtensions(fullPath, validExtensions));
        } else if (entry.isFile()) {
            // Test if file extension matches any expected output type
            const ext = path.extname(entry.name).toLowerCase();
            if (validExtensions.includes(ext)) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

/**
 * Compute the canonical root destination filename for Android APK and AAB packages.
 * Transforms generic Gradle names (e.g. "app-arm64-release.apk") into descriptive,
 * versioned package names (e.g. "Litefin-1.9.40-Android-arm64.apk").
 * 
 * @param {string} fileName - Original output filename from Gradle.
 * @param {string} version - Application version string.
 * @returns {string} Formatted Litefin destination filename.
 */
function formatAndroidArtifactName(fileName, version) {
    // Regex parsing standard Gradle artifact naming conventions:
    // e.g. "app-arm64-release.apk", "app-universal-release-unsigned.apk", "app-release.aab"
    const gradlePattern = /^app(?:-([a-zA-Z0-9_-]+?))?-(release|debug)(?:-unsigned)?\.(apk|aab)$/i;
    const match = fileName.match(gradlePattern);

    if (match) {
        const [, abiOrVariant, buildType, ext] = match;
        const isDebug = buildType.toLowerCase() === 'debug';
        const debugSuffix = isDebug ? '-debug' : '';

        // Handle Android App Bundle (.aab) packaging
        if (ext.toLowerCase() === 'aab') {
            return `Litefin-${version}-Android-bundle${debugSuffix}.aab`;
        }

        // Handle ABI-split or universal Android Application Packages (.apk)
        const targetAbi = abiOrVariant || 'universal';
        return `Litefin-${version}-Android-${targetAbi}${debugSuffix}.apk`;
    }

    // Preserve any artifacts that already feature Litefin in their name
    if (fileName.startsWith('Litefin')) {
        return fileName;
    }

    // Fallback prefixing for non-standard Gradle output names
    return `Litefin-${version}-Android-${fileName}`;
}

/**
 * Safely move a file from source to destination across filesystems and platforms.
 * Handles existing target deletion and Windows file locking fallbacks.
 * 
 * @param {string} sourcePath - Absolute path of the source file.
 * @param {string} destPath - Absolute destination path in root directory.
 */
function safelyMoveFile(sourcePath, destPath) {
    // If the destination artifact already exists from an earlier build, remove it first
    if (fs.existsSync(destPath)) {
        try {
            fs.unlinkSync(destPath);
        } catch (e) {
            console.warn(`[WARN] Could not unlink existing destination file ${destPath}: ${e.message}`);
        }
    }

    try {
        // Attempt atomic filesystem move
        fs.renameSync(sourcePath, destPath);
    } catch (renameErr) {
        // Fallback for cross-drive mounts or locked handles
        try {
            fs.copyFileSync(sourcePath, destPath);
            fs.unlinkSync(sourcePath);
        } catch (copyErr) {
            throw new Error(`Failed to move file from ${sourcePath} to ${destPath}: ${copyErr.message}`);
        }
    }
}

/**
 * Human-readable byte formatting helper.
 * 
 * @param {number} bytes - Number of bytes.
 * @returns {string} Formatted size string (e.g. "12.4 MB").
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Remove stale or obsolete build artifacts from previous versions
 * residing in the repository root and internal Tauri build directories.
 *
 * @param {string} currentVersion - The current application semantic version.
 * @returns {number} Count of removed stale artifacts.
 */
export function cleanObsoleteArtifacts(currentVersion = getProjectVersion()) {
    let cleanedCount = 0;

    // ------------------------------------------------------------------------
    // 1. Clean Stale Artifacts in Repository Root (./)
    // ------------------------------------------------------------------------
    // Scans root directory for Litefin release binaries (.apk, .aab, .exe, .msi,
    // .deb, .AppImage, .rpm, .dmg, .wgt, .ipk, .zip) whose version does NOT match currentVersion.
    const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    const artifactExts = ['.apk', '.aab', '.exe', '.msi', '.deb', '.appimage', '.rpm', '.dmg', '.wgt', '.ipk', '.zip'];

    for (const entry of rootEntries) {
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!artifactExts.includes(ext)) continue;

        // Extract version from file names like Litefin-1.9.40-Android-arm.apk or Litefin_1.9.40_x64.msi
        const versionMatch = entry.name.match(/Litefin[._-](?:Web\.Plugin_)?(\d+\.\d+\.\d+)/i);
        if (versionMatch && versionMatch[1] !== currentVersion) {
            const stalePath = path.join(rootDir, entry.name);
            try {
                fs.unlinkSync(stalePath);
                console.info(`🗑️ Removed stale root artifact: ${entry.name} (found v${versionMatch[1]}, expected v${currentVersion})`);
                cleanedCount++;
            } catch (err) {
                console.warn(`[WARN] Failed to delete stale artifact ${entry.name}: ${err.message}`);
            }
        }
    }

    // ------------------------------------------------------------------------
    // 2. Purge Stale Version Bundles from src-tauri/target
    // ------------------------------------------------------------------------
    const bundleDirs = [
        path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle'),
        path.join(rootDir, 'src-tauri', 'target', 'debug', 'bundle')
    ];

    for (const bDir of bundleDirs) {
        if (!fs.existsSync(bDir)) continue;
        const candidateFiles = scanDirectoryForExtensions(bDir, artifactExts);
        for (const filePath of candidateFiles) {
            const fileName = path.basename(filePath);
            const versionMatch = fileName.match(/[_.-](\d+\.\d+\.\d+)[_.-]/);
            if (versionMatch && versionMatch[1] !== currentVersion) {
                try {
                    fs.unlinkSync(filePath);
                    console.info(`🗑️ Purged obsolete bundle cache: ${fileName}`);
                    cleanedCount++;
                } catch (err) {
                    console.warn(`[WARN] Failed to purge bundle file ${fileName}: ${err.message}`);
                }
            }
        }
    }

    return cleanedCount;
}

/**
 * Main routine: Scans all Tauri target output directories and moves
 * installers/packages up to the root Litefin workspace directory.
 */
export async function moveTauriOutputs() {
    const version = getProjectVersion();
    console.info(`\n========================================================`);
    console.info(`📦 Relocating Tauri build outputs for Litefin v${version}`);
    console.info(`========================================================\n`);

    // Clean any leftover obsolete version artifacts from root and bundle cache
    cleanObsoleteArtifacts(version);

    let movedCount = 0;

    // ------------------------------------------------------------------------
    // 1. Desktop Installers & Packages
    // ------------------------------------------------------------------------
    // Search target/{release,debug}/bundle for all platform installer artifacts
    const desktopBundleDirs = [
        path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle'),
        path.join(rootDir, 'src-tauri', 'target', 'debug', 'bundle')
    ];

    const desktopExtensions = [
        '.exe',        // Windows NSIS Setup
        '.msi',        // Windows MSI Installer
        '.deb',        // Debian / Ubuntu package
        '.appimage',   // Standalone Linux AppImage
        '.dmg',        // macOS Disk Image
        '.rpm',        // RedHat / Fedora package
        '.pkg'         // macOS Component package
    ];

    for (const bundleDir of desktopBundleDirs) {
        if (!fs.existsSync(bundleDir)) {
            continue;
        }

        const candidateFiles = scanDirectoryForExtensions(bundleDir, desktopExtensions);

        for (const filePath of candidateFiles) {
            const fileName = path.basename(filePath);

            // Filter out older versions if present in cache to avoid pollution
            // (e.g. Litefin_1.9.28_x64-setup.exe when current version is 1.9.40)
            const versionInNameMatch = fileName.match(/[_.-](\d+\.\d+\.\d+)[_.-]/);
            if (versionInNameMatch && versionInNameMatch[1] !== version) {
                console.info(`[SKIP] Obsolete version artifact: ${fileName} (expected v${version})`);
                continue;
            }

            const stats = fs.statSync(filePath);
            const destPath = path.join(rootDir, fileName);

            safelyMoveFile(filePath, destPath);
            console.info(`✓ Desktop Package: ${fileName} (${formatFileSize(stats.size)}) -> ./`);
            movedCount++;
        }
    }

    // ------------------------------------------------------------------------
    // 2. Portable Standalone Executable (litefin.exe / litefin)
    // ------------------------------------------------------------------------
    // Tauri/Cargo compiles the standalone unbundled portable executable into
    // target/release or target/debug before wrapping it into installers.
    //
    // We relocate this standalone binary directly into the Litefin repository
    // root using our versioned naming convention:
    //   - Release: Litefin-${version}.exe (Windows) or Litefin-${version} (Linux/macOS)
    //   - Debug:   Litefin-${version}-debug.exe or Litefin-${version}-debug
    // ------------------------------------------------------------------------
    const baseTargetDir = path.join(rootDir, 'src-tauri', 'target');
    const portableCandidateDirs = [];

    // Check standard Cargo output directories
    const defaultReleaseDir = path.join(baseTargetDir, 'release');
    const defaultDebugDir = path.join(baseTargetDir, 'debug');
    if (fs.existsSync(defaultReleaseDir)) portableCandidateDirs.push(defaultReleaseDir);
    if (fs.existsSync(defaultDebugDir)) portableCandidateDirs.push(defaultDebugDir);

    // Also inspect any custom cross-compilation target triple subdirectories
    if (fs.existsSync(baseTargetDir)) {
        const targetSubdirs = fs.readdirSync(baseTargetDir, { withFileTypes: true });
        for (const sub of targetSubdirs) {
            // Filter out files, standard directories, and Android NDK toolchain targets
            if (
                sub.isDirectory() &&
                sub.name !== 'release' &&
                sub.name !== 'debug' &&
                !sub.name.includes('android')
            ) {
                const subRelease = path.join(baseTargetDir, sub.name, 'release');
                const subDebug = path.join(baseTargetDir, sub.name, 'debug');
                if (fs.existsSync(subRelease)) portableCandidateDirs.push(subRelease);
                if (fs.existsSync(subDebug)) portableCandidateDirs.push(subDebug);
            }
        }
    }

    // Standalone portable executables are specifically packaged for Windows (.exe).
    // Linux and macOS users install or run proper bundles (.AppImage, .deb, .rpm, .dmg).
    const portableBinaryNames = ['litefin.exe', 'Litefin.exe'];

    for (const searchDir of portableCandidateDirs) {
        for (const binName of portableBinaryNames) {
            const binPath = path.join(searchDir, binName);

            // Verify the executable file exists and is a regular file
            if (fs.existsSync(binPath) && fs.statSync(binPath).isFile()) {
                const isDebug = searchDir.endsWith('debug') || searchDir.includes(`${path.sep}debug`);
                const ext = path.extname(binName).toLowerCase();
                const debugSuffix = isDebug ? '-debug' : '';

                // Canonical destination filename matching user's versioned standard
                const targetName = `Litefin-${version}${debugSuffix}${ext}`;
                const destPath = path.join(rootDir, targetName);
                const stats = fs.statSync(binPath);

                safelyMoveFile(binPath, destPath);
                console.info(`✓ Portable Binary: ${binName} -> ${targetName} (${formatFileSize(stats.size)}) -> ./`);
                movedCount++;
            }
        }

        // Also check for any loose APK or AAB binaries placed directly in target dirs
        const loosePackages = scanDirectoryForExtensions(searchDir, ['.apk', '.aab']);
        for (const pkgPath of loosePackages) {
            const pkgName = path.basename(pkgPath);
            const targetName = formatAndroidArtifactName(pkgName, version);
            const destPath = path.join(rootDir, targetName);
            const stats = fs.statSync(pkgPath);

            safelyMoveFile(pkgPath, destPath);
            console.info(`✓ Android Binary: ${pkgName} -> ${targetName} (${formatFileSize(stats.size)}) -> ./`);
            movedCount++;
        }
    }

    // ------------------------------------------------------------------------
    // 3. Android APK Packages
    // ------------------------------------------------------------------------
    // Search gen/android/app/build/outputs/apk for release & debug APK binaries
    const androidApkDir = path.join(rootDir, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk');
    if (fs.existsSync(androidApkDir)) {
        const candidateApks = scanDirectoryForExtensions(androidApkDir, ['.apk']);

        for (const apkPath of candidateApks) {
            const fileName = path.basename(apkPath);
            const stats = fs.statSync(apkPath);

            // Generate clean versioned Litefin name
            const targetName = formatAndroidArtifactName(fileName, version);
            const destPath = path.join(rootDir, targetName);

            safelyMoveFile(apkPath, destPath);
            console.info(`✓ Android APK: ${fileName} -> ${targetName} (${formatFileSize(stats.size)}) -> ./`);
            movedCount++;
        }
    }

    // ------------------------------------------------------------------------
    // 4. Android AAB Bundles
    // ------------------------------------------------------------------------
    // Search gen/android/app/build/outputs/bundle for Google Play AAB bundles
    const androidBundleDir = path.join(rootDir, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'bundle');
    if (fs.existsSync(androidBundleDir)) {
        const candidateBundles = scanDirectoryForExtensions(androidBundleDir, ['.aab']);

        for (const bundlePath of candidateBundles) {
            const fileName = path.basename(bundlePath);
            const stats = fs.statSync(bundlePath);

            // Generate clean versioned Litefin name
            const targetName = formatAndroidArtifactName(fileName, version);
            const destPath = path.join(rootDir, targetName);

            safelyMoveFile(bundlePath, destPath);
            console.info(`✓ Android AAB: ${fileName} -> ${targetName} (${formatFileSize(stats.size)}) -> ./`);
            movedCount++;
        }
    }

    console.info(`\nDone! Successfully relocated ${movedCount} build artifact(s) to root directory.\n`);
    return movedCount;
}

// ----------------------------------------------------------------------------
// Direct Execution Entrypoint
// ----------------------------------------------------------------------------
// Enables executing this script directly via `node scripts/move-tauri-artifacts.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    if (process.argv.includes('--clean-only')) {
        const count = cleanObsoleteArtifacts();
        console.info(`Cleaned ${count} stale build artifact(s).`);
    } else {
        moveTauriOutputs().catch((err) => {
            console.error('Error while relocating Tauri build outputs:', err);
            process.exit(1);
        });
    }
}
