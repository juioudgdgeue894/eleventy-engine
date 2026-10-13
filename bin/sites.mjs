/**
 * Where the fleet's site folders live, for release / sync-all / launch-platform.
 *
 * Sites sit at 40_Business/{Clients,Own Brands}/<name>/Site/<domain> and the
 * engine at 40_Business/Templates/eleventy-engine (layout from 2026-10-01).
 * Engine siblings (Templates/*) are included so the starter still counts.
 * Returns [{ name, dir }] where name is the site folder name (its domain).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function siteDirs() {
  const business = path.resolve(engineRoot, "..", "..");
  const parents = [path.resolve(engineRoot, "..")];
  for (const group of ["Clients", "Own Brands"]) {
    const g = path.join(business, group);
    if (!fs.existsSync(g)) continue;
    for (const c of fs.readdirSync(g, { withFileTypes: true }))
      if (c.isDirectory()) parents.push(path.join(g, c.name, "Site"));
  }
  const out = [];
  for (const parent of parents) {
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const dir = path.join(parent, entry.name);
      if (entry.isDirectory() && dir !== engineRoot) out.push({ name: entry.name, dir });
    }
  }
  return out;
}
