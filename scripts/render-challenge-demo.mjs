#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = resolve(root, "docs/challenge-demo");
const frameDir = resolve(demoDir, "frames");
const htmlUrl = pathToFileURL(resolve(demoDir, "index.html")).toString();

const scenes = ["hero", "system", "review", "webhook", "proof"];

function run(command, args) {
	execFileSync(command, args, { stdio: "inherit" });
}

rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });

for (const [index, scene] of scenes.entries()) {
	const frame = resolve(frameDir, `frame-${String(index + 1).padStart(2, "0")}.png`);
	run("playwright", [
		"screenshot",
		"--browser",
		"chromium",
		"--viewport-size",
		"1440,900",
		"--wait-for-timeout",
		"350",
		`${htmlUrl}?scene=${scene}`,
		frame,
	]);
}

run("ffmpeg", [
	"-y",
	"-framerate",
	"0.5",
	"-i",
	resolve(frameDir, "frame-%02d.png"),
	"-c:v",
	"libx264",
	"-pix_fmt",
	"yuv420p",
	"-vf",
	"scale=1280:-2",
	resolve(demoDir, "demo.mp4"),
]);

run("ffmpeg", [
	"-y",
	"-framerate",
	"0.5",
	"-i",
	resolve(frameDir, "frame-%02d.png"),
	"-vf",
	"scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse",
	"-loop",
	"0",
	resolve(demoDir, "demo-preview.gif"),
]);

console.log(`Rendered ${resolve(demoDir, "demo.mp4")}`);
console.log(`Rendered ${resolve(demoDir, "demo-preview.gif")}`);
