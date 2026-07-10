import { readFileSync, writeFileSync } from "fs";

// Version cible fournie par npm (issue de package.json après `npm version ...`)
const targetVersion = process.env.npm_package_version;

// Reporte la version dans manifest.json (en conservant minAppVersion)
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// Ajoute l'entrée version -> minAppVersion dans versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
