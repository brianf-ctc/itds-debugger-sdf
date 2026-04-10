#!/usr/bin/env node

/**
 * extract-dependencies.js
 * Scans a SuiteScript file for dependencies and generates suitecloud import commands
 *
 * Usage:
 *   node extract-dependencies.js <filepath> [--base-path /SuiteScripts/debug-vc]
 *
 * Output:
 *   suitecloud file:import --paths <path1> <path2> ...
 */

const fs = require('fs');
const path = require('path');

function extractDependencies(filePath, basePath = '/SuiteScripts/debug-vc') {
    try {
        // Read the file
        const content = fs.readFileSync(filePath, 'utf8');

        // Extract all require() calls
        const requirePattern = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        const dependencies = new Set();
        let match;

        while ((match = requirePattern.exec(content)) !== null) {
            const modulePath = match[1];

            // Skip N/* (NetSuite modules) and external libraries
            if (modulePath.startsWith('N/')) {
                continue;
            }

            // Convert relative paths to absolute SuiteScripts paths
            let absolutePath;
            if (modulePath.startsWith('/')) {
                // Already absolute
                absolutePath = modulePath;
            } else if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
                // Resolve relative path via virtual SuiteScripts path:
                // 1. Find where the basePath folder appears in the local file path
                // 2. Reconstruct the virtual file path as basePath + sub-path
                // 3. Resolve the require() relative to the virtual directory
                const baseFolderName = path.basename(basePath); // e.g. 'debug-vc'
                const filePathNorm = path.resolve(filePath).replace(/\\/g, '/');
                const markerIdx = filePathNorm.lastIndexOf('/' + baseFolderName + '/');
                const subPath = markerIdx >= 0
                    ? filePathNorm.substring(markerIdx + baseFolderName.length + 2)
                    : path.basename(filePath);
                const virtualFilePath = `${basePath}/${subPath}`;
                const virtualDir = path.dirname(virtualFilePath);
                absolutePath = path.resolve(virtualDir, modulePath).replace(/\\/g, '/');
            } else {
                // Assume it's in the same base path
                absolutePath = `${basePath}/${modulePath}`.replace(/\\/g, '/');
            }

            // Ensure .js extension if missing
            if (!absolutePath.endsWith('.js')) {
                absolutePath += '.js';
            }

            dependencies.add(absolutePath);
        }

        return Array.from(dependencies).sort();
    } catch (error) {
        console.error(`Error reading file: ${error.message}`);
        process.exit(1);
    }
}

// Main
const filePath = process.argv[2];
const basePath = process.argv[4] || '/SuiteScripts/debug-vc';

if (!filePath) {
    console.error('Usage: node extract-dependencies.js <filepath> [--base-path /path]');
    process.exit(1);
}

const dependencies = extractDependencies(filePath, basePath);

if (dependencies.length === 0) {
    console.log('No dependencies found.');
} else {
    console.log('// Copy this command to import all dependencies:');
    console.log('');
    console.log(`suitecloud file:import --paths \\`);
    dependencies.forEach((dep, index) => {
        const isLast = index === dependencies.length - 1;
        console.log(`  "${dep}"${isLast ? '' : ' \\'}`);
    });
    console.log('');
    console.log(`// Total dependencies: ${dependencies.length}`);
}
