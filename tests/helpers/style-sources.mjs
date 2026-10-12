// G1: Assemble the original styling contracts for static legacy assertions.
// Production imports modules individually and in this exact cascade order.
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {globalFoundationCss,domainPolishCss} from '../../scripts/css-manifest.mjs';
export const globalCssModulePaths=[...globalFoundationCss];
export const polishCssModulePaths=[...domainPolishCss];
export function readGlobalCssSync(){return globalCssModulePaths.map(p=>readFileSync(p,'utf8')).join('');}
export async function readGlobalCss(){return (await Promise.all(globalCssModulePaths.map(p=>readFile(p,'utf8')))).join('');}
export function readPolishCssSync(){return polishCssModulePaths.map(p=>readFileSync(p,'utf8')).join('');}
export async function readPolishCss(){return (await Promise.all(polishCssModulePaths.map(p=>readFile(p,'utf8')))).join('');}
