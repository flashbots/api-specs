#!/usr/bin/env bun

const TARGET_NODE_VERSION = "24.10.0";

// semantic-release enforces a minimum Node.js version based on process.version/versions.node.
Reflect.set(process, "version", `v${TARGET_NODE_VERSION}`);
Reflect.set(process.versions as Record<string, unknown>, "node", TARGET_NODE_VERSION);

await import("semantic-release/bin/semantic-release.js");
