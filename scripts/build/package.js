#!/usr/bin/env node
/**
 * @file
 * Simple Icons package build script.
 */

/**
 * @typedef {import('../../types.js').License} License
 * @typedef {import('esbuild').TransformOptions} EsBuildTransformOptions
 */

import {promises as fs} from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import {transform as esbuildTransform} from 'esbuild';
import {
  collator,
  getDirnameFromImportMeta,
  getIconSlug,
  getIconsData,
  slugToVariableName,
  svgToPath,
  titleToHtmlFriendly,
} from '../../sdk.mjs';

const __dirname = getDirnameFromImportMeta(import.meta.url);

const UTF8 = 'utf8';

const rootDirectory = path.resolve(__dirname, '..', '..');
const iconsDirectory = path.resolve(rootDirectory, 'icons');
const indexJsFile = path.resolve(rootDirectory, 'index.js');
const indexMjsFile = path.resolve(rootDirectory, 'index.mjs');
const sdkJsFile = path.resolve(rootDirectory, 'sdk.js');
const sdkMjsFile = path.resolve(rootDirectory, 'sdk.mjs');
const indexDtsFile = path.resolve(rootDirectory, 'index.d.ts');

const templatesDirectory = path.resolve(__dirname, 'templates');
const iconObjectTemplateFile = path.resolve(
  templatesDirectory,
  'icon-object.js.template',
);

const icons = await getIconsData();
const iconObjectTemplate = await fs.readFile(iconObjectTemplateFile, UTF8);

/**
 * @param {string} value The value to escape
 * @returns {string} The escaped value
 */
const escape = (value) => {
  return value.replaceAll(/(?<!\\)'/g, "\\'");
};

/**
 * @param {License} license The license object or URL
 * @returns {License} The license object with a URL
 */
const licenseToObject = (license) => {
  if (license.url === undefined) {
    license.url = `https://spdx.org/licenses/${license.type}`;
  }

  return license;
};

// TODO: Find a way to type this object without decreasing performance
// @ts-ignore
const iconToJsObject = (icon) => {
  return util.format(
    iconObjectTemplate,
    escape(icon.title),
    escape(icon.slug),
    escape(titleToHtmlFriendly(icon.title)),
    escape(icon.path),
    escape(icon.source),
    escape(icon.hex),
    icon.guidelines ? `\n  guidelines: '${escape(icon.guidelines)}',` : '',
    icon.license === undefined
      ? ''
      : `\n  license: ${JSON.stringify(licenseToObject(icon.license))},`,
  );
};

/**
 * @param {string} filepath The path to the file to write
 * @param {string} rawJavaScript The raw JavaScript content to write to the file
 * @param {EsBuildTransformOptions | null} options The options to pass to esbuild
 */
const writeJs = async (filepath, rawJavaScript, options = null) => {
  options = options === null ? {minify: true} : options;
  const {code} = await esbuildTransform(rawJavaScript, options);
  await fs.writeFile(filepath, code);
};

/**
 * @param {string} filepath The path to the file to write
 * @param {string} rawTypeScript The raw TypeScript content to write to the file
 */
const writeTs = async (filepath, rawTypeScript) => {
  await fs.writeFile(filepath, rawTypeScript);
};

const build = async () => {
  const buildIcons = await Promise.all(
    icons.map(async (icon) => {
      const filename = getIconSlug(icon);
      const svgFilepath = path.resolve(iconsDirectory, `${filename}.svg`);
      // TODO: Find a way to type these objects without decreasing performance
      // @ts-ignore
      icon.svg = await fs.readFile(svgFilepath, UTF8);
      // @ts-ignore
      icon.path = svgToPath(icon.svg);
      icon.slug = filename;
      const iconObject = iconToJsObject(icon);
      const iconExportName = slugToVariableName(icon.slug);
      return {icon, iconObject, iconExportName};
    }),
  );

  const iconsBarrelDts = [];
  const iconsBarrelJs = [];
  const iconsBarrelMjs = [];

  buildIcons.sort((a, b) => collator.compare(a.icon.title, b.icon.title));
  for (const {iconObject, iconExportName} of buildIcons) {
    iconsBarrelDts.push(`export const ${iconExportName}:I;`);
    iconsBarrelJs.push(`${iconExportName}:${iconObject},`);
    iconsBarrelMjs.push(`export const ${iconExportName}=${iconObject}`);
  }

  // Constants used in templates to reduce package size
  const constantsString = `const a='<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>',b='</title><path d="',c='"/></svg>';`;

  // Write our file containing the exports of all icons in CommonJS ...
  const rawIndexJs = `${constantsString}module.exports={${iconsBarrelJs.join(
    '',
  )}};`;
  await writeJs(indexJsFile, rawIndexJs);
  // ... and ESM
  const rawIndexMjs = constantsString + iconsBarrelMjs.join('');
  await writeJs(indexMjsFile, rawIndexMjs);
  // ... and create a type declaration file
  const rawIndexDts = `import {SimpleIcon} from "./types";export {SimpleIcon};type I=SimpleIcon;${iconsBarrelDts.join(
    '',
  )}`;
  await writeTs(indexDtsFile, rawIndexDts);

  // Create a CommonJS SDK file
  await writeJs(sdkJsFile, await fs.readFile(sdkMjsFile, UTF8), {
    format: 'cjs',
  });
};

await build();
