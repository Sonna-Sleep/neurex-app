#!/usr/bin/env node
/* global __dirname */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appJsonPath = path.join(root, 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const expo = appJson.expo ?? {};
const android = expo.android ?? {};
const packageName = android.package;
const googleServicesRel = android.googleServicesFile ?? './google-services.json';
const googleServicesPath = path.resolve(root, googleServicesRel);

function fail(message) {
  console.error(`[android-push] ${message}`);
  process.exit(1);
}

if (!packageName) fail('app.json is missing expo.android.package.');

if (!fs.existsSync(googleServicesPath)) {
  fail(
    `missing ${googleServicesRel}. Download it from Firebase for Android package ` +
      `${packageName}, place it in the repo root, then rerun npm run check:android-push.`,
  );
}

let googleServices;
try {
  googleServices = JSON.parse(fs.readFileSync(googleServicesPath, 'utf8'));
} catch (error) {
  fail(`${googleServicesRel} is not valid JSON: ${error.message}`);
}

const clients = Array.isArray(googleServices.client) ? googleServices.client : [];
const packageNames = clients
  .map((client) => client?.client_info?.android_client_info?.package_name)
  .filter(Boolean);

if (!packageNames.includes(packageName)) {
  fail(
    `${googleServicesRel} does not contain Android package ${packageName}. ` +
      `Found: ${packageNames.join(', ') || 'none'}.`,
  );
}

const projectId = googleServices.project_info?.project_id;
const appIds = clients.map((client) => client?.client_info?.mobilesdk_app_id).filter(Boolean);

if (!projectId) fail(`${googleServicesRel} is missing project_info.project_id.`);
if (appIds.length === 0) fail(`${googleServicesRel} is missing client_info.mobilesdk_app_id.`);

console.log(
  `[android-push] OK: ${googleServicesRel} matches ${packageName} ` +
    `(Firebase project ${projectId}).`,
);
